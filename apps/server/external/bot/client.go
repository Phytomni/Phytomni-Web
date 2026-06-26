package bot

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"time"
)

// Client is a thin HTTP wrapper around the Bot phytomni-api /v1 surface. It
// presents the single ptm_<web> user key on every call; the Bot service token
// is ops-only and intentionally absent here.
type Client struct {
	http    *http.Client
	baseURL string
	userKey string
}

// NewClient builds a Client from the loaded BotConfig.
func NewClient() *Client {
	return &Client{
		http:    &http.Client{Timeout: time.Duration(BotConfig.TimeoutSeconds) * time.Second},
		baseURL: BotConfig.BaseURL,
		userKey: BotConfig.UserAPIKey,
	}
}

// ErrBotTimeout marks a Web→Bot relay call that exceeded the HTTP client
// timeout (or had its context deadline expire) before the Bot replied. It is a
// wrapped sentinel so queryErrorStatus can map it to 504 instead of a generic
// 500. Distinct from APIError, which is a decoded non-2xx Bot *response*.
var ErrBotTimeout = errors.New("bot relay timed out")

// isTimeoutErr reports whether err is a transport/deadline timeout (client
// Timeout trip, context deadline, or a net.Error with Timeout()).
func isTimeoutErr(err error) bool {
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var ne net.Error
	return errors.As(err, &ne) && ne.Timeout()
}

// APIError is a non-2xx Bot response decoded into a typed error so callers can
// distinguish a client-correctable status (surfaced to the Web app) from a 5xx or
// transport failure (kept generic). Message is the Bot envelope message; body
// is the raw payload kept for logs only.
type APIError struct {
	Method    string
	Path      string
	Status    int
	Message   string
	RequestID string
	body      string
}

func (e *APIError) Error() string {
	if e.Message != "" {
		return fmt.Sprintf("bot %s %s: %s (code=%d req=%s)", e.Method, e.Path, e.Message, e.Status, e.RequestID)
	}
	return fmt.Sprintf("bot %s %s: status %d body %s", e.Method, e.Path, e.Status, truncateForLog(e.body))
}

// maxBodyInError bounds how much of a non-envelope Bot response body is
// embedded in the error string.
const maxBodyInError = 256

// truncateForLog caps the raw Bot body that gets stringified into the error.
// The error reaches the logs, and a 5xx body may carry internal detail or user
// data, so short payloads survive intact while oversized ones are truncated
// rather than echoed in full. Truncation is on a rune boundary so a multibyte
// (e.g. Chinese) body never lands as invalid UTF-8.
func truncateForLog(s string) string {
	r := []rune(s)
	if len(r) <= maxBodyInError {
		return s
	}
	return string(r[:maxBodyInError]) + "…(truncated)"
}

// botError turns a non-2xx response into a typed *APIError, preferring the
// uniform Bot error envelope and falling back to the raw body (logs only).
func botError(method, path string, status int, raw []byte) error {
	e := &APIError{Method: method, Path: path, Status: status, body: string(raw)}
	var be BotError
	if json.Unmarshal(raw, &be) == nil && be.Error.Message != "" {
		e.Message = be.Error.Message
		e.RequestID = be.Error.RequestID
	}
	return e
}

// SurfaceableMessage reports whether err is a client-correctable Bot error
// whose message is safe to show the end user. It surfaces 4xx (e.g. a
// resolve/validation failure) but deliberately not 401/403 (a Web↔Bot auth
// misconfig must not bounce the user to /login) nor 5xx/transport errors
// (which may leak internals).
func SurfaceableMessage(err error) (string, bool) {
	var ae *APIError
	if errors.As(err, &ae) && ae.Message != "" &&
		ae.Status >= 400 && ae.Status < 500 && ae.Status != 401 && ae.Status != 403 {
		return ae.Message, true
	}
	return "", false
}

// doJSON sends an optional JSON body and decodes a JSON response into out.
func (c *Client) doJSON(ctx context.Context, method, path string, body, out interface{}) error {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, rdr)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", "Bearer "+c.userKey)
	resp, err := c.http.Do(req)
	if err != nil {
		if isTimeoutErr(err) {
			return fmt.Errorf("%w: %v", ErrBotTimeout, err)
		}
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return botError(method, path, resp.StatusCode, raw)
	}
	if out != nil {
		return json.Unmarshal(raw, out)
	}
	return nil
}

// ChatCompletion runs a sync chat model (stream=false) and returns the
// formatted answer envelope.
func (c *Client) ChatCompletion(ctx context.Context, req ChatCompletionRequest) (*ChatCompletionResponse, error) {
	req.Stream = false
	var out ChatCompletionResponse
	if err := c.doJSON(ctx, http.MethodPost, "/v1/chat/completions", req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ChatCompletionStream opens a streaming chat completion and returns the raw
// SSE body for the caller to io.Copy through to the Web app. Precondition
// failures (auth, unsupported model) surface as a decoded error here, before
// any frame is forwarded, because Bot validates them up front. The caller
// owns closing the returned ReadCloser.
func (c *Client) ChatCompletionStream(ctx context.Context, req ChatCompletionRequest) (io.ReadCloser, error) {
	req.Stream = true
	b, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/chat/completions", bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+c.userKey)
	resp, err := c.http.Do(httpReq)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, botError(http.MethodPost, "/v1/chat/completions", resp.StatusCode, raw)
	}
	return resp.Body, nil
}

// InvokeAgent submits a run to a remote/long-running agent by slug.
func (c *Client) InvokeAgent(ctx context.Context, slug string, req AgentRunRequest) (*AgentRunResponse, error) {
	var out AgentRunResponse
	if err := c.doJSON(ctx, http.MethodPost, "/v1/agents/"+url.PathEscape(slug)+"/runs", req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListRuns fetches every run for a dialogue in one call (server-side filter).
func (c *Client) ListRuns(ctx context.Context, dialogueID string) (*RunsListResponse, error) {
	q := url.Values{}
	q.Set("dialogue_id", dialogueID)
	var out RunsListResponse
	if err := c.doJSON(ctx, http.MethodGet, "/v1/runs?"+q.Encode(), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetRun fetches a single run by id.
func (c *Client) GetRun(ctx context.Context, runID string) (*RunRecord, error) {
	var out RunRecord
	if err := c.doJSON(ctx, http.MethodGet, "/v1/runs/"+url.PathEscape(runID), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetRunLogs fetches the task logs for a run (used by the update-log path).
func (c *Client) GetRunLogs(ctx context.Context, runID string) (*RunLogsResponse, error) {
	var out RunLogsResponse
	if err := c.doJSON(ctx, http.MethodGet, "/v1/runs/"+url.PathEscape(runID)+"/logs", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetAgents lists the agents Bot exposes (used for startup slug validation).
func (c *Client) GetAgents(ctx context.Context) (*AgentsListResponse, error) {
	var out AgentsListResponse
	if err := c.doJSON(ctx, http.MethodGet, "/v1/agents", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// UploadFile streams one file to Bot OBS ingestion and returns its metadata.
func (c *Client) UploadFile(ctx context.Context, filename, purpose string, r io.Reader) (*FileUploadResponse, error) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	part, err := mw.CreateFormFile("file", filename)
	if err != nil {
		return nil, err
	}
	if _, err := io.Copy(part, r); err != nil {
		return nil, err
	}
	if purpose != "" {
		if err := mw.WriteField("purpose", purpose); err != nil {
			return nil, err
		}
	}
	if err := mw.Close(); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/files", &buf)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+c.userKey)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, botError(http.MethodPost, "/v1/files", resp.StatusCode, raw)
	}
	var out FileUploadResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

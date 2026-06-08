package bot

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
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

// botError turns a non-2xx response into a Go error, preferring the uniform
// Bot error envelope and falling back to the raw body.
func botError(method, path string, status int, raw []byte) error {
	var be BotError
	if json.Unmarshal(raw, &be) == nil && be.Error.Message != "" {
		return fmt.Errorf("bot %s %s: %s (code=%d req=%s)", method, path, be.Error.Message, be.Error.Code, be.Error.RequestID)
	}
	return fmt.Errorf("bot %s %s: status %d body %s", method, path, status, string(raw))
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
// SSE body for the caller to io.Copy through to chat-ai. Precondition
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

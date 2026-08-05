package bot

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
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

// NewClient builds a Client using the global fallback timeout.
func NewClient() *Client {
	return NewClientWithTimeout(
		time.Duration(BotConfig.TimeoutSeconds) * time.Second,
	)
}

// NewClientWithTimeout builds a Client for one explicitly bounded request
// class without mutating the process-wide BotConfig.
func NewClientWithTimeout(timeout time.Duration) *Client {
	if timeout <= 0 {
		timeout = time.Duration(BotConfig.TimeoutSeconds) * time.Second
	}
	return &Client{
		http:    &http.Client{Timeout: timeout},
		baseURL: BotConfig.BaseURL,
		userKey: BotConfig.UserAPIKey,
	}
}

// ErrBotTimeout marks a Web→Bot relay call that exceeded the HTTP client
// timeout (or had its context deadline expire) before the Bot replied. It is a
// wrapped sentinel so queryErrorStatus can map it to 504 instead of a generic
// 500. Distinct from APIError, which is a decoded non-2xx Bot *response*.
var ErrBotTimeout = errors.New("bot relay timed out")

// ResponseMeta carries correlation and status metadata from a completed Bot
// response. BotRequestID is intentionally separate from Web's request id;
// callers must continue to use the Web context id for client-facing errors.
type ResponseMeta struct {
	StatusCode   int
	BotRequestID string
}

// isTimeoutErr reports whether err is a transport/deadline timeout (client
// Timeout trip, context deadline, or a net.Error with Timeout()).
func isTimeoutErr(err error) bool {
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var ne net.Error
	return errors.As(err, &ne) && ne.Timeout()
}

func wrapTransportError(err error) error {
	if isTimeoutErr(err) {
		return fmt.Errorf("%w: %v", ErrBotTimeout, err)
	}
	return err
}

func responseMeta(resp *http.Response) ResponseMeta {
	if resp == nil {
		return ResponseMeta{}
	}
	return ResponseMeta{
		StatusCode:   resp.StatusCode,
		BotRequestID: resp.Header.Get("X-Request-Id"),
	}
}

func preferBotRequestID(err error, requestID string) error {
	if requestID == "" {
		return err
	}
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		apiErr.RequestID = requestID
	}
	return err
}

// APIError is a non-2xx Bot response decoded into a typed error so callers can
// distinguish a client-correctable status (surfaced to the Web app) from a 5xx or
// transport failure (kept generic). Message is the Bot envelope message; body
// is the raw payload kept for logs only.
type APIError struct {
	Method    string
	Path      string
	Status    int
	Code      string
	Message   string
	Stage     string
	Retryable bool
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
	var safe struct {
		Error struct {
			Code      string `json:"code"`
			Message   string `json:"message"`
			RequestID string `json:"request_id"`
			Stage     string `json:"stage"`
			Retryable bool   `json:"retryable"`
		} `json:"error"`
	}
	if json.Unmarshal(raw, &safe) == nil && safe.Error.Code != "" {
		e.Code = safe.Error.Code
		e.Message = safe.Error.Message
		e.RequestID = safe.Error.RequestID
		e.Stage = safe.Error.Stage
		e.Retryable = safe.Error.Retryable
		return e
	}
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

// doJSONWithMeta sends an optional JSON body, captures response metadata, and
// decodes a JSON response into out.
func (c *Client) doJSONWithMeta(ctx context.Context, method, path string, body, out interface{}) (ResponseMeta, error) {
	return c.doJSONWithMetaOptions(ctx, method, path, body, out, false)
}

// doJSONWithMetaOptions is the shared JSON transport with an opt-in strict
// decoder for response envelopes whose identity controls a cross-service
// write. Ordinary Bot responses keep encoding/json's existing behavior; the
// Agent-run responses opt in so duplicate object keys cannot become a
// last-value-wins agent/run identity.
func (c *Client) doJSONWithMetaOptions(ctx context.Context, method, path string, body, out interface{}, rejectDuplicateKeys bool) (ResponseMeta, error) {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return ResponseMeta{}, err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, rdr)
	if err != nil {
		return ResponseMeta{}, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", "Bearer "+c.userKey)
	resp, err := c.http.Do(req)
	if err != nil {
		return ResponseMeta{}, wrapTransportError(err)
	}
	defer resp.Body.Close()
	meta := responseMeta(resp)
	raw, readErr := io.ReadAll(resp.Body)
	if readErr != nil {
		return meta, wrapTransportError(readErr)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return meta, preferBotRequestID(botError(method, path, resp.StatusCode, raw), meta.BotRequestID)
	}
	if rejectDuplicateKeys {
		if err := rejectDuplicateJSONKeys(raw); err != nil {
			return meta, err
		}
	}
	if out != nil {
		return meta, json.Unmarshal(raw, out)
	}
	return meta, nil
}

var errDuplicateJSONKey = errors.New("duplicate JSON object key")

// rejectDuplicateJSONKeys walks one complete JSON value and rejects duplicate
// keys at every object depth. encoding/json intentionally keeps the last value
// for duplicate keys; that is unsafe for the Expert envelope because a
// duplicate agent/run_id could change the identity after validation.
func rejectDuplicateJSONKeys(raw []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := walkJSONValue(decoder); err != nil {
		return err
	}
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}

func walkJSONValue(decoder *json.Decoder) error {
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	delim, ok := token.(json.Delim)
	if !ok {
		return nil
	}

	switch delim {
	case '{':
		seen := make(map[string]struct{})
		for decoder.More() {
			keyToken, err := decoder.Token()
			if err != nil {
				return err
			}
			key, ok := keyToken.(string)
			if !ok {
				return errors.New("JSON object key is not a string")
			}
			if _, duplicate := seen[key]; duplicate {
				return fmt.Errorf("%w: %q", errDuplicateJSONKey, key)
			}
			seen[key] = struct{}{}
			if err := walkJSONValue(decoder); err != nil {
				return err
			}
		}
		closing, err := decoder.Token()
		if err != nil {
			return err
		}
		if closing != json.Delim('}') {
			return errors.New("JSON object did not close")
		}
	case '[':
		for decoder.More() {
			if err := walkJSONValue(decoder); err != nil {
				return err
			}
		}
		closing, err := decoder.Token()
		if err != nil {
			return err
		}
		if closing != json.Delim(']') {
			return errors.New("JSON array did not close")
		}
	default:
		return errors.New("unexpected JSON delimiter")
	}
	return nil
}

// doJSON sends an optional JSON body and decodes a JSON response into out.
func (c *Client) doJSON(ctx context.Context, method, path string, body, out interface{}) error {
	_, err := c.doJSONWithMeta(ctx, method, path, body, out)
	return err
}

// ChatCompletion runs a sync chat model (stream=false) and returns the
// formatted answer envelope.
func (c *Client) ChatCompletion(ctx context.Context, req ChatCompletionRequest) (*ChatCompletionResponse, error) {
	response, _, err := c.ChatCompletionWithMeta(ctx, req)
	if err != nil {
		return nil, err
	}
	return response, nil
}

// ChatCompletionWithMeta runs a sync chat model (stream=false) and returns
// the formatted answer envelope plus Bot response metadata.
func (c *Client) ChatCompletionWithMeta(ctx context.Context, req ChatCompletionRequest) (*ChatCompletionResponse, ResponseMeta, error) {
	req.Stream = false
	var out ChatCompletionResponse
	meta, err := c.doJSONWithMeta(ctx, http.MethodPost, "/v1/chat/completions", req, &out)
	if err == nil && req.Conversation != nil {
		err = validateResponseContext(out.ConversationContext, req.Conversation.TurnID)
	}
	return &out, meta, err
}

// ChatCompletionStream opens a streaming chat completion and returns the raw
// SSE body for the caller to forward to the Web app unchanged. Precondition
// failures (auth, unsupported model) surface as a decoded error here, before
// any frame is forwarded, because Bot validates them up front. The caller
// owns closing the returned ReadCloser.
func (c *Client) ChatCompletionStream(ctx context.Context, req ChatCompletionRequest) (io.ReadCloser, error) {
	stream, _, err := c.ChatCompletionStreamWithMeta(ctx, req)
	return stream, err
}

// ChatCompletionStreamWithMeta opens a streaming chat completion and returns
// the raw SSE body together with metadata from the stream setup response.
func (c *Client) ChatCompletionStreamWithMeta(ctx context.Context, req ChatCompletionRequest) (io.ReadCloser, ResponseMeta, error) {
	req.Stream = true
	b, err := json.Marshal(req)
	if err != nil {
		return nil, ResponseMeta{}, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/chat/completions", bytes.NewReader(b))
	if err != nil {
		return nil, ResponseMeta{}, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+c.userKey)
	resp, err := c.http.Do(httpReq)
	if err != nil {
		return nil, ResponseMeta{}, wrapTransportError(err)
	}
	meta := responseMeta(resp)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		raw, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr != nil {
			return nil, meta, wrapTransportError(readErr)
		}
		return nil, meta, preferBotRequestID(botError(http.MethodPost, "/v1/chat/completions", resp.StatusCode, raw), meta.BotRequestID)
	}
	return resp.Body, meta, nil
}

// InvokeAgent submits a run to a remote/long-running agent by slug.
func (c *Client) InvokeAgent(ctx context.Context, slug string, req AgentRunRequest) (*AgentRunResponse, error) {
	response, _, err := c.InvokeAgentWithMeta(ctx, slug, req)
	if err != nil {
		return nil, err
	}
	return response, nil
}

// InvokeAgentWithMeta submits a run and returns Bot response metadata.
func (c *Client) InvokeAgentWithMeta(ctx context.Context, slug string, req AgentRunRequest) (*AgentRunResponse, ResponseMeta, error) {
	var out AgentRunResponse
	meta, err := c.doJSONWithMetaOptions(ctx, http.MethodPost, "/v1/agents/"+url.PathEscape(slug)+"/runs", req, &out, true)
	if err == nil && req.Conversation != nil {
		err = validateResponseContext(out.ConversationContext, req.Conversation.TurnID)
	}
	return &out, meta, err
}

// RouteQuery dispatches an Expert-mode query to Bot's MCP semantic router,
// which selects and runs the appropriate agent and returns the agent.run shape.
func (c *Client) RouteQuery(ctx context.Context, req RouteQueryRequest) (*RouteQueryResponse, error) {
	response, _, err := c.RouteQueryWithMeta(ctx, req)
	if err != nil {
		return nil, err
	}
	return response, nil
}

// RouteQueryWithMeta dispatches an Expert-mode query and returns Bot response
// metadata alongside the agent.run-shaped response.
func (c *Client) RouteQueryWithMeta(ctx context.Context, req RouteQueryRequest) (*RouteQueryResponse, ResponseMeta, error) {
	var out RouteQueryResponse
	meta, err := c.doJSONWithMetaOptions(ctx, http.MethodPost, "/v1/query/route", req, &out, true)
	if err == nil && req.Conversation != nil {
		err = validateResponseContext(out.ConversationContext, req.Conversation.TurnID)
	}
	return &out, meta, err
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
	response, _, err := c.GetRunWithMeta(ctx, runID)
	if err != nil {
		return nil, err
	}
	return response, nil
}

// GetRunWithMeta fetches a single run by id and returns Bot response metadata.
func (c *Client) GetRunWithMeta(ctx context.Context, runID string) (*RunRecord, ResponseMeta, error) {
	var out RunRecord
	meta, err := c.doJSONWithMeta(ctx, http.MethodGet, "/v1/runs/"+url.PathEscape(runID), nil, &out)
	return &out, meta, err
}

// RetryRunDelivery starts or observes one idempotent archive-delivery retry.
// Bot returns only the new pending delivery revision; scientific work is not
// resubmitted by this command.
func (c *Client) RetryRunDelivery(ctx context.Context, runID string) (*RunDelivery, error) {
	var raw json.RawMessage
	_, err := c.doJSONWithMetaOptions(
		ctx,
		http.MethodPost,
		"/v1/runs/"+url.PathEscape(runID)+"/delivery/retry",
		nil,
		&raw,
		true,
	)
	if err != nil {
		return nil, err
	}
	delivery, err := DecodeRunDelivery(raw, "", nil)
	if err != nil {
		return nil, err
	}
	if delivery.Status != "pending" {
		return nil, fmt.Errorf("delivery retry returned non-pending state")
	}
	return &delivery, nil
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
	response, _, err := c.GetAgentsWithMeta(ctx)
	if err != nil {
		return nil, err
	}
	return response, nil
}

// GetAgentsWithMeta lists the agents Bot exposes and returns response
// metadata for startup diagnostics.
func (c *Client) GetAgentsWithMeta(ctx context.Context) (*AgentsListResponse, ResponseMeta, error) {
	var out AgentsListResponse
	meta, err := c.doJSONWithMeta(ctx, http.MethodGet, "/v1/agents", nil, &out)
	return &out, meta, err
}

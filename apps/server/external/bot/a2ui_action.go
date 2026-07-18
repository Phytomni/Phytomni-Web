package bot

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
)

// A2uiActionResult is the raw Bot HTTP response for an A2UI action uplink.
// Non-2xx Bot responses are returned here (not as error) so the gateway can
// passthrough status + body unchanged.
type A2uiActionResult struct {
	Status       int
	Body         []byte
	ContentType  string
	BotRequestID string
}

// A2uiActionMaxResponseBytes bounds the completed response body returned by
// the Bot action endpoint.
const A2uiActionMaxResponseBytes int64 = 1 << 20

// ErrA2uiResponseTooLarge marks a Bot action response that exceeds the
// gateway's response body budget.
var ErrA2uiResponseTooLarge = errors.New("a2ui response too large")

// PostA2uiAction POSTs raw JSON bytes to Bot
// POST /v1/runs/{run_id}/a2ui-actions. Transport/timeout errors wrap
// ErrBotTimeout or return the dial error; every completed HTTP response
// (including 4xx/5xx) returns *A2uiActionResult with err == nil.
func (c *Client) PostA2uiAction(ctx context.Context, runID string, body []byte) (*A2uiActionResult, error) {
	path := "/v1/runs/" + url.PathEscape(runID) + "/a2ui-actions"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.userKey)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, wrapTransportError(err)
	}
	defer resp.Body.Close()
	meta := responseMeta(resp)
	raw, err := io.ReadAll(io.LimitReader(resp.Body, A2uiActionMaxResponseBytes+1))
	if err != nil {
		return nil, wrapTransportError(err)
	}
	if int64(len(raw)) > A2uiActionMaxResponseBytes {
		return nil, ErrA2uiResponseTooLarge
	}
	return &A2uiActionResult{
		Status:       resp.StatusCode,
		Body:         raw,
		ContentType:  resp.Header.Get("Content-Type"),
		BotRequestID: meta.BotRequestID,
	}, nil
}

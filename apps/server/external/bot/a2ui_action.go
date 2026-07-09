package bot

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
)

// A2uiActionResult is the raw Bot HTTP response for an A2UI action uplink.
// Non-2xx Bot responses are returned here (not as error) so the gateway can
// passthrough status + body unchanged.
type A2uiActionResult struct {
	Status      int
	Body        []byte
	ContentType string
}

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
		if isTimeoutErr(err) {
			return nil, fmt.Errorf("%w: %v", ErrBotTimeout, err)
		}
		return nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	return &A2uiActionResult{
		Status:      resp.StatusCode,
		Body:        raw,
		ContentType: resp.Header.Get("Content-Type"),
	}, nil
}

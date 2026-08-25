package bot

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strconv"
)

// GetRunEvents fetches and strictly validates one bounded history page.
func (c *Client) GetRunEvents(ctx context.Context, runID string, afterSeq int64, limit int) (*ExecutionEventPageV1, error) {
	return c.getExecutionEvents(ctx, "/v1/runs/"+url.PathEscape(runID), afterSeq, limit)
}

// GetExecutionEvents resolves a browser-known execution identity at Bot.
func (c *Client) GetExecutionEvents(ctx context.Context, executionID string, afterSeq int64, limit int) (*ExecutionEventPageV1, error) {
	return c.getExecutionEvents(ctx, "/v1/executions/"+url.PathEscape(executionID), afterSeq, limit)
}

func (c *Client) getExecutionEvents(ctx context.Context, basePath string, afterSeq int64, limit int) (*ExecutionEventPageV1, error) {
	query := url.Values{}
	query.Set("after_seq", strconv.FormatInt(afterSeq, 10))
	query.Set("limit", strconv.Itoa(limit))
	path := basePath + "/events?" + query.Encode()
	var raw json.RawMessage
	if err := c.doJSON(ctx, http.MethodGet, path, nil, &raw); err != nil {
		return nil, err
	}
	page, err := ParseExecutionEventPageV1(raw)
	if err != nil {
		return nil, err
	}
	if len(page.Items) == 0 && page.NextAfterSeq != afterSeq {
		return nil, fmt.Errorf("invalid execution event cursor")
	}
	if len(page.Items) > 0 && page.Items[0].Seq <= afterSeq {
		return nil, fmt.Errorf("stale execution event page")
	}
	return &page, nil
}

// GetRunEventProjection fetches the current validated replaceable projection.
func (c *Client) GetRunEventProjection(ctx context.Context, runID string) (*RunEventProjectionV1, error) {
	return c.getExecutionEventProjection(ctx, "/v1/runs/"+url.PathEscape(runID))
}

func (c *Client) GetExecutionEventProjection(ctx context.Context, executionID string) (*RunEventProjectionV1, error) {
	return c.getExecutionEventProjection(ctx, "/v1/executions/"+url.PathEscape(executionID))
}

func (c *Client) getExecutionEventProjection(ctx context.Context, basePath string) (*RunEventProjectionV1, error) {
	path := basePath + "/event-projection"
	var raw json.RawMessage
	if err := c.doJSON(ctx, http.MethodGet, path, nil, &raw); err != nil {
		return nil, err
	}
	projection, err := ParseRunEventProjectionV1(raw)
	if err != nil {
		return nil, err
	}
	return &projection, nil
}

// GetRunEvent fetches one validated event detail under its parent run.
func (c *Client) GetRunEvent(ctx context.Context, runID, eventID string) (*ExecutionEventV1, error) {
	return c.getExecutionEvent(ctx, "/v1/runs/"+url.PathEscape(runID), eventID)
}

func (c *Client) GetExecutionEvent(ctx context.Context, executionID, eventID string) (*ExecutionEventV1, error) {
	return c.getExecutionEvent(ctx, "/v1/executions/"+url.PathEscape(executionID), eventID)
}

func (c *Client) getExecutionEvent(ctx context.Context, basePath, eventID string) (*ExecutionEventV1, error) {
	path := basePath + "/events/" + url.PathEscape(eventID)
	var raw json.RawMessage
	if err := c.doJSON(ctx, http.MethodGet, path, nil, &raw); err != nil {
		return nil, err
	}
	event, err := ParseExecutionEventV1(raw)
	if err != nil {
		return nil, err
	}
	return &event, nil
}

// OpenRunEventStream opens Bot's resumable SSE response after one cursor.
func (c *Client) OpenRunEventStream(ctx context.Context, runID string, afterSeq int64) (io.ReadCloser, ResponseMeta, error) {
	return c.openExecutionEventStream(ctx, "/v1/runs/"+url.PathEscape(runID), afterSeq)
}

func (c *Client) OpenExecutionEventStream(ctx context.Context, executionID string, afterSeq int64) (io.ReadCloser, ResponseMeta, error) {
	return c.openExecutionEventStream(ctx, "/v1/executions/"+url.PathEscape(executionID), afterSeq)
}

func (c *Client) openExecutionEventStream(ctx context.Context, basePath string, afterSeq int64) (io.ReadCloser, ResponseMeta, error) {
	query := url.Values{}
	query.Set("after_seq", strconv.FormatInt(afterSeq, 10))
	path := basePath + "/events/stream?" + query.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, ResponseMeta{}, err
	}
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Authorization", "Bearer "+c.userKey)
	if afterSeq > 0 {
		req.Header.Set("Last-Event-ID", strconv.FormatInt(afterSeq, 10))
	}
	// A resumable SSE connection is bounded by the caller context and stream
	// protocol, not by the ordinary JSON request lifetime. Reuse the transport
	// and redirect policy while disabling http.Client's whole-response timeout.
	streamHTTP := *c.http
	streamHTTP.Timeout = 0
	resp, err := streamHTTP.Do(req)
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
		return nil, meta, preferBotRequestID(botError(http.MethodGet, path, resp.StatusCode, raw), meta.BotRequestID)
	}
	mediaType, _, parseErr := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	if parseErr != nil || mediaType != "text/event-stream" {
		resp.Body.Close()
		return nil, meta, fmt.Errorf("invalid execution stream content type")
	}
	return resp.Body, meta, nil
}

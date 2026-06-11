package bot

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
)

// OBS 中转(Bot /v1/relay/obs/*)。切流后 Web Go 不再持有华为 OBS ak/sk,
// 列目录与取文件全部经 Bot 中转完成;Bot 侧要求 key 带 relay:obs scope,
// 且部署开启 RELAY_ENABLED,否则分别返回 403 / 404。

// ListObsKeys lists object keys under prefix via the Bot OBS relay.
// Bot confines list prefixes to its user-data output root and 403s anything
// else — legacy pre-cutover paths land there by design (see IsLegacyPathErr).
func (c *Client) ListObsKeys(ctx context.Context, prefix string) ([]string, error) {
	q := url.Values{}
	q.Set("prefix", prefix)
	var out struct {
		Keys []string `json:"keys"`
	}
	if err := c.doJSON(ctx, http.MethodGet, "/v1/relay/obs/list?"+q.Encode(), nil, &out); err != nil {
		return nil, err
	}
	return out.Keys, nil
}

// GetObsObjectStream GETs one object's raw bytes from the Bot OBS relay and
// returns the body for the caller to stream through (caller closes it).
// Content length is -1 when the relay does not advertise it.
func (c *Client) GetObsObjectStream(ctx context.Context, path string) (io.ReadCloser, int64, error) {
	q := url.Values{}
	q.Set("path", path)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/v1/relay/obs/object?"+q.Encode(), nil)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+c.userKey)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, 0, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, 0, botError(http.MethodGet, "/v1/relay/obs/object", resp.StatusCode, raw)
	}
	return resp.Body, resp.ContentLength, nil
}

// IsLegacyPathErr reports whether err is the relay rejecting a path/prefix
// outside its serving root (400/403) — the signature of a pre-cutover
// download_path whose objects are no longer served (forward-only cutover,
// no historical ETL). Callers map this to a user-readable "已下线" message.
func IsLegacyPathErr(err error) bool {
	var ae *APIError
	if errors.As(err, &ae) {
		return ae.Status == http.StatusBadRequest || ae.Status == http.StatusForbidden
	}
	return false
}

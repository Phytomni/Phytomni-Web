package bot

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
)

const (
	maxInteropCapabilities = 256
	maxInteropErrors       = 256
	maxInteropIdentifier   = 64
	// InteropMaxResponseBytes bounds the complete capability envelope before
	// JSON decoding. The sentinel byte read below distinguishes an exact-limit
	// response from one that is larger without buffering an unbounded body.
	InteropMaxResponseBytes int64 = 1 << 20
)

var interopIdentifierPattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,63}$`)

// ErrInteropResponseTooLarge marks an interop discovery response that exceeds
// the Web client's bounded response budget. Callers map this to the generic
// unavailable path; no partial envelope is projected.
var ErrInteropResponseTooLarge = errors.New("interop response too large")

// InteropCapabilitiesResponse is the small portion of Bot's discovery
// envelope that Web is allowed to consume. Bot's capability records contain
// executable metadata (URLs, commands, schemas, and credential references),
// so those fields are intentionally absent rather than decoded and dropped
// later.
type InteropCapabilitiesResponse struct {
	Object string                    `json:"object"`
	Data   []InteropCapabilityRecord `json:"data"`
	Errors []InteropDiscoveryError   `json:"errors"`
}

// InteropCapabilityRecord identifies a target that returned at least one
// capability. The remote capability name and input schema are deliberately
// not part of the Web contract.
type InteropCapabilityRecord struct {
	TargetID string `json:"target_id"`
	Kind     string `json:"kind"`
}

// InteropDiscoveryError is Bot's bounded, target-level failure summary. The
// code is a stable machine label; exception text and transport details never
// cross the Go client boundary.
type InteropDiscoveryError struct {
	TargetID string `json:"target_id"`
	Kind     string `json:"kind"`
	Code     string `json:"code"`
}

// GetInteropCapabilities fetches Bot's sanitized capability envelope. The
// caller owns the Web feature and authorization gates; this method only
// performs the authenticated GET and validates the bounded public shape.
func (c *Client) GetInteropCapabilities(ctx context.Context) (*InteropCapabilitiesResponse, error) {
	const path = "/v1/interop/capabilities"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.userKey)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, wrapTransportError(err)
	}
	defer resp.Body.Close()
	meta := responseMeta(resp)
	raw, err := io.ReadAll(io.LimitReader(resp.Body, InteropMaxResponseBytes+1))
	if err != nil {
		return nil, wrapTransportError(err)
	}
	if int64(len(raw)) > InteropMaxResponseBytes {
		return nil, ErrInteropResponseTooLarge
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, preferBotRequestID(botError(http.MethodGet, path, resp.StatusCode, raw), meta.BotRequestID)
	}

	var response InteropCapabilitiesResponse
	if err := json.Unmarshal(raw, &response); err != nil {
		return nil, err
	}
	if err := validateInteropCapabilitiesResponse(&response); err != nil {
		return nil, err
	}
	return &response, nil
}

// UnmarshalJSON requires the documented list envelope instead of treating a
// missing or null data/errors array as a successful empty discovery result.
// Pointer fields preserve the distinction between an omitted/null field and
// an explicit empty JSON array.
func (response *InteropCapabilitiesResponse) UnmarshalJSON(raw []byte) error {
	var envelope struct {
		Object *string                    `json:"object"`
		Data   *[]InteropCapabilityRecord `json:"data"`
		Errors *[]InteropDiscoveryError   `json:"errors"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return err
	}
	if envelope.Object == nil || *envelope.Object != "list" || envelope.Data == nil || envelope.Errors == nil {
		return fmt.Errorf("invalid interop capability envelope")
	}
	*response = InteropCapabilitiesResponse{
		Object: *envelope.Object,
		Data:   *envelope.Data,
		Errors: *envelope.Errors,
	}
	return nil
}

func validateInteropCapabilitiesResponse(response *InteropCapabilitiesResponse) error {
	if response == nil {
		return fmt.Errorf("invalid interop capability response")
	}
	if len(response.Data) > maxInteropCapabilities || len(response.Errors) > maxInteropErrors {
		return fmt.Errorf("interop capability response exceeds limits")
	}
	for index := range response.Data {
		item := &response.Data[index]
		item.TargetID = strings.TrimSpace(item.TargetID)
		item.Kind = strings.TrimSpace(item.Kind)
		if !validInteropTargetID(item.TargetID) || !validInteropKind(item.Kind) {
			return fmt.Errorf("invalid interop capability target")
		}
	}
	for index := range response.Errors {
		item := &response.Errors[index]
		item.TargetID = strings.TrimSpace(item.TargetID)
		item.Kind = strings.TrimSpace(item.Kind)
		item.Code = strings.TrimSpace(item.Code)
		if !validInteropTargetID(item.TargetID) || !validInteropKind(item.Kind) || !validInteropCode(item.Code) {
			return fmt.Errorf("invalid interop discovery error")
		}
	}
	return nil
}

func validInteropTargetID(value string) bool {
	return len(value) <= maxInteropIdentifier && interopIdentifierPattern.MatchString(value)
}

func validInteropKind(value string) bool {
	return value == "mcp" || value == "a2a"
}

func validInteropCode(value string) bool {
	// Bot currently documents one safe machine code. Keep this vocabulary
	// explicit: regex-shaped values could still contain a credential, class,
	// or exception label that must never reach the Web DTO.
	return value == "discovery_failed"
}

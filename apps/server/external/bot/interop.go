package bot

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strings"
)

const (
	maxInteropCapabilities = 256
	maxInteropErrors       = 256
	maxInteropIdentifier   = 64
	maxInteropCode         = 64
)

var interopIdentifierPattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,63}$`)
var interopCodePattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,63}$`)

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
	var response InteropCapabilitiesResponse
	if _, err := c.doJSONWithMeta(ctx, http.MethodGet, "/v1/interop/capabilities", nil, &response); err != nil {
		return nil, err
	}
	if err := validateInteropCapabilitiesResponse(&response); err != nil {
		return nil, err
	}
	return &response, nil
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
	return len(value) <= maxInteropCode && interopCodePattern.MatchString(value)
}

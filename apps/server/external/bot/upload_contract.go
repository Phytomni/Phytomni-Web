package bot

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

const (
	maxResumableUploadFileBytes int64 = 10 << 30
	maxResumableUploadPartCount       = 100000
	maxUploadCapabilityBytes          = 4096
	maxUploadTimestampBytes           = 128
)

// UploadCreateRequest is the metadata-only control request sent from Web Go
// to Bot. OwnerSubject is always derived by Web Go; it is never accepted from
// the browser.
type UploadCreateRequest struct {
	OwnerSubject   string `json:"owner_subject"`
	Filename       string `json:"filename"`
	SizeBytes      int64  `json:"size_bytes"`
	ContentType    string `json:"content_type_hint,omitempty"`
	LastModified   int64  `json:"last_modified_ms,omitempty"`
	Purpose        string `json:"purpose"`
	IdempotencyKey string `json:"idempotency_key"`
}

// UploadCreateResponse is the safe upload session envelope. It intentionally
// contains no OBS bucket, object key, multipart upload ID, signed cloud URL,
// or generic filesystem path.
type UploadCreateResponse struct {
	Protocol            string `json:"protocol"`
	AssetID             string `json:"asset_id"`
	Status              string `json:"status"`
	PartSizeBytes       int64  `json:"part_size_bytes"`
	PartCount           int    `json:"part_count"`
	MaxParallelParts    int    `json:"max_parallel_parts"`
	UploadURL           string `json:"upload_url"`
	Capability          string `json:"capability"`
	CapabilityExpiresAt string `json:"capability_expires_at"`
	SessionExpiresAt    string `json:"session_expires_at"`
}

// UploadCapabilityRenewRequest is the trusted owner assertion for a renewal.
type UploadCapabilityRenewRequest struct {
	OwnerSubject string `json:"owner_subject"`
}

// UploadCapabilityResponse is the safe capability renewal envelope.
type UploadCapabilityResponse struct {
	Protocol            string `json:"protocol"`
	AssetID             string `json:"asset_id"`
	Status              string `json:"status"`
	UploadURL           string `json:"upload_url"`
	Capability          string `json:"capability"`
	CapabilityExpiresAt string `json:"capability_expires_at"`
	SessionExpiresAt    string `json:"session_expires_at"`
}

// CreateUpload asks Bot to allocate an owner-scoped resumable upload session.
// The request is JSON metadata only; file bytes never enter this client.
func (c *Client) CreateUpload(ctx context.Context, in UploadCreateRequest) (*UploadCreateResponse, ResponseMeta, error) {
	if err := validateUploadCreateRequest(in); err != nil {
		return nil, ResponseMeta{}, err
	}
	var out UploadCreateResponse
	meta, err := c.doJSONWithMetaOptions(ctx, http.MethodPost, "/v1/files", in, &out, true)
	if err != nil {
		return nil, meta, err
	}
	if err := validateUploadCreateResponse(in, out); err != nil {
		return nil, meta, err
	}
	return &out, meta, nil
}

// RenewUploadCapability asks Bot for a fresh single-asset browser capability.
// AssetID is validated before it is placed in the URL path.
func (c *Client) RenewUploadCapability(ctx context.Context, assetID, ownerSubject string) (*UploadCapabilityResponse, ResponseMeta, error) {
	if err := validateAssetID(assetID); err != nil {
		return nil, ResponseMeta{}, err
	}
	if err := validateOwnerSubject(ownerSubject); err != nil {
		return nil, ResponseMeta{}, err
	}
	var out UploadCapabilityResponse
	path := "/v1/files/" + assetID + "/capability"
	meta, err := c.doJSONWithMetaOptions(
		ctx,
		http.MethodPost,
		path,
		UploadCapabilityRenewRequest{OwnerSubject: ownerSubject},
		&out,
		true,
	)
	if err != nil {
		return nil, meta, err
	}
	if err := validateUploadCapabilityResponse(assetID, out); err != nil {
		return nil, meta, err
	}
	return &out, meta, nil
}

func validateUploadCreateRequest(in UploadCreateRequest) error {
	if err := validateOwnerSubject(in.OwnerSubject); err != nil {
		return err
	}
	if !utf8.ValidString(in.Filename) || strings.TrimSpace(in.Filename) == "" || len([]byte(in.Filename)) > 255 {
		return errors.New("invalid upload filename")
	}
	if in.SizeBytes < 1 || in.SizeBytes > maxResumableUploadFileBytes {
		return errors.New("invalid upload size")
	}
	if in.ContentType != "" && (!utf8.ValidString(in.ContentType) || len([]byte(in.ContentType)) > 256) {
		return errors.New("invalid upload content type")
	}
	if in.LastModified < 0 {
		return errors.New("invalid upload last-modified timestamp")
	}
	if in.Purpose != "chat_attachment" {
		return errors.New("invalid upload purpose")
	}
	if _, err := uuid.Parse(in.IdempotencyKey); err != nil {
		return errors.New("invalid upload idempotency key")
	}
	return nil
}

func validateOwnerSubject(subject string) error {
	if !utf8.ValidString(subject) || strings.TrimSpace(subject) == "" || len([]byte(subject)) > 320 {
		return errors.New("invalid upload owner subject")
	}
	for _, r := range subject {
		if r < 0x20 || r == 0x7f {
			return errors.New("invalid upload owner subject")
		}
	}
	return nil
}

func validateUploadCreateResponse(in UploadCreateRequest, out UploadCreateResponse) error {
	if err := validateUploadIdentity(out.Protocol, out.AssetID, out.Status); err != nil {
		return err
	}
	if out.PartSizeBytes < 1 || out.PartSizeBytes > maxResumableUploadFileBytes {
		return errors.New("invalid upload part size")
	}
	expectedParts := (in.SizeBytes + out.PartSizeBytes - 1) / out.PartSizeBytes
	if expectedParts < 1 || expectedParts > maxResumableUploadPartCount || int64(out.PartCount) != expectedParts {
		return errors.New("invalid upload part count")
	}
	if out.MaxParallelParts < 1 || out.MaxParallelParts > 4 {
		return errors.New("invalid upload part concurrency")
	}
	if err := validateUploadURL(out.UploadURL, out.AssetID); err != nil {
		return err
	}
	if err := validateCapability(out.Capability); err != nil {
		return err
	}
	return validateUploadTimestamps(out.CapabilityExpiresAt, out.SessionExpiresAt)
}

func validateUploadCapabilityResponse(assetID string, out UploadCapabilityResponse) error {
	if err := validateAssetID(assetID); err != nil {
		return err
	}
	if err := validateUploadIdentity(out.Protocol, out.AssetID, out.Status); err != nil {
		return err
	}
	if out.AssetID != assetID {
		return errors.New("upload capability asset mismatch")
	}
	if err := validateUploadURL(out.UploadURL, out.AssetID); err != nil {
		return err
	}
	if err := validateCapability(out.Capability); err != nil {
		return err
	}
	return validateUploadTimestamps(out.CapabilityExpiresAt, out.SessionExpiresAt)
}

func validateUploadIdentity(protocol, assetID, status string) error {
	if protocol != ResumableUploadProtocol {
		return fmt.Errorf("unsupported upload protocol %q", protocol)
	}
	if err := validateAssetID(assetID); err != nil {
		return err
	}
	if status != "uploading" {
		return fmt.Errorf("invalid upload status %q", status)
	}
	return nil
}

func validateAssetID(assetID string) error {
	if len(assetID) < len("file_")+1 || len(assetID) > 128 || !strings.HasPrefix(assetID, "file_") {
		return errors.New("invalid upload asset id")
	}
	for _, r := range assetID[len("file_"):] {
		if (r < 'a' || r > 'z') && (r < 'A' || r > 'Z') && (r < '0' || r > '9') && r != '_' && r != '-' {
			return errors.New("invalid upload asset id")
		}
	}
	return nil
}

// ValidateAssetAttachmentRefs returns a detached, ordered copy of refs after
// enforcing the reference-only Chat/Agent contract. Asset ownership is
// checked later by Bot's AssetResolver; this helper only rejects malformed,
// duplicated, or unbounded identifiers at the Web boundary.
func ValidateAssetAttachmentRefs(refs []AssetAttachmentRef) ([]AssetAttachmentRef, error) {
	if len(refs) > MaxAssetAttachmentRefs {
		return nil, fmt.Errorf("too many asset attachments")
	}
	copyRefs := make([]AssetAttachmentRef, len(refs))
	copy(copyRefs, refs)
	seen := make(map[string]struct{}, len(copyRefs))
	for index, ref := range copyRefs {
		if err := validateAssetID(ref.AssetID); err != nil {
			return nil, fmt.Errorf("attachment %d: %w", index, err)
		}
		if _, exists := seen[ref.AssetID]; exists {
			return nil, fmt.Errorf("duplicate asset attachment %q", ref.AssetID)
		}
		seen[ref.AssetID] = struct{}{}
	}
	return copyRefs, nil
}

func validateCapability(capability string) error {
	if capability == "" || len([]byte(capability)) > maxUploadCapabilityBytes || !utf8.ValidString(capability) {
		return errors.New("invalid upload capability")
	}
	for _, r := range capability {
		if r < 0x21 || r == 0x7f {
			return errors.New("invalid upload capability")
		}
	}
	return nil
}

func validateUploadTimestamps(capabilityExpiresAt, sessionExpiresAt string) error {
	if len(capabilityExpiresAt) > maxUploadTimestampBytes || len(sessionExpiresAt) > maxUploadTimestampBytes {
		return errors.New("invalid upload expiration timestamp")
	}
	capabilityExpiry, err := time.Parse(time.RFC3339, capabilityExpiresAt)
	if err != nil {
		return errors.New("invalid upload capability expiration timestamp")
	}
	sessionExpiry, err := time.Parse(time.RFC3339, sessionExpiresAt)
	if err != nil {
		return errors.New("invalid upload session expiration timestamp")
	}
	now := time.Now()
	if !capabilityExpiry.After(now) || !sessionExpiry.After(capabilityExpiry) {
		return errors.New("upload expiration timestamps are not ordered")
	}
	return nil
}

func validateUploadURL(raw, assetID string) error {
	u, err := url.ParseRequestURI(raw)
	if err != nil || u == nil || u.Opaque != "" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.ForceQuery {
		return errors.New("invalid upload URL")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return errors.New("invalid upload URL")
	}
	if u.Path == "" || !strings.HasSuffix(strings.TrimRight(u.Path, "/"), "/"+assetID) {
		return errors.New("upload URL does not match asset")
	}
	return nil
}

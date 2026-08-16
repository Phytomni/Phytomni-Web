package api_service

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"golang.org/x/text/unicode/norm"

	rxBot "phytomni-server/external/bot"
	rxLog "phytomni-server/log"
)

const (
	maxUploadFilenameBytes    = 255
	maxUploadContentTypeBytes = 256
	uploadCompensationTimeout = 5 * time.Second
)

var (
	// ErrUploadControlDisabled is returned while the negotiated control plane
	// is unavailable. It deliberately contains no Bot or configuration detail.
	ErrUploadControlDisabled = errors.New("upload control disabled")
	// ErrUploadMetadataInvalid marks browser metadata that cannot be accepted.
	ErrUploadMetadataInvalid = errors.New("invalid upload metadata")
	// ErrUploadControlUnavailable covers transport and contract failures after
	// the local request has passed validation.
	ErrUploadControlUnavailable = errors.New("upload control unavailable")
	// ErrUploadStateConflict marks Bot's exact upload-state conflict response.
	ErrUploadStateConflict = errors.New("upload state conflict")
	// ErrUploadSessionExpired marks Bot's exact expired-session response.
	ErrUploadSessionExpired = errors.New("upload session expired")
	// ErrUploadLimitExceeded marks Bot's exact upload-quota response.
	ErrUploadLimitExceeded = errors.New("upload limit exceeded")

	errUploadResponseOriginMismatch = errors.New("upload response origin mismatch")
)

// UploadCreateInput contains the only metadata accepted from the browser.
// OwnerSubject and idempotency ownership are supplied by Web Go.
type UploadCreateInput struct {
	Filename     string
	SizeBytes    int64
	ContentType  string
	LastModified int64
}

// UploadCreateResult is the safe browser-facing upload session envelope. It
// contains the opaque capability needed by the direct data plane, but no OBS
// bucket, object key, multipart upload ID, or Huawei credential.
type UploadCreateResult struct {
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

// UploadCapabilityResult is the safe browser-facing renewal envelope.
type UploadCapabilityResult struct {
	Protocol            string `json:"protocol"`
	AssetID             string `json:"asset_id"`
	Status              string `json:"status"`
	UploadURL           string `json:"upload_url"`
	Capability          string `json:"capability"`
	CapabilityExpiresAt string `json:"capability_expires_at"`
	SessionExpiresAt    string `json:"session_expires_at"`
}

// CreateUpload validates browser metadata, derives the Bot owner and purpose,
// then asks Bot to allocate a resumable upload session without receiving any
// file bytes.
func (ps *Service) CreateUpload(ctx context.Context, ownerSubject string, input UploadCreateInput, idempotencyKey string) (*UploadCreateResult, error) {
	owner, err := validateUploadOwner(ownerSubject)
	if err != nil {
		return nil, err
	}
	filename, err := normalizeUploadFilename(input.Filename)
	if err != nil {
		return nil, err
	}
	purpose, err := classifyAttachmentFilename(filename)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrUploadMetadataInvalid, err)
	}
	if input.SizeBytes < 1 || input.SizeBytes > resumableUploadMaxFileBytes {
		return nil, fmt.Errorf("%w: size", ErrUploadMetadataInvalid)
	}
	contentType, err := validateUploadContentType(input.ContentType)
	if err != nil {
		return nil, err
	}
	if input.LastModified < 0 {
		return nil, fmt.Errorf("%w: last_modified_ms", ErrUploadMetadataInvalid)
	}
	idempotency, err := normalizeUploadIdempotencyKey(idempotencyKey)
	if err != nil {
		return nil, err
	}

	if ctx == nil {
		ctx = context.Background()
	}
	origin, err := ps.uploadControlOrigin(ctx)
	if err != nil {
		return nil, err
	}
	client := rxBot.NewClient()
	out, _, err := client.CreateUpload(ctx, rxBot.UploadCreateRequest{
		OwnerSubject:   owner,
		Filename:       filename,
		SizeBytes:      input.SizeBytes,
		ContentType:    contentType,
		LastModified:   input.LastModified,
		Purpose:        string(purpose),
		IdempotencyKey: idempotency,
	})
	if err != nil {
		return nil, classifyUploadControlError(err, "create")
	}
	if err := validateUploadResponseURL(out.UploadURL, origin, out.AssetID); err != nil {
		if errors.Is(err, errUploadResponseOriginMismatch) {
			compensateRejectedUpload(ctx, client, out.AssetID, out.Capability)
		}
		return nil, fmt.Errorf("%w: create response", ErrUploadControlUnavailable)
	}
	return &UploadCreateResult{
		Protocol:            out.Protocol,
		AssetID:             out.AssetID,
		Status:              out.Status,
		PartSizeBytes:       out.PartSizeBytes,
		PartCount:           out.PartCount,
		MaxParallelParts:    out.MaxParallelParts,
		UploadURL:           out.UploadURL,
		Capability:          out.Capability,
		CapabilityExpiresAt: out.CapabilityExpiresAt,
		SessionExpiresAt:    out.SessionExpiresAt,
	}, nil
}

// RenewUploadCapability derives the owner from Web authentication and asks
// Bot for a fresh capability for one already-created asset.
func (ps *Service) RenewUploadCapability(ctx context.Context, ownerSubject, assetID string) (*UploadCapabilityResult, error) {
	owner, err := validateUploadOwner(ownerSubject)
	if err != nil {
		return nil, err
	}
	if !validUploadAssetID(assetID) {
		return nil, fmt.Errorf("%w: asset_id", ErrUploadMetadataInvalid)
	}
	origin, err := ps.uploadControlOrigin(ctx)
	if err != nil {
		return nil, err
	}
	if ctx == nil {
		ctx = context.Background()
	}
	out, _, err := rxBot.NewClient().RenewUploadCapability(ctx, assetID, owner)
	if err != nil {
		return nil, classifyUploadControlError(err, "renew")
	}
	if err := validateUploadResponseURL(out.UploadURL, origin, out.AssetID); err != nil {
		return nil, fmt.Errorf("%w: renew response", ErrUploadControlUnavailable)
	}
	return &UploadCapabilityResult{
		Protocol:            out.Protocol,
		AssetID:             out.AssetID,
		Status:              out.Status,
		UploadURL:           out.UploadURL,
		Capability:          out.Capability,
		CapabilityExpiresAt: out.CapabilityExpiresAt,
		SessionExpiresAt:    out.SessionExpiresAt,
	}, nil
}

func classifyUploadControlError(err error, operation string) error {
	sentinel := ErrUploadControlUnavailable
	category := "upload_control_unavailable"
	var apiErr *rxBot.APIError
	if errors.As(err, &apiErr) {
		switch {
		case apiErr.Status == 409 && apiErr.Code == "upload_state_conflict":
			sentinel = ErrUploadStateConflict
			category = "upload_state_conflict"
		case apiErr.Status == 410 && apiErr.Code == "upload_session_expired":
			sentinel = ErrUploadSessionExpired
			category = "upload_session_expired"
		case apiErr.Status == 413 && apiErr.Code == "upload_limit_exceeded":
			sentinel = ErrUploadLimitExceeded
			category = "upload_limit_exceeded"
		}
	}
	rxLog.Sugar().Warnw(
		"upload control error classified",
		"operation", operation,
		"category", category,
	)
	return fmt.Errorf("%w: %s", sentinel, operation)
}

func compensateRejectedUpload(ctx context.Context, client *rxBot.Client, assetID, capability string) {
	rxLog.Sugar().Info("upload compensation attempted")
	compensationCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), uploadCompensationTimeout)
	defer cancel()
	if _, _, err := client.AbortUpload(compensationCtx, assetID, capability); err != nil {
		rxLog.Sugar().Warn("upload compensation failed")
		return
	}
	rxLog.Sugar().Info("upload compensation succeeded")
}

func (ps *Service) uploadControlOrigin(ctx context.Context) (string, error) {
	cfg := rxBot.BotConfig
	if cfg == nil || !cfg.ProxyEnabled {
		return "", ErrUploadControlDisabled
	}
	origin, validOrigin := validUploadPublicOrigin(cfg.UploadPublicOrigin)
	if !validOrigin {
		return "", ErrUploadControlDisabled
	}
	manifest, err := ps.BotCapabilities(ctx, "")
	if err != nil || !manifest.Upload.Enabled {
		return "", ErrUploadControlDisabled
	}
	return origin, nil
}

func validateUploadOwner(raw string) (string, error) {
	if !utf8.ValidString(raw) || strings.TrimSpace(raw) == "" || len([]byte(raw)) > 320 {
		return "", fmt.Errorf("%w: owner", ErrUploadMetadataInvalid)
	}
	for _, r := range raw {
		if r < 0x20 || r == 0x7f {
			return "", fmt.Errorf("%w: owner", ErrUploadMetadataInvalid)
		}
	}
	return raw, nil
}

func normalizeUploadFilename(raw string) (string, error) {
	if !utf8.ValidString(raw) {
		return "", fmt.Errorf("%w: filename", ErrUploadMetadataInvalid)
	}
	filename := norm.NFC.String(raw)
	if filename == "" || len([]byte(filename)) > maxUploadFilenameBytes || filename == "." || filename == ".." {
		return "", fmt.Errorf("%w: filename", ErrUploadMetadataInvalid)
	}
	for _, r := range filename {
		if r < 0x20 || r == 0x7f || r == '/' || r == '\\' {
			return "", fmt.Errorf("%w: filename", ErrUploadMetadataInvalid)
		}
	}
	return filename, nil
}

func validateUploadContentType(raw string) (string, error) {
	if !utf8.ValidString(raw) || len([]byte(raw)) > maxUploadContentTypeBytes {
		return "", fmt.Errorf("%w: content_type_hint", ErrUploadMetadataInvalid)
	}
	for _, r := range raw {
		if r < 0x20 || r == 0x7f {
			return "", fmt.Errorf("%w: content_type_hint", ErrUploadMetadataInvalid)
		}
	}
	return raw, nil
}

func normalizeUploadIdempotencyKey(raw string) (string, error) {
	id, err := uuid.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", fmt.Errorf("%w: idempotency key", ErrUploadMetadataInvalid)
	}
	return id.String(), nil
}

func validUploadAssetID(assetID string) bool {
	if len(assetID) < len("file_")+1 || len(assetID) > 128 || !strings.HasPrefix(assetID, "file_") {
		return false
	}
	for _, r := range assetID[len("file_"):] {
		if (r < 'a' || r > 'z') && (r < 'A' || r > 'Z') && (r < '0' || r > '9') && r != '_' && r != '-' {
			return false
		}
	}
	return true
}

func validateUploadResponseURL(raw, expectedOrigin, assetID string) error {
	if !validUploadAssetID(assetID) {
		return errors.New("invalid upload asset id")
	}
	u, err := url.ParseRequestURI(raw)
	if err != nil || u == nil || u.Opaque != "" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.ForceQuery || u.RawPath != "" {
		return errors.New("invalid upload URL")
	}
	if u.Path != "/v1/files/"+assetID {
		return errors.New("upload URL does not match asset")
	}
	responseOrigin, ok := validUploadPublicOrigin(u.Scheme + "://" + u.Host)
	if !ok || !strings.EqualFold(responseOrigin, expectedOrigin) {
		return errUploadResponseOriginMismatch
	}
	return nil
}

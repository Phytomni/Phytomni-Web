package mdoc

import (
	"bytes"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"strings"
)

func detectImageMIME(data []byte) string {
	switch {
	case bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n")):
		return "image/png"
	case bytes.HasPrefix(data, []byte("\xff\xd8\xff")):
		return "image/jpeg"
	case bytes.HasPrefix(data, []byte("GIF87a")) || bytes.HasPrefix(data, []byte("GIF89a")):
		return "image/gif"
	case len(data) >= 12 && string(data[0:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		return "image/webp"
	case bytes.HasPrefix(data, []byte("BM")):
		return "image/bmp"
	default:
		return ""
	}
}

func embeddableImage(data []byte) *Image {
	mime := detectImageMIME(data)
	switch mime {
	case "image/png", "image/jpeg", "image/gif":
		return &Image{Bytes: data, MIME: mime}
	default:
		return nil
	}
}

func imageExt(mime string) string {
	switch mime {
	case "image/jpeg":
		return ".jpg"
	case "image/gif":
		return ".gif"
	default:
		return ".png"
	}
}

func pdfImageType(mime string) string {
	switch mime {
	case "image/jpeg":
		return "JPG"
	case "image/gif":
		return "GIF"
	default:
		return "PNG"
	}
}

func imageSize(img *Image) (width, height int) {
	if img == nil {
		return 0, 0
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(img.Bytes))
	if err != nil {
		return 0, 0
	}
	return cfg.Width, cfg.Height
}

func scaleTo(width, height int, maxW, maxH float64) (w, h float64) {
	if width <= 0 || height <= 0 {
		return maxW, maxW * 0.6
	}
	w = float64(width)
	h = float64(height)
	ratio := w / h
	if w > maxW {
		w = maxW
		h = w / ratio
	}
	if h > maxH {
		h = maxH
		w = h * ratio
	}
	return w, h
}

func displayLink(href string) string {
	trimmed := strings.TrimSpace(href)
	lower := strings.ToLower(trimmed)
	if strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://") {
		if strings.ContainsAny(trimmed, " \t\r\n") {
			return ""
		}
		return trimmed
	}
	return ""
}

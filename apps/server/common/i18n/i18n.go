package i18n

import (
	"log"
	"regexp"
	"sync"

	"github.com/BurntSushi/toml"
	ginI18n "github.com/gin-contrib/i18n"
	"github.com/gin-gonic/gin"
	goI18n "github.com/nicksnyder/go-i18n/v2/i18n"
	"golang.org/x/text/language"
)

var (
	bundleOnce sync.Once
	bundle     *goI18n.Bundle
)

// Localize is the Gin middleware that binds an *i18n.Localizer to *gin.Context
// based on the request's Accept-Language header. Default fallback is English
// (en-US) — explicit operator decision (forward-facing default).
//
// gin-contrib/i18n v1.3.0 composes the bundle-file path as
// path.Join(RootPath, lng.String()) + "." + FormatBundleFile, so the
// AcceptLanguage tags must be the BCP-47 region-qualified forms
// ("zh-CN" / "en-US") that match the on-disk TOML filenames inside
// common/i18n/locales/.
func Localize() gin.HandlerFunc {
	bundleOnce.Do(initBundle)
	return ginI18n.Localize(
		ginI18n.WithBundle(&ginI18n.BundleCfg{
			DefaultLanguage:  language.Make("en-US"),
			AcceptLanguage:   []language.Tag{language.Make("zh-CN"), language.Make("en-US")},
			FormatBundleFile: "toml",
			RootPath:         "locales",
			UnmarshalFunc:    toml.Unmarshal,
			Loader:           &ginI18n.EmbedLoader{FS: localeFS},
		}),
	)
}

func initBundle() {
	bundle = goI18n.NewBundle(language.Make("en-US"))
	bundle.RegisterUnmarshalFunc("toml", toml.Unmarshal)
	for _, lang := range []string{"zh-CN", "en-US"} {
		path := "locales/" + lang + ".toml"
		if _, err := bundle.LoadMessageFileFS(localeFS, path); err != nil {
			log.Fatalf("i18n: failed to load %s: %v", path, err)
		}
	}
}

// T returns the localized message for key. If the key is missing in the
// resolved locale, it falls back to English; if that's also missing it
// returns the key itself and logs a warning. Never panics.
func T(c *gin.Context, key string, args ...interface{}) string {
	var param interface{} = key
	if len(args) > 0 {
		switch a := args[0].(type) {
		case *goI18n.LocalizeConfig:
			if a == nil {
				param = key
			} else {
				cfg := *a
				if cfg.MessageID == "" {
					cfg.MessageID = key
				}
				param = &cfg
			}
		case map[string]string:
			param = &goI18n.LocalizeConfig{
				MessageID:    key,
				TemplateData: a,
			}
		case map[string]interface{}:
			param = &goI18n.LocalizeConfig{
				MessageID:    key,
				TemplateData: a,
			}
		default:
			param = &goI18n.LocalizeConfig{
				MessageID:    key,
				TemplateData: a,
			}
		}
	}
	msg, err := ginI18n.GetMessage(c, param)
	if err != nil || msg == "" {
		log.Printf("[i18n] missing key %q: %v", key, err)
		return key
	}
	return msg
}

// keyShape matches an i18n key like "auth.user_not_found" — one or more
// dot-separated lowercase/underscore/digit segments, at least two segments.
// A single segment ("error") or any uppercase/space/punctuation content
// (raw GORM/network errors) is treated as a non-key and skipped by TMaybe.
var keyShape = regexp.MustCompile(`^[a-z_]+(\.[a-z0-9_]+)+$`)

// TMaybe translates s only when it looks like an i18n key; otherwise it
// returns s verbatim WITHOUT emitting a missing-key warning. Use it at the
// handler boundary for err.Error() passthroughs: a service-layer error
// carrying an i18n key gets localized, while a raw internal error (GORM,
// network, etc.) flows through untouched and un-logged. This generalizes
// the existing auth.go pattern (i18n.T on err.Error()) so that non-key
// errors no longer trigger missing-key log spam.
func TMaybe(c *gin.Context, s string) string {
	if keyShape.MatchString(s) {
		return T(c, s)
	}
	return s
}

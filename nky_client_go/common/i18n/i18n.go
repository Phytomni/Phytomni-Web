package i18n

import (
	"log"
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
	msg, err := ginI18n.GetMessage(c, key)
	if err != nil || msg == "" {
		log.Printf("[i18n] missing key %q: %v", key, err)
		return key
	}
	_ = args // plumbed; current messages have no interpolation
	return msg
}

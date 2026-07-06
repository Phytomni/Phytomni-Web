package api_service

import (
	"context"
	"errors"
	rxCron "phytomni-server/cron/base"
	"phytomni-server/model"
)

// ErrCronEntriesForbidden indicates the caller is not authorised to inspect the
// cron schedule. The schedule exposes internal job timing and registered specs,
// which is restricted to admin queries only. The handler maps this error to 403.
var ErrCronEntriesForbidden = errors.New("not authorized to access cron entries")

// CronEntryView is the read-only projection of a scheduled entry: the next and
// previous run times, formatted for display. Specs and job handles are omitted
// so the endpoint leaks no internal wiring beyond timing.
type CronEntryView struct {
	Next string `json:"next"`
	Prev string `json:"prev"`
}

// GetCronEntries returns a snapshot of every scheduled entry across all started
// cron schedulers. Authorisation is admin-only and mirrors the operation-log
// admin boundary: a non-admin or unknown operator gets ErrCronEntriesForbidden.
func (ps *Service) GetCronEntries(ctx context.Context, operatorName string) ([]CronEntryView, error) {
	// Authorisation gate: schedule inspection is admin-only.
	var operator *model.User
	if err := model.DB(ctx).Model(&model.User{}).Where("email = ?", operatorName).First(&operator).Error; err != nil {
		return nil, ErrCronEntriesForbidden
	}
	if operator.Code != "admin" && operator.Code != "super_admin" {
		return nil, ErrCronEntriesForbidden
	}

	var out []CronEntryView
	for _, e := range rxCron.Entries() {
		out = append(out, CronEntryView{
			Next: e.Next.Format("2006-01-02 15:04:05"),
			Prev: e.Prev.Format("2006-01-02 15:04:05"),
		})
	}
	return out, nil
}

package api_service

import (
	"context"
	"sync"
	"time"

	"phytomni-server/model"
)

const (
	metricAdmissionCommitted   = "admission_committed"
	metricAdmissionDuplicate   = "admission_duplicate"
	metricDispatchClaimed      = "dispatch_claimed"
	metricDispatchAcknowledged = "dispatch_acknowledged"
	metricDispatchRetried      = "dispatch_retried"
	metricDispatchReconciled   = "dispatch_reconciled"
	metricDispatchRejected     = "dispatch_rejected"
	metricDispatchDeadLettered = "dispatch_dead_lettered"
	metricProjectionClaimed    = "projection_claimed"
	metricProjectionCommitted  = "projection_committed"
	metricProjectionFailed     = "projection_failed"
	metricLeaseStolen          = "lease_stolen"
	metricStreamGap            = "stream_gap"
	metricCompatibilityRead    = "compatibility_read"
)

var executionMetricLabels = []string{
	metricAdmissionCommitted, metricAdmissionDuplicate,
	metricDispatchClaimed, metricDispatchAcknowledged, metricDispatchRetried,
	metricDispatchReconciled, metricDispatchRejected, metricDispatchDeadLettered,
	metricProjectionClaimed, metricProjectionCommitted,
	metricProjectionFailed, metricLeaseStolen, metricStreamGap, metricCompatibilityRead,
}

var executionMetricsV2 = struct {
	sync.Mutex
	counts map[string]uint64
}{counts: map[string]uint64{}}

func observeExecutionMetricV2(label string) {
	executionMetricsV2.Lock()
	defer executionMetricsV2.Unlock()
	for _, allowed := range executionMetricLabels {
		if label == allowed {
			executionMetricsV2.counts[label]++
			return
		}
	}
	panic("unknown execution metric label")
}

func executionMetricSnapshotV2() map[string]uint64 {
	executionMetricsV2.Lock()
	defer executionMetricsV2.Unlock()
	out := make(map[string]uint64, len(executionMetricLabels))
	for _, label := range executionMetricLabels {
		out[label] = executionMetricsV2.counts[label]
	}
	return out
}

type ExecutionRuntimeMetricsV2 struct {
	Counters                 map[string]uint64 `json:"counters"`
	PendingDispatch          int64             `json:"pending_dispatch"`
	ReconcileDispatch        int64             `json:"reconcile_dispatch"`
	RejectedDispatch         int64             `json:"rejected_dispatch"`
	DeadLetterDispatch       int64             `json:"dead_letter_dispatch"`
	DueProjection            int64             `json:"due_projection"`
	DegradedProjection       int64             `json:"degraded_projection"`
	OldestDispatchLagSeconds int64             `json:"oldest_dispatch_lag_seconds"`
	OldestProjectionLagSecs  int64             `json:"oldest_projection_lag_seconds"`
}

func (ps *Service) GetExecutionRuntimeMetricsV2(ctx context.Context, operatorName string) (ExecutionRuntimeMetricsV2, error) {
	if err := authorizeExecutionOperator(ctx, operatorName); err != nil {
		return ExecutionRuntimeMetricsV2{}, err
	}
	now := time.Now().UTC()
	metrics := ExecutionRuntimeMetricsV2{Counters: executionMetricSnapshotV2()}
	db := model.DB(ctx).WithContext(ctx)
	if err := db.Model(&model.QuestionAgentExecutionOutbox{}).Where("state IN ?", []string{"pending", "retry", "processing"}).Count(&metrics.PendingDispatch).Error; err != nil {
		return ExecutionRuntimeMetricsV2{}, err
	}
	if err := db.Model(&model.QuestionAgentExecutionOutbox{}).Where("state = ?", "dead_letter").Count(&metrics.DeadLetterDispatch).Error; err != nil {
		return ExecutionRuntimeMetricsV2{}, err
	}
	if err := db.Model(&model.QuestionAgentExecutionOutbox{}).Where("state = ?", "reconcile").Count(&metrics.ReconcileDispatch).Error; err != nil {
		return ExecutionRuntimeMetricsV2{}, err
	}
	if err := db.Model(&model.QuestionAgentExecutionOutbox{}).Where("state = ?", "rejected").Count(&metrics.RejectedDispatch).Error; err != nil {
		return ExecutionRuntimeMetricsV2{}, err
	}
	projectionEligible := "terminal_status IS NULL AND (bot_run_id IS NOT NULL OR EXISTS (SELECT 1 FROM question_agent_execution_outbox o WHERE o.user_name = question_agent_execution_admissions.user_name AND o.execution_id = question_agent_execution_admissions.execution_id AND o.state = 'reconcile'))"
	if err := db.Model(&model.QuestionAgentExecutionAdmission{}).Where(projectionEligible+" AND (next_projection_at IS NULL OR next_projection_at <= ?)", now).Count(&metrics.DueProjection).Error; err != nil {
		return ExecutionRuntimeMetricsV2{}, err
	}
	if err := db.Model(&model.QuestionAgentExecutionAdmission{}).Where("terminal_status IS NULL AND tracking_health = ?", "degraded").Count(&metrics.DegradedProjection).Error; err != nil {
		return ExecutionRuntimeMetricsV2{}, err
	}
	var oldestDispatch *time.Time
	if err := db.Model(&model.QuestionAgentExecutionOutbox{}).Select("MIN(next_attempt_at)").Where("state IN ?", []string{"pending", "retry", "processing"}).Scan(&oldestDispatch).Error; err != nil {
		return ExecutionRuntimeMetricsV2{}, err
	}
	if oldestDispatch != nil && oldestDispatch.Before(now) {
		metrics.OldestDispatchLagSeconds = int64(now.Sub(*oldestDispatch).Seconds())
	}
	var oldestProjection *time.Time
	if err := db.Model(&model.QuestionAgentExecutionAdmission{}).Select("MIN(next_projection_at)").Where(projectionEligible).Scan(&oldestProjection).Error; err != nil {
		return ExecutionRuntimeMetricsV2{}, err
	}
	if oldestProjection != nil && oldestProjection.Before(now) {
		metrics.OldestProjectionLagSecs = int64(now.Sub(*oldestProjection).Seconds())
	}
	return metrics, nil
}

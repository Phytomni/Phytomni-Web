package api_service

import (
	"context"
	"testing"
	"time"

	"phytomni-server/model"
)

func admitV2TurnForTest(
	t *testing.T,
	service *Service,
	in QueryInput,
	target v1SubmissionTarget,
	conversation bool,
) *v1Submission {
	t.Helper()
	result, err := service.admitExecutionCommand(
		context.Background(), "alice", in, target,
		AgentPermissionResolution{AllowedTools: []string{"ChatAgent"}},
		conversation, "chat",
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.turn == nil {
		t.Fatalf("missing canonical V2 turn: %#v", result)
	}
	return result
}

func TestConversationTurnV2PreservesFollowUpContextWithoutLegacyWrites(t *testing.T) {
	setupExecutionRuntimeV2DB(t)
	service := NewService()
	firstInput := QueryInput{
		Query: "first", Mode: "instant", Tool: "ChatAgent",
		ClientTurnID: "turn-context-first", Locale: "en-US", Surface: QuerySurfaceChat,
	}
	firstTarget := v1SubmissionTarget{
		dialogueID: "11111111-1111-4111-8111-111111111111", mode: "instant", operation: "append",
	}
	first := admitV2TurnForTest(t, service, firstInput, firstTarget, true)
	now := time.Now().UTC()
	if err := model.DB(context.Background()).Model(&model.ConversationTurnV2{}).
		Where("id = ?", first.turn.ID).
		Updates(map[string]any{"status": "succeeded", "updated_at": now}).Error; err != nil {
		t.Fatal(err)
	}
	if err := model.DB(context.Background()).Model(&model.QuestionAgentExecutionAdmission{}).
		Where("user_name = ? AND execution_id = ?", "alice", firstInput.ClientTurnID).
		Updates(map[string]any{"status": "succeeded", "context_revision": 1, "terminal_status": "succeeded", "terminal_at": now}).Error; err != nil {
		t.Fatal(err)
	}

	secondInput := QueryInput{
		Id: first.turn.ID, Query: "second", Mode: "instant", Tool: "ChatAgent",
		ClientTurnID: "turn-context-second", Locale: "en-US", Surface: QuerySurfaceChat,
	}
	secondTarget, err := service.resolveExecutionSubmissionTarget(
		context.Background(), "alice", secondInput, true,
	)
	if err != nil {
		t.Fatal(err)
	}
	second := admitV2TurnForTest(t, service, secondInput, secondTarget, true)
	if second.turn.ID <= first.turn.ID || second.turn.ParentID != first.turn.ID {
		t.Fatalf("first=%#v second=%#v", first.turn, second.turn)
	}
	if second.envelope == nil || second.envelope.BaseBusinessContextVersion != 1 || len(second.envelope.HistoryDelta) != 1 {
		t.Fatalf("follow-up envelope=%#v", second.envelope)
	}
	var legacyRows int64
	if err := model.DB(context.Background()).Model(&model.QuestionAgentLog{}).Count(&legacyRows).Error; err != nil {
		t.Fatal(err)
	}
	if legacyRows != 0 {
		t.Fatalf("V2 follow-up synthesized %d legacy rows", legacyRows)
	}
}

func TestConversationTurnV2RefreshReplacesVisibleShellInPlace(t *testing.T) {
	setupExecutionRuntimeV2DB(t)
	service := NewService()
	firstInput := QueryInput{
		Query: "before", Mode: "instant", Tool: "ChatAgent",
		ClientTurnID: "turn-refresh-before", Locale: "en-US", Surface: QuerySurfaceChat,
	}
	target := v1SubmissionTarget{dialogueID: "dialogue-refresh-v2", mode: "instant", operation: "append"}
	first := admitV2TurnForTest(t, service, firstInput, target, false)
	if err := model.DB(context.Background()).Model(&model.ConversationTurnV2{}).
		Where("id = ?", first.turn.ID).Update("status", "succeeded").Error; err != nil {
		t.Fatal(err)
	}

	refreshInput := QueryInput{
		RefreshId: first.turn.ID, Query: "after", Mode: "instant", Tool: "ChatAgent",
		ClientTurnID: "turn-refresh-after", Locale: "en-US", Surface: QuerySurfaceChat,
	}
	refreshTarget := v1SubmissionTarget{
		dialogueID: first.turn.DialogueID, parentID: first.turn.ParentID,
		mode: "instant", operation: "replace",
	}
	refreshed := admitV2TurnForTest(t, service, refreshInput, refreshTarget, false)
	if refreshed.turn.ID != first.turn.ID || refreshed.turn.Query != "after" {
		t.Fatalf("refresh changed logical turn: before=%#v after=%#v", first.turn, refreshed.turn)
	}
	var visible []model.ConversationMessageV2
	if err := model.DB(context.Background()).Where(
		"user_name = ? AND turn_id = ? AND delete_at IS NULL", "alice", first.turn.ID,
	).Order("message_index ASC").Find(&visible).Error; err != nil {
		t.Fatal(err)
	}
	if len(visible) != 2 || visible[0].Content != "after" || visible[1].ExecutionID != refreshInput.ClientTurnID {
		t.Fatalf("visible replacement timeline=%#v", visible)
	}
}

func TestConversationTurnV2ConversationListAndActionsUseCanonicalMetadata(t *testing.T) {
	setupExecutionRuntimeV2DB(t)
	service := NewService()
	in := QueryInput{
		Query: "canonical title", Mode: "instant", Tool: "ChatAgent",
		ClientTurnID: "turn-actions", Locale: "en-US", Surface: QuerySurfaceChat,
	}
	target := v1SubmissionTarget{dialogueID: "dialogue-actions-v2", mode: "instant", operation: "append"}
	turn := admitV2TurnForTest(t, service, in, target, false).turn

	list, err := service.QueryList(context.Background(), "alice")
	if err != nil || len(list) != 1 || list[0].Id != turn.ID || list[0].DialogueId != turn.DialogueID {
		t.Fatalf("list=%#v err=%v", list, err)
	}
	if _, err := service.QueryListRename(context.Background(), "alice", int(turn.ID), "renamed"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.QueryReactionType(context.Background(), int(turn.ID), "1", "alice"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.QueryCollect(context.Background(), int(turn.ID), "1", "alice"); err != nil {
		t.Fatal(err)
	}
	favorites, err := service.QueryCollectList(context.Background(), "alice")
	if err != nil || len(favorites) != 1 || favorites[0].Id != turn.ID {
		t.Fatalf("favorites=%#v err=%v", favorites, err)
	}
	lifecycle, err := service.AgentTaskLifecycle(context.Background(), turn.ID, "alice")
	if err != nil || lifecycle.ID != turn.ID || lifecycle.Phase != "PREPARING" || lifecycle.Terminal {
		t.Fatalf("lifecycle=%#v err=%v", lifecycle, err)
	}
}

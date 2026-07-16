package api_service

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"

	"github.com/google/uuid"
)

// ErrGatewayDisabled is returned when the Bot proxy is turned off in config.
// The handler maps it to 503 (service unavailable) rather than a generic 500,
// so ops can tell a deliberate-off gateway from a real server failure.
var ErrGatewayDisabled = errors.New("bot gateway is disabled")

// ErrUnknownTool is returned when the requested tool resolves to no Bot slug.
// The handler maps it to 400 (client error) rather than a generic 500, since a
// bad tool name is a caller mistake, not a server fault.
var ErrUnknownTool = errors.New("unknown tool")

// ErrExpertDisabled is returned when mode=expert is requested while the Expert
// routing gateway is dark (BotConfig.ExpertEnabled=false). The handler maps it
// to 503 so a deliberately-dark Expert mode is distinguishable from a fault.
var ErrExpertDisabled = errors.New("expert mode not available")

// ErrMissingBotRunID is returned when a Web row exists but cannot be synced
// through Bot run state because it has no bot_run_id.
var ErrMissingBotRunID = errors.New("row has no bot_run_id to sync")

// ErrStreamUnsupported marks a /query streaming request the SSE branch cannot
// serve (non-chat slug, or mode=expert which routes via /v1/query/route). The
// handler maps it to 400; expert traffic normally never reaches it because the
// handler's stream gate already excludes mode=expert (defense in depth).
var ErrStreamUnsupported = errors.New("streaming not supported for this request")

// QueryFile is one uploaded attachment, read into memory by the handler.
type QueryFile struct {
	Filename string
	Data     []byte
}

// QueryInput is the parsed /query multipart form.
type QueryInput struct {
	Query     string
	Id        int64 // the Web app's threading id: 0 = new conversation, else parent row id
	Tool      string
	RefreshId int64 // !=0 = re-answer an existing turn (UPDATE that row)
	History   string
	Mode      string // "instant" (default) | "expert"
	Files     []QueryFile
}

// QueryData is the response payload the Web app reads off response.data. The
// content fields are relayed from Bot; id/reaction are Web-owned.
type QueryData struct {
	Id                int64  `json:"id"`
	ToolName          string `json:"tool_name"`
	Answer            string `json:"answer"`
	FollowUpQuestions string `json:"follow_up_questions"`
	Status            string `json:"status"`
	UploadPath        string `json:"upload_path"`
	DownloadPath      string `json:"download_path"`
	ServerFilePath    string `json:"server_file_path"`
	ComputeResource   string `json:"compute_resource"`
	ReactionType      string `json:"reaction_type"`
	DialogueId        string `json:"dialogue_id"`
}

// StreamIdentity is the Web-owned identity of a streamed assistant message.
// QueryStream publishes it only after the RUNNING row is durable, before any
// Bot frame can reach the browser. The handler exposes these values as response
// headers so the frontend never has to infer an A2UI route from a parent row.
type StreamIdentity struct {
	DialogueID string
	MessageID  int64
}

// slugToToolName maps a Bot slug back to the tool_name the Web app renders by.
var slugToToolName = map[string]string{
	"chat":        "ChatAgent",
	"knowledge":   "KnowledgeAgent",
	"data":        "DataAgent",
	"analyst":     "AnalystAgent",
	"review":      "ReviewAgent",
	"deep_genome": "DeepGenomeAgent",
	"brief_gene":  "BriefGeneAgent",
	"research":    "InSilicoResearchAgent",
	"design":      "DigitalDesignAgent",
	"network":     "GeneNetworkAgent",
}

// ExpertModeEnabled reports whether Expert routing is live. It is the single
// source of truth shared by the /query gateway gate and the UI pill flag.
func (ps *Service) ExpertModeEnabled() bool {
	return rxBot.BotConfig != nil && rxBot.BotConfig.ExpertEnabled
}

// Query is the gateway orchestration: upload files to Bot, dispatch to the
// resolved agent, persist a Web-side row (Bot owns the content; Web keeps the
// ownership/threading record plus a transitional content fallback), and return
// exactly what the Web app consumes.
//
// Threading model (reconstructed from the surviving read paths QueryList /
// AnswerCheck, not from the deleted Python service):
//   - parent rows have f_id = 0 and carry the conversation title_query;
//   - child rows have f_id = <parent row id> and share the parent dialogue_id.
//
// So Id=0 starts a new conversation (fresh dialogue_id), Id=N appends a child
// to parent N, and RefreshId!=0 re-answers an existing row in place.
func (ps *Service) Query(ctx context.Context, username string, in QueryInput) (*QueryData, error) {
	if rxBot.BotConfig == nil || !rxBot.BotConfig.ProxyEnabled {
		return nil, ErrGatewayDisabled
	}
	// Expert mode is dark-launched: refuse early (no Bot call) when disabled.
	if in.Mode == "expert" && !rxBot.BotConfig.ExpertEnabled {
		return nil, ErrExpertDisabled
	}
	client := rxBot.NewClient()

	// 1. Upload attachments to Bot OBS; keep names/paths for the Web row and
	//    the structured obs_file_list passed to capable chat models.
	var obsPaths, fileNames []string
	for _, f := range in.Files {
		up, err := client.UploadFile(ctx, f.Filename, "", bytes.NewReader(f.Data))
		if err != nil {
			return nil, err
		}
		obsPaths = append(obsPaths, up.Path)
		fileNames = append(fileNames, f.Filename)
	}

	// 2. Web-owned alias -> Bot slug. Empty tool defaults to the chat agent.
	slug, ok := rxBot.SlugFor(in.Tool)
	if !ok {
		return nil, fmt.Errorf("%w %q", ErrUnknownTool, in.Tool)
	}

	// 3. Resolve dialogue_id + f_id from the threading model above. Ownership
	//    is enforced by user_name so a caller cannot thread onto, or overwrite,
	//    another user's conversation (real-user isolation lives in Web Go).
	dialogueID, fID, err := ps.resolveDialogue(ctx, username, in)
	if err != nil {
		return nil, err
	}

	// 4. Dispatch. Web Go never runs an LLM; it forwards free-form query text
	//    (and structured obs_file_list to capable chat models).
	out := &QueryData{
		ToolName:     slugToToolName[slug],
		ReactionType: "0",
		DialogueId:   dialogueID,
		Status:       "SUCCEEDED",
	}
	var botRunID, serverID, taskID, logStatus string
	if in.Mode == "expert" {
		resp, err := client.RouteQuery(ctx, rxBot.RouteQueryRequest{
			UserQuery:   in.Query,
			History:     parseHistory(in.History),
			OBSFileList: obsPaths,
			DialogueID:  dialogueID,
			ForcedTool:  nil,
		})
		if err != nil {
			return nil, err
		}
		if resp.ID != nil {
			botRunID = *resp.ID
		}
		// Reshape by the slug Bot's router CHOSE (never "expert"), so cited/table
		// formatting survives and SyncBotRuns reconciles async runs by agent slug.
		resolvedSlug := resp.Agent
		if name, ok := slugToToolName[resolvedSlug]; ok {
			out.ToolName = name
		}
		if resp.Status == "succeeded" {
			if resp.Result.Formatted != nil {
				out.Answer = rxBot.ShapeAnswer(resolvedSlug, resp.Result.Formatted.Answer, resp.Result.Formatted)
				out.FollowUpQuestions = string(resp.Result.Formatted.FollowUpQuestions)
			}
		} else {
			out.Status = "RUNNING"
			logStatus = "sync_running"
			if resp.Result.DedupHit {
				taskID = resp.Result.TaskID
			} else if len(resp.TaskIDs) > 0 {
				taskID = resp.TaskIDs[0]
			}
			out.Answer = "Task created: " + taskID
		}
	} else if chatModel, isChat := rxBot.ChatModelFor(slug); isChat {
		req := rxBot.ChatCompletionRequest{
			Model:      chatModel,
			Messages:   []rxBot.ChatMessage{{Role: "user", Content: in.Query}},
			DialogueID: dialogueID,
		}
		if len(obsPaths) > 0 {
			req.OBSFileList = obsPaths
		}
		resp, err := client.ChatCompletion(ctx, req)
		if err != nil {
			return nil, err
		}
		// Default-mode chat/completions strips formatted.answer into
		// choices[0].message.content; source it there, then reshape per slug
		// (knowledge/review become {content, doc_list}; chat stays plain).
		out.Answer = rxBot.ShapeAnswer(slug, rxBot.ChatAnswerText(resp), &resp.Formatted)
		out.FollowUpQuestions = string(resp.Formatted.FollowUpQuestions)
		botRunID = resp.ID
	} else {
		// /v1/agents/{slug}/runs serves BOTH synchronous agents (data → 200,
		// status="succeeded", answer already in result.formatted) AND remote
		// agents (analyst, deep_genome, research, design, network → 202,
		// status="running", answer polled later via /query/analyst/update_log).
		// Branch on the returned status;
		// never assume remote, or a sync agent's answer is silently dropped.
		args := map[string]interface{}{"user_query": in.Query}
		if slug == "deep_genome" {
			// deep_genome needs a structured gene id; resolve_gene_id=true tells
			// Bot's resolver to derive it from the free-text user_query (Bot
			// rejects this flag for any other agent, so scope it to deep_genome).
			args["resolve_gene_id"] = true
		}
		resp, err := client.InvokeAgent(ctx, slug, rxBot.AgentRunRequest{
			Arguments:  args,
			DialogueID: dialogueID,
		})
		if err != nil {
			return nil, err
		}
		if resp.ID != nil {
			botRunID = *resp.ID
		}
		if resp.Status == "succeeded" {
			// Synchronous agent (e.g. data): the answer is already here.
			if resp.Result.Formatted != nil {
				// Reshape the sync agent payload (data -> {headers, rows}).
				out.Answer = rxBot.ShapeAnswer(slug, resp.Result.Formatted.Answer, resp.Result.Formatted)
				out.FollowUpQuestions = string(resp.Result.Formatted.FollowUpQuestions)
			}
			// out.Status stays "SUCCEEDED".
		} else {
			// Remote agent: only a task id is back; the answer arrives later.
			out.Status = "RUNNING"
			logStatus = "sync_running"
			if resp.Result.DedupHit {
				taskID = resp.Result.TaskID
			} else if len(resp.TaskIDs) > 0 {
				taskID = resp.TaskIDs[0]
			}
			if slug == "deep_genome" {
				serverID = taskID
				out.Answer = "Server task created: " + serverID
			} else {
				out.Answer = "Task created: " + taskID
			}
		}
	}

	// 5. Persist the Web row (INSERT new, or UPDATE on refresh).
	titleQuery := ""
	if fID == 0 && in.RefreshId == 0 {
		titleQuery = in.Query // first turn of a new conversation is its title
	}
	row := model.QuestionAgentLog{
		DialogueId:        dialogueID,
		FId:               fID,
		ServerId:          serverID,
		BotRunId:          botRunID,
		UserName:          username,
		Query:             in.Query,
		TitleQuery:        titleQuery,
		Answer:            out.Answer,
		FollowUpQuestions: out.FollowUpQuestions,
		TaskId:            taskID,
		TaskLog:           "",
		FileName:          strings.Join(fileNames, ","),
		UploadPath:        strings.Join(obsPaths, ","),
		DownloadPath:      "",
		ComputeResource:   "",
		ServerFilePath:    "", // not the task id; the output file path is filled by update_log once the remote task emits it
		ToolName:          out.ToolName,
		Status:            out.Status,
		LogStatus:         logStatus,
		Mode:              in.Mode,
		ReactionType:      "0",
		CollectType:       "0",
	}

	id, err := ps.persistQuestionLog(ctx, username, in.RefreshId, &row)
	if err != nil {
		return nil, err
	}
	out.Id = id
	out.UploadPath = strings.Join(obsPaths, ",")
	return out, nil
}

// resolveDialogue returns the dialogue_id and f_id for this turn, scoping every
// lookup to the authenticated user_name so a caller can only refresh or thread
// onto their own rows.
func (ps *Service) resolveDialogue(ctx context.Context, username string, in QueryInput) (string, int64, error) {
	if in.RefreshId != 0 {
		var row model.QuestionAgentLog
		if err := model.DB(ctx).Model(&model.QuestionAgentLog{}).
			Where("id = ? AND user_name = ?", in.RefreshId, username).First(&row).Error; err != nil {
			return "", 0, err
		}
		return row.DialogueId, row.FId, nil
	}
	if in.Id == 0 {
		return uuid.NewString(), 0, nil
	}
	var parent model.QuestionAgentLog
	if err := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Where("id = ? AND user_name = ?", in.Id, username).First(&parent).Error; err != nil {
		return "", 0, err
	}
	return parent.DialogueId, in.Id, nil
}

// parseHistory converts the flat history JSON string the Web app sends into the
// structured [{role, content}] array Bot's router consumes. Best-effort: a
// malformed/empty string yields nil (no history), never an error.
func parseHistory(s string) []rxBot.ChatMessage {
	if s == "" || s == "[]" {
		return nil
	}
	var msgs []rxBot.ChatMessage
	_ = json.Unmarshal([]byte(s), &msgs)
	return msgs
}

// QueryAnalystUpdateLog syncs a finished remote task's result back into the
// Web row. The Web app posts both task_id and compute_resource.
func (ps *Service) QueryAnalystUpdateLog(ctx context.Context, username, taskID, computeResource string) (string, error) {
	if rxBot.BotConfig == nil || !rxBot.BotConfig.ProxyEnabled {
		return "", ErrGatewayDisabled
	}
	var row model.QuestionAgentLog
	if err := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Where("user_name = ? AND task_id = ?", username, taskID).First(&row).Error; err != nil {
		return "", err
	}
	if row.BotRunId == "" {
		return "", ErrMissingBotRunID
	}
	rec, err := rxBot.NewClient().GetRun(ctx, row.BotRunId)
	if err != nil {
		return "", err
	}
	// Reshape the finished task's content into the JSON the Web app parses, the
	// same as the live dispatch and the answer-check overlay. deep_genome's
	// assembled report arrives as result.final_report (no formatted envelope),
	// so fall back to it when there is no formatted block.
	updates := map[string]interface{}{
		"compute_resource": computeResource,
		"log_status":       "sync_succeeded",
	}
	answer := rec.Answer
	if f, answerText, ok := rxBot.ParseRunFormatted(rec.Result); ok {
		answer = rxBot.ShapeAnswer(rec.Agent, answerText, f)
		// analyst class: backfill the gallery representative prefix + full image paths (both written only when non-empty, no-clobber)
		if dirs, paths, ok2 := rxBot.ParseRunArtifacts(rec.Result); ok2 {
			if len(dirs) > 0 && dirs[0] != "" {
				updates["download_path"] = dirs[0]
			}
			if len(paths) > 0 {
				if b, err := json.Marshal(paths); err == nil {
					updates["image_paths"] = string(b)
				}
			}
		}
	} else if fr, ok := rxBot.ParseRunFinalReport(rec.Result); ok {
		// final_report is deep_genome-exclusive; reshape with the known slug.
		answer = rxBot.ShapeAnswer("deep_genome", fr, nil)
	}
	// The Web app gates download on "SUCCEEDED"; Bot is lowercase. Skip an empty
	// status rather than writing '' into the NOT NULL column (GORM's map Updates
	// does not skip zero values), which would strand the row out of the cron's
	// WHERE status='RUNNING' poll set.
	if s := strings.ToUpper(rec.Status); s != "" {
		updates["status"] = s
	}
	// Never clobber an existing answer with a blank reshape: a completed run
	// that still has no rendered answer (e.g. analyst, whose formatted answer
	// is not yet produced by Bot) must leave the prior column untouched.
	if answer != "" {
		updates["answer"] = answer
	}
	if err := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Where("id = ?", row.Id).Updates(updates).Error; err != nil {
		return "", err
	}
	return answer, nil
}

// persistQuestionLog writes one QuestionAgentLog row, shared by the blocking
// Query and streaming QueryStream paths: a plain INSERT on a fresh turn, or a
// two-step UPDATE on refresh (struct Updates for the row, then an explicit map
// Updates to clear the transitional task columns — server_id/task_id/
// log_status/server_file_path — which struct Updates would skip as zero
// values, stranding a prior agent type's identifiers on a re-answered turn).
// It returns the row id (the refresh id on update, the new autoincrement id on
// insert). Callers build `row` with their own column values; this helper owns
// only the persistence branch so the two paths cannot drift.
func (ps *Service) persistQuestionLog(ctx context.Context, username string, refreshID int64, row *model.QuestionAgentLog) (int64, error) {
	if refreshID != 0 {
		if err := model.DB(ctx).Model(&model.QuestionAgentLog{}).
			Where("id = ? AND user_name = ?", refreshID, username).Updates(row).Error; err != nil {
			return 0, err
		}
		if err := model.DB(ctx).Model(&model.QuestionAgentLog{}).
			Where("id = ? AND user_name = ?", refreshID, username).
			Updates(map[string]interface{}{
				"server_id":        row.ServerId,
				"task_id":          row.TaskId,
				"log_status":       row.LogStatus,
				"server_file_path": "",
			}).Error; err != nil {
			return 0, err
		}
		return refreshID, nil
	}
	if err := model.DB(ctx).Create(row).Error; err != nil {
		return 0, err
	}
	return row.Id, nil
}

// QueryStream is the SSE variant of Query for chat-family slugs. It opens the
// Bot AG-UI stream, persists a RUNNING Web row, publishes that row's canonical
// identity through onReady, then forwards each frame via forward() while teeing
// it into an accumulator. RunStarted is persisted before it is forwarded, so
// the existing A2UI dialogue + user + run authorization boundary is live by the
// time an interactive frame can reach the browser. A forward() error (browser
// disconnect) stops forwarding but never aborts the Bot read or finalization.
func (ps *Service) QueryStream(
	ctx context.Context,
	username string,
	in QueryInput,
	onReady func(StreamIdentity),
	forward func(frame []byte) error,
) (*QueryData, error) {
	if rxBot.BotConfig == nil || !rxBot.BotConfig.ProxyEnabled {
		return nil, ErrGatewayDisabled
	}
	if in.Mode == "expert" {
		// Expert routes via RouteQuery (POST /v1/query/route, no streaming
		// primitive). The handler gate keeps expert out of this branch; this
		// guard is defense in depth so SlugFor("")->"chat" can never collapse
		// an Expert turn into a streamed ChatAgent run (slug-gate invariant,
		// query_expert_test.go).
		return nil, fmt.Errorf("%w: expert mode", ErrStreamUnsupported)
	}
	slug, ok := rxBot.SlugFor(in.Tool)
	if !ok {
		return nil, fmt.Errorf("%w %q", ErrUnknownTool, in.Tool)
	}
	chatModel, isChat := rxBot.ChatModelFor(slug)
	if !isChat {
		// Non-chat slugs have no Bot streaming primitive today (handoff P1).
		return nil, fmt.Errorf("%w: tool %q has no Bot streaming primitive (handoff P1)", ErrStreamUnsupported, in.Tool)
	}

	client := rxBot.NewClient()

	// Upload attachments before opening the stream so upload errors still
	// surface as a normal (non-SSE) error to the handler.
	var obsPaths, fileNames []string
	for _, f := range in.Files {
		up, err := client.UploadFile(ctx, f.Filename, "", bytes.NewReader(f.Data))
		if err != nil {
			return nil, err
		}
		obsPaths = append(obsPaths, up.Path)
		fileNames = append(fileNames, f.Filename)
	}

	dialogueID, fID, err := ps.resolveDialogue(ctx, username, in)
	if err != nil {
		return nil, err
	}

	req := rxBot.ChatCompletionRequest{
		Model:      chatModel,
		Messages:   []rxBot.ChatMessage{{Role: "user", Content: in.Query}},
		DialogueID: dialogueID,
	}
	if len(obsPaths) > 0 {
		req.OBSFileList = obsPaths
	}
	rc, err := client.ChatCompletionStream(ctx, req)
	if err != nil {
		// Pre-first-byte failure (auth / unsupported) surfaces as a normal
		// error so the handler can still return a non-SSE status.
		return nil, err
	}
	defer rc.Close()

	// The row must exist before any Bot frame is forwarded. Besides making the
	// response identity authoritative, this closes the former A2UI window where
	// a widget was visible while its authorization tuple did not exist yet.
	titleQuery := ""
	if fID == 0 && in.RefreshId == 0 {
		titleQuery = in.Query
	}
	row := model.QuestionAgentLog{
		DialogueId:        dialogueID,
		FId:               fID,
		UserName:          username,
		Query:             in.Query,
		TitleQuery:        titleQuery,
		Answer:            "",
		FollowUpQuestions: "",
		FileName:          strings.Join(fileNames, ","),
		UploadPath:        strings.Join(obsPaths, ","),
		ToolName:          slugToToolName[slug],
		Status:            "RUNNING",
		Mode:              in.Mode,
		ReactionType:      "0",
		CollectType:       "0",
	}
	id, err := ps.beginQuestionStream(ctx, username, in.RefreshId, &row)
	if err != nil {
		return nil, err
	}
	identity := StreamIdentity{DialogueID: dialogueID, MessageID: id}
	if onReady != nil {
		onReady(identity)
	}

	// Forward + tee, splitting the SSE body on blank-line frame separators.
	acc := &rxBot.AGUIAccumulator{}
	scanner := bufio.NewScanner(rc)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	scanner.Split(splitSSEFrames)
	forwarding := true
	persistedRunID := ""
	var streamErr error
	for scanner.Scan() {
		frame := scanner.Bytes()
		if ev, ok := rxBot.ParseAGUIFrame(frame); ok {
			acc.Observe(ev)
			if ev.Type == "RunStarted" && acc.RunID() == "" {
				streamErr = errors.New("RunStarted event is missing run_id")
				break
			}
			if ev.Type == "RunStarted" && acc.RunID() != persistedRunID {
				// Persist the cross-service join key before the browser can receive
				// RunStarted (and therefore before any later interactive frame).
				if err := ps.setQuestionStreamRunID(ctx, username, identity, acc.RunID()); err != nil {
					streamErr = err
					break
				}
				persistedRunID = acc.RunID()
			}
		}
		// Forward the raw frame (with trailing blank line) to the browser.
		out := append(append([]byte{}, frame...), '\n', '\n')
		if forwarding && forward != nil {
			if err := forward(out); err != nil {
				forwarding = false
			}
		}
	}

	// Ground the persisted status in what actually happened on the wire, not a
	// hardcoded optimism: a mid-stream read error (network drop, ctx cancel,
	// frame over the 1MB scanner cap) or a RunError event both mean the answer
	// is partial/failed. A blank status would strand the row out of the GA
	// cron's WHERE status='RUNNING' poll set, so use "FAILED" (a terminal
	// non-RUNNING state) rather than "" for these paths.
	status := "SUCCEEDED"
	if streamErr != nil {
		status = "FAILED"
	} else if err := scanner.Err(); err != nil {
		status = "FAILED"
		streamErr = err
	} else if acc.Err() != nil {
		status = "FAILED"
	}

	// Finalize the row opened above. WithoutCancel preserves request-scoped DB
	// values while ensuring a browser abort or upstream disconnect cannot leave
	// the durable row stuck in RUNNING merely because the request context ended.
	out := &QueryData{
		Id:           id,
		ToolName:     slugToToolName[slug],
		ReactionType: "0",
		DialogueId:   dialogueID,
		Status:       status,
	}
	out.Answer = rxBot.ShapeAnswer(slug, acc.AnswerText(), nil)
	out.FollowUpQuestions = acc.FollowUpJSON()
	finalizeCtx, cancelFinalize := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
	defer cancelFinalize()
	if err := ps.finalizeQuestionStream(finalizeCtx, username, identity, acc.RunID(), out); err != nil {
		return nil, err
	}
	out.UploadPath = strings.Join(obsPaths, ",")
	if streamErr != nil {
		return out, streamErr
	}
	return out, nil
}

// beginQuestionStream creates a fresh row or moves a refresh target into
// RUNNING before the first frame. Refresh explicitly clears the prior answer
// and bot_run_id because GORM struct updates skip zero values; retaining either
// would expose stale content or authorize actions against the previous run.
func (ps *Service) beginQuestionStream(ctx context.Context, username string, refreshID int64, row *model.QuestionAgentLog) (int64, error) {
	if refreshID == 0 {
		if err := model.DB(ctx).Create(row).Error; err != nil {
			return 0, err
		}
		return row.Id, nil
	}
	result := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Where("id = ? AND user_name = ? AND dialogue_id = ?", refreshID, username, row.DialogueId).
		Updates(map[string]interface{}{
			"answer":              "",
			"bot_run_id":          "",
			"collect_type":        row.CollectType,
			"f_id":                row.FId,
			"file_name":           row.FileName,
			"follow_up_questions": "",
			"log_status":          "",
			"mode":                row.Mode,
			"query":               row.Query,
			"reaction_type":       row.ReactionType,
			"server_file_path":    "",
			"server_id":           "",
			"status":              row.Status,
			"task_id":             "",
			"title_query":         row.TitleQuery,
			"tool_name":           row.ToolName,
			"upload_path":         row.UploadPath,
		})
	if result.Error != nil {
		return 0, result.Error
	}
	if result.RowsAffected != 1 {
		var count int64
		if err := model.DB(ctx).Model(&model.QuestionAgentLog{}).
			Where("id = ? AND user_name = ? AND dialogue_id = ?", refreshID, username, row.DialogueId).
			Count(&count).Error; err != nil {
			return 0, err
		}
		if count != 1 {
			return 0, fmt.Errorf("stream row %d not found", refreshID)
		}
	}
	return refreshID, nil
}

func (ps *Service) setQuestionStreamRunID(ctx context.Context, username string, identity StreamIdentity, runID string) error {
	result := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Where("id = ? AND user_name = ? AND dialogue_id = ?", identity.MessageID, username, identity.DialogueID).
		Update("bot_run_id", runID)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("stream row %d not found", identity.MessageID)
	}
	return nil
}

func (ps *Service) finalizeQuestionStream(
	ctx context.Context,
	username string,
	identity StreamIdentity,
	runID string,
	out *QueryData,
) error {
	result := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Where("id = ? AND user_name = ? AND dialogue_id = ?", identity.MessageID, username, identity.DialogueID).
		Updates(map[string]interface{}{
			"answer":              out.Answer,
			"bot_run_id":          runID,
			"follow_up_questions": out.FollowUpQuestions,
			"status":              out.Status,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("stream row %d not found", identity.MessageID)
	}
	return nil
}

// splitSSEFrames is a bufio.SplitFunc that yields one SSE frame per call,
// splitting on the blank-line ("\n\n") separator. The trailing separator is
// consumed but not included in the token.
func splitSSEFrames(data []byte, atEOF bool) (advance int, token []byte, err error) {
	if i := bytes.Index(data, []byte("\n\n")); i >= 0 {
		return i + 2, data[:i], nil
	}
	if atEOF && len(data) > 0 {
		return len(data), data, nil
	}
	return 0, nil, nil
}

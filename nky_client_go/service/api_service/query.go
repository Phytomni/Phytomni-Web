package api_service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	rxBot "nky_client_go/external/bot"
	"nky_client_go/model"

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

// QueryFile is one uploaded attachment, read into memory by the handler.
type QueryFile struct {
	Filename string
	Data     []byte
}

// QueryInput is the parsed /query multipart form.
type QueryInput struct {
	Query     string
	Id        int64 // chat-ai's threading id: 0 = new conversation, else parent row id
	Tool      string
	RefreshId int64 // !=0 = re-answer an existing turn (UPDATE that row)
	History   string
	Files     []QueryFile
}

// QueryData is the response payload chat-ai reads off response.data. The
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

// slugToToolName maps a Bot slug back to the tool_name chat-ai renders by.
var slugToToolName = map[string]string{
	"chat":        "ChatAgent",
	"knowledge":   "KnowledgeAgent",
	"data":        "DataAgent",
	"analyst":     "AnalystAgent",
	"review":      "ReviewAgent",
	"deep_genome": "DeepGenomeAgent",
	"brief_gene":  "BriefReviewAgent",
}

// Query is the gateway orchestration: upload files to Bot, dispatch to the
// resolved agent, persist a Web-side row (Bot owns the content; Web keeps the
// ownership/threading record plus a transitional content fallback), and return
// exactly what chat-ai consumes.
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
	if chatModel, isChat := rxBot.ChatModelFor(slug); isChat {
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
		// agents (analyst, deep_genome → 202, status="running", answer polled
		// later via /query/analyst/update_log). Branch on the returned status;
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
				out.Answer = "server任务创建成功：" + serverID
			} else {
				out.Answer = "任务创建成功：" + taskID
			}
		}
	}

	// 5. Persist the Web row (INSERT new, or UPDATE on refresh).
	titleQuery := ""
	if fID == 0 && in.RefreshId == 0 {
		titleQuery = in.Query // first turn of a new conversation is its title
	}
	row := model.SQuestionAgentLog{
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
		ReactionType:      "0",
		CollectType:       "0",
	}

	if in.RefreshId != 0 {
		if err := model.DB(ctx).Model(&model.SQuestionAgentLog{}).
			Where("id = ? AND user_name = ?", in.RefreshId, username).Updates(&row).Error; err != nil {
			return nil, err
		}
		// Updates(&struct) skips zero-valued columns, so re-answering a turn
		// whose agent type changed (e.g. analyst -> chat) would leave the old
		// task identifiers behind. Clear the transitional task columns
		// explicitly with the new turn's values (which may be empty).
		if err := model.DB(ctx).Model(&model.SQuestionAgentLog{}).
			Where("id = ? AND user_name = ?", in.RefreshId, username).
			Updates(map[string]interface{}{
				"server_id":        serverID,
				"task_id":          taskID,
				"log_status":       logStatus,
				"server_file_path": "",
			}).Error; err != nil {
			return nil, err
		}
		out.Id = in.RefreshId
	} else {
		if err := model.DB(ctx).Create(&row).Error; err != nil {
			return nil, err
		}
		out.Id = row.Id
	}
	out.UploadPath = strings.Join(obsPaths, ",")
	return out, nil
}

// resolveDialogue returns the dialogue_id and f_id for this turn, scoping every
// lookup to the authenticated user_name so a caller can only refresh or thread
// onto their own rows.
func (ps *Service) resolveDialogue(ctx context.Context, username string, in QueryInput) (string, int64, error) {
	if in.RefreshId != 0 {
		var row model.SQuestionAgentLog
		if err := model.DB(ctx).Model(&model.SQuestionAgentLog{}).
			Where("id = ? AND user_name = ?", in.RefreshId, username).First(&row).Error; err != nil {
			return "", 0, err
		}
		return row.DialogueId, row.FId, nil
	}
	if in.Id == 0 {
		return uuid.NewString(), 0, nil
	}
	var parent model.SQuestionAgentLog
	if err := model.DB(ctx).Model(&model.SQuestionAgentLog{}).
		Where("id = ? AND user_name = ?", in.Id, username).First(&parent).Error; err != nil {
		return "", 0, err
	}
	return parent.DialogueId, in.Id, nil
}

// QueryAnalystUpdateLog syncs a finished remote task's result back into the
// Web row. chat-ai posts both task_id and compute_resource.
func (ps *Service) QueryAnalystUpdateLog(ctx context.Context, username, taskID, computeResource string) (string, error) {
	if rxBot.BotConfig == nil || !rxBot.BotConfig.ProxyEnabled {
		return "", ErrGatewayDisabled
	}
	var row model.SQuestionAgentLog
	if err := model.DB(ctx).Model(&model.SQuestionAgentLog{}).
		Where("user_name = ? AND task_id = ?", username, taskID).First(&row).Error; err != nil {
		return "", err
	}
	if row.BotRunId == "" {
		return "", errors.New("row has no bot_run_id to sync")
	}
	rec, err := rxBot.NewClient().GetRun(ctx, row.BotRunId)
	if err != nil {
		return "", err
	}
	// Reshape the finished task's content into the JSON chat-ai parses, the
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
		// analyst 类:回填图廊代表性前缀 + 全量图片路径(均仅非空才写,no-clobber)
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
	// chat-ai gates download on "SUCCEEDED"; Bot is lowercase. Skip an empty
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
	if err := model.DB(ctx).Model(&model.SQuestionAgentLog{}).
		Where("id = ?", row.Id).Updates(updates).Error; err != nil {
		return "", err
	}
	return answer, nil
}

package api_service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strings"

	rxBot "nky_client_go/external/bot"
	"nky_client_go/model"

	"github.com/google/uuid"
)

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
}

// ApiQuery is the gateway orchestration: upload files to Bot, dispatch to the
// resolved agent, persist a Web-side row (Bot owns the content; Web keeps the
// ownership/threading record plus a transitional content fallback), and return
// exactly what chat-ai consumes.
//
// Threading model (reconstructed from the surviving read paths ApiQueryList /
// ApiAnswerCheck, not from the deleted Python service):
//   - parent rows have f_id = 0 and carry the conversation title_query;
//   - child rows have f_id = <parent row id> and share the parent dialogue_id.
//
// So Id=0 starts a new conversation (fresh dialogue_id), Id=N appends a child
// to parent N, and RefreshId!=0 re-answers an existing row in place.
func (ps *ApiService) ApiQuery(ctx context.Context, username string, in QueryInput) (*QueryData, error) {
	if rxBot.BotConfig == nil || !rxBot.BotConfig.ProxyEnabled {
		return nil, errors.New("bot gateway is disabled")
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
		return nil, fmt.Errorf("unknown tool %q", in.Tool)
	}

	// 3. Resolve dialogue_id + f_id from the threading model above.
	dialogueID, fID, err := ps.resolveDialogue(ctx, in)
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
		out.Answer = resp.Formatted.Answer
		out.FollowUpQuestions = string(resp.Formatted.FollowUpQuestions)
		botRunID = resp.ID
	} else {
		// Remote agents (analyst, deep_genome) return 202 + task ids; the final
		// answer is synced back later via /query/analyst/update_log.
		resp, err := client.InvokeAgent(ctx, slug, rxBot.AgentRunRequest{
			Arguments:  map[string]interface{}{"user_query": in.Query},
			DialogueID: dialogueID,
		})
		if err != nil {
			return nil, err
		}
		out.Status = "RUNNING"
		logStatus = "sync_running"
		if resp.Result.DedupHit {
			taskID = resp.Result.TaskID
		} else if len(resp.TaskIDs) > 0 {
			taskID = resp.TaskIDs[0]
		}
		if resp.ID != nil {
			botRunID = *resp.ID
		}
		if slug == "deep_genome" {
			serverID = taskID
			out.Answer = "server任务创建成功：" + serverID
		} else {
			out.Answer = "任务创建成功：" + taskID
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
		ServerFilePath:    serverID,
		ToolName:          out.ToolName,
		Status:            out.Status,
		LogStatus:         logStatus,
		ReactionType:      "0",
		CollectType:       "0",
	}

	if in.RefreshId != 0 {
		if err := model.DB(ctx).Model(&model.SQuestionAgentLog{}).
			Where("id = ?", in.RefreshId).Updates(&row).Error; err != nil {
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

// resolveDialogue returns the dialogue_id and f_id for this turn.
func (ps *ApiService) resolveDialogue(ctx context.Context, in QueryInput) (string, int64, error) {
	if in.RefreshId != 0 {
		var row model.SQuestionAgentLog
		if err := model.DB(ctx).Model(&model.SQuestionAgentLog{}).
			Where("id = ?", in.RefreshId).First(&row).Error; err != nil {
			return "", 0, err
		}
		return row.DialogueId, row.FId, nil
	}
	if in.Id == 0 {
		return uuid.NewString(), 0, nil
	}
	var parent model.SQuestionAgentLog
	if err := model.DB(ctx).Model(&model.SQuestionAgentLog{}).
		Where("id = ?", in.Id).First(&parent).Error; err != nil {
		return "", 0, err
	}
	return parent.DialogueId, in.Id, nil
}

// ApiQueryAnalystUpdateLog syncs a finished remote task's result back into the
// Web row. chat-ai posts both task_id and compute_resource.
func (ps *ApiService) ApiQueryAnalystUpdateLog(ctx context.Context, username, taskID, computeResource string) (string, error) {
	if rxBot.BotConfig == nil || !rxBot.BotConfig.ProxyEnabled {
		return "", errors.New("bot gateway is disabled")
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
	if err := model.DB(ctx).Model(&model.SQuestionAgentLog{}).
		Where("id = ?", row.Id).Updates(map[string]interface{}{
		"answer":           rec.Answer,
		"status":           rec.Status,
		"compute_resource": computeResource,
		"log_status":       "sync_succeeded",
	}).Error; err != nil {
		return "", err
	}
	return rec.Answer, nil
}

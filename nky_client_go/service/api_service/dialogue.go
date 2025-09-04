package api_service

import (
	"github.com/gin-gonic/gin"
	"nky_client_go/common"
)

func (ps *ApiService) ApiDialogueFlowStart(ctx *gin.Context, dialogue common.DialogueRequestData) (response *common.DialogueResponse, err error) {
	runDialogue, err := RunDialogue(dialogue.Inputs.ResearchTheme, dialogue.User, dialogue.Query,
		dialogue.ConversationId, dialogue.MessageId, dialogue.Files)
	if err != nil {
		return nil, err
	}
	response = new(common.DialogueResponse)
	response.MessageId = runDialogue.MessageId
	response.ConversationId = runDialogue.ConversationId
	response.Answer = runDialogue.Answer
	return
}

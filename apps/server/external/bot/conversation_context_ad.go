package bot

import "sync/atomic"

var conversationContextV1 atomic.Bool

// NoteConversationContextV1 records whether Bot advertised conversation_context
// protocol v1. There is no Web-side multiturn switch; envelopes follow the ad.
func NoteConversationContextV1(resp *AgentsListResponse) {
	if resp != nil && SupportsProtocol(resp, "conversation_context", 1) {
		conversationContextV1.Store(true)
	}
}

// ConversationContextV1Advertised reports the last noted Bot advertisement.
func ConversationContextV1Advertised() bool {
	return conversationContextV1.Load()
}

// SetConversationContextV1Advertised is test-only control for the advertisement
// cache. Production code notes the protocol from /v1/agents instead.
func SetConversationContextV1Advertised(enabled bool) {
	conversationContextV1.Store(enabled)
}

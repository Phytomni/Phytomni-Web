# Parallel Dialogue Feature Implementation

## Overview

This update implements parallel dialogue support for the chat system, giving each conversation independent state so multiple dialogues can be active simultaneously without interfering with one another.

## Core Improvements

### 1. State Management Refactor

**Previous problems:**
- All dialogues shared global state (`isSending`, `messageInput`, `fileList`, etc.)
- Multiple dialogues could not be processed at the same time
- Switching between dialogues caused state loss or corruption
- A single top-level `currentChat` ref owned the live message tree, so A→B→A lost streaming placeholders / blocks

**Solution:**
- Introduce a `chatStates` object to manage all per-dialogue state
- Each dialogue maintains its own independent state set, including `renderedChat`
- Use computed properties for reactive bindings; `currentChat` is only a keyed view

### 2. Dialogue State Structure

```typescript
interface ChatUIState {
  isSending: boolean;
  messageInput: string;
  fileList: UploadFile[];
  historyQuestion: any;
  copyVisible: number;
  copyTimeRef: ReturnType<typeof setTimeout> | undefined;
  logData: Record<string, any>;
  loadingLog: Record<string, boolean>;
  refreshingMessages: Record<string, boolean>;
  reactions: Record<string, number>;
  updatingLog: Record<string, boolean>;
  sendStartedAt: number | null;
  activeAgentName: string;
  completing: boolean;
  mode: "instant" | "expert";
  isStreaming: boolean;
  streamingMessageId: string | null;
  a2uiActionSender: A2uiActionTransport | null;
  a2uiRunId: string;
  uploadTransfer: TransferSnapshot | null;
  selectedAgent: string;
  /** Live message tree; default null until hydrated. */
  renderedChat: ChatView | null;
}

/** Partial Chat metadata + concrete messages array (placeholders, blocks, A2UI). */
type ChatView = Partial<Chat> & { messages: ChatMessage[] };
```

### 3. Per-dialogue data vs shell state

| Owned by `chatStates[dialogueId]` | Shell / focus (not per-message owner) |
|---|---|
| `renderedChat` (messages, streaming placeholders, blocks, A2UI surfaces) | `currentChatId` |
| Composer drafts (`messageInput`, `fileList`, `selectedAgent`) | URL `dialogue_id` |
| Send/stream flags (`isSending`, `isStreaming`, …) | Transcript scroll position |
| Reactions / refresh / log maps | Global toasts while that dialogue is active |

`currentChat` is a writable computed that reads/writes `chatStates[currentChatId].renderedChat`. There is no second message owner.

### 4. Object-identity rekey (temp → server)

`rekeyChatState(from, to)` moves the **same** `ChatUIState` object to the new key (including `renderedChat` and its `messages` array). Temp→server reconciliation preserves streaming placeholders and block object identity; it does not clone or rebuild the message tree.

### 5. Stale-response guards

**`useSelectChat`:** capture `dialogueId` + its state before `await getAnswerCheck`. The response may populate only that state's `renderedChat`. URL update and scroll run only if `currentChatId` still equals the captured id — A's late history response after selecting B never steals the foreground.

**`useRefreshMessage`:** capture the target dialogue state and message array before `await getQuery`. Replace only that array's indexed message. Scroll and error toast run only while that dialogue remains active; a background result updates A's data silently and never touches B's DOM.

### 6. Core Functions

#### getChatState(dialogueId: string)
```typescript
const getChatState = (dialogueId: string) => {
  if (!chatStates.value[dialogueId]) {
    chatStates.value[dialogueId] = {
      /* …defaults… */
      renderedChat: null,
    };
  }
  return chatStates.value[dialogueId];
};
```

#### currentChat keyed view
```typescript
const currentChat = computed({
  get: () => {
    if (!currentChatId.value) return null;
    return getChatState(currentChatId.value).renderedChat;
  },
  set: (value) => {
    if (!currentChatId.value) return;
    getChatState(currentChatId.value).renderedChat = value;
  },
});
```

## Feature Highlights

### 1. Parallel Processing
- Messages can be sent in multiple dialogues simultaneously
- Loading state of each dialogue is independent
- Fast switching between different dialogues is supported
- Full context of each dialogue is preserved, including live rendered messages

### 2. State Independence
- Each dialogue maintains its own input content, files, history, and UI maps
- Each dialogue owns its `renderedChat` message tree
- Switching A→B→A restores the exact same arrays / message / block objects

### 3. User Experience Improvements
- State is correctly restored when switching dialogues
- Input content is never lost
- File upload state is managed independently
- Message refresh works independently per dialogue without clobbering another transcript

## Technical Implementation Details

### 1. State Initialization
- Ensure dialogue state exists inside `selectChat()` / `getChatState()`
- Create new dialogue state inside `startNewChat()` and write `renderedChat: { messages: [] }` via `currentChat`
- Pending restore writes `getChatState(id).renderedChat` (and sets `currentChatId`) so hydration is not lost when the ID was previously empty

### 2. State Synchronization
- Use Vue 3 computed properties for reactive bindings
- Ensure the UI updates correctly when state changes
- Maintain compatibility with existing components that read `currentChat`

### 3. Error Handling
- Added null checks to prevent accessing non-existent dialogue state
- Ensure stale async history/refresh results cannot change another dialogue's message array or steal shell focus

## Testing

Covered by unit specs under `tests/unit/views/chat/`:

- A→B→A restores exact `renderedChat` / messages / block identities
- Temp→server rekey preserves `renderedChat` object identity
- Out-of-order A/B `selectChat` responses populate only their states
- Refresh while B is active updates only A's captured array (no B scroll/toast)

## Compatibility Notes

### Backward Compatibility
- Template and send consumers still use `currentChat` (now a computed view)
- Existing message-sending logic is not rewritten here (send/stream capture is a separate follow-up)
- File upload, logging, and refresh features continue to work

### Performance Optimizations
- Computed properties avoid unnecessary recomputation
- State is created on demand, avoiding memory waste
- Rekey moves references instead of deep-cloning message trees

## Usage Guide

### For Developers
1. State is automatically initialized when a new dialogue is created
2. The corresponding state is automatically loaded when switching dialogues
3. All state operations go through `getChatState()`; write rendered messages to that state's `renderedChat` (or via `currentChat` only when `currentChatId` matches)

### For Users
1. Multiple dialogues can be open at the same time
2. State is preserved when switching between dialogues
3. Input and files are independent per dialogue

## Summary

Each dialogue owns its live rendered Chat/messages in `chatStates[dialogueId].renderedChat`. `currentChat` is only the current-ID computed view. Rekey preserves object identity; select/refresh stale-response guards keep background completions from stealing URL, scroll, or another dialogue's transcript.

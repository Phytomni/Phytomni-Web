# vue3

This template should help get you started developing with Vue 3 in Vite.

## Recommended IDE Setup

[VSCode](https://code.visualstudio.com/) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur) + [TypeScript Vue Plugin (Volar)](https://marketplace.visualstudio.com/items?itemName=Vue.vscode-typescript-vue-plugin).

## Type Support for `.vue` Imports in TS

TypeScript cannot handle type information for `.vue` imports by default, so we replace the `tsc` CLI with `vue-tsc` for type checking. In editors, we need [TypeScript Vue Plugin (Volar)](https://marketplace.visualstudio.com/items?itemName=Vue.vscode-typescript-vue-plugin) to make the TypeScript language service aware of `.vue` types.

If the standalone TypeScript plugin doesn't feel fast enough to you, Volar has also implemented a [Take Over Mode](https://github.com/johnsoncodehk/volar/discussions/471#discussioncomment-1361669) that is more performant. You can enable it by the following steps:

1. Disable the built-in TypeScript Extension
   1. Run `Extensions: Show Built-in Extensions` from VSCode's command palette
   2. Find `TypeScript and JavaScript Language Features`, right click and select `Disable (Workspace)`
2. Reload the VSCode window by running `Developer: Reload Window` from the command palette.

## Customize configuration

See [Vite Configuration Reference](https://vitejs.dev/config/).

## Project Setup

```sh
npm install
```

### Compile and Hot-Reload for Development

```sh
npm run dev
```

### Type-Check, Compile and Minify for Production

```sh
npm run build
```

### Lint with [ESLint](https://eslint.org/)

```sh
npm run lint
npm run lint:raw       # diagnostic-only structured ESLint JSON
npm run format:write   # the explicit broad formatter write command
```

## SSH Public Key

```
ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQDhNlP2Lqes5MXsbuhl8ZTxCzm4mI0tvwDzI2+5CUlgapCocLVupYnzlE0Q34M9Uoq7ieEhdIxDiM6hbIkYDMQtQlDI+KRWIZUCBOgGQarFXsdsMqzvxezRzzkBXiiWkzVbzh5NfaqkbVNWyYYXxjvpvqn5geiffjhCMlxi3SOYXqCDzNpdHjqZKquKux+1egwsLi+BHAmFS+5m5p+uxRooBWqka46OS2sGFj4EAJYuIZGiD8U5j8ti9Npv8iLyMNce7KkrGvtx6zxAG0BVA9S2WnByaju9H9e3vnYT/Xz5K9uhOxLi/+sGHl4qy/CRt8VMz09yK2ciEld7VRrG3DhWV/oh19pfcTpYRSjtLthBOt5s/DJnRwGv2XSkWMKVYPxczrDHxIeQFE0fS3Vi38qK+YeYDK24CZ4SD7rVdduv57ac0aaTNgU13W7YvwbDk7oeSjWTTm9LJvzN0hxmMcuLHVO0VBXNp5NRlGDyMb/aZOQ1IIGQgntLPsFA7QqUWACO9TdbU2OErsEhN8/pmpomMk0l56LKzFHQwdXVgSuJfd/DdNm+Tn0B8WlLKYJuqzJFEBZ1drBKk9Jqr1yv+OLFXU1sWWcolO1AcPBym6qXB4BG0reBt9z+gZmk+R/TABfAQX3JITGOTnla+XMMUxdtJcTGSpBB1c3Elq9JONC5nw== Machinst_wq@163.com
```

# Chat AI

An intelligent chat system that supports parallel handling of multiple conversations.

## Features

### Conversation independence
- Each conversation has its own independent state management
- Supports parallel handling of multiple conversations
- Each conversation maintains its own:
  - Sending state (`isSending`)
  - Input content (`messageInput`)
  - File list (`fileList`)
  - History (`historyQuestion`)
  - Copy state (`copyVisible`, `copyTimeRef`)
  - Log data (`logData`, `loadingLog`)
  - Refresh state (`refreshingMessages`)

### Parallel processing
- Can send messages in multiple conversations at the same time
- Each conversation's loading state is independent of the others
- Supports fast switching between conversations
- Preserves the full context of each conversation

### State management
- Uses the `chatStates` object to manage all conversation state
- Gets or creates conversation state via the `getChatState()` function
- Uses computed properties for reactive state binding
- Ensures state is correctly restored when switching conversations

## Implementation

### Core architecture
```typescript
// Conversation state management
const chatStates = ref<Record<string, {
  isSending: boolean;
  messageInput: string;
  fileList: UploadFile[];
  historyQuestion: any;
  copyVisible: number;
  copyTimeRef: number | undefined;
  logData: Record<string, any>;
  loadingLog: Record<string, boolean>;
  refreshingMessages: Record<string, boolean>;
}>>({});

// Get or create conversation state
const getChatState = (dialogueId: string) => {
  if (!chatStates.value[dialogueId]) {
    chatStates.value[dialogueId] = {
      // Initialize state
    };
  }
  return chatStates.value[dialogueId];
};
```

### Reactive state binding
```typescript
// Input content — based on the current conversation
const messageInput = computed({
  get: () => {
    if (!currentChatId.value) return '';
    return getChatState(currentChatId.value).messageInput;
  },
  set: (value: string) => {
    if (!currentChatId.value) return;
    getChatState(currentChatId.value).messageInput = value;
  }
});
```

## Usage

1. **Create a new conversation**: click the "New conversation" button in the sidebar
2. **Switch conversations**: click any conversation in the sidebar to switch to it
3. **Parallel send**: send messages in different conversations at the same time
4. **State persistence**: switching conversations preserves each conversation's full state

## Development notes

- All conversation-related state is managed through `chatStates`
- Use `currentChatId` to identify the currently active conversation
- Reactive state updates are implemented via computed properties
- Ensure each conversation's independence to avoid state conflicts

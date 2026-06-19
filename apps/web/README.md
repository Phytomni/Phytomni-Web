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
```

## SSH Public Key

```
ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQDhNlP2Lqes5MXsbuhl8ZTxCzm4mI0tvwDzI2+5CUlgapCocLVupYnzlE0Q34M9Uoq7ieEhdIxDiM6hbIkYDMQtQlDI+KRWIZUCBOgGQarFXsdsMqzvxezRzzkBXiiWkzVbzh5NfaqkbVNWyYYXxjvpvqn5geiffjhCMlxi3SOYXqCDzNpdHjqZKquKux+1egwsLi+BHAmFS+5m5p+uxRooBWqka46OS2sGFj4EAJYuIZGiD8U5j8ti9Npv8iLyMNce7KkrGvtx6zxAG0BVA9S2WnByaju9H9e3vnYT/Xz5K9uhOxLi/+sGHl4qy/CRt8VMz09yK2ciEld7VRrG3DhWV/oh19pfcTpYRSjtLthBOt5s/DJnRwGv2XSkWMKVYPxczrDHxIeQFE0fS3Vi38qK+YeYDK24CZ4SD7rVdduv57ac0aaTNgU13W7YvwbDk7oeSjWTTm9LJvzN0hxmMcuLHVO0VBXNp5NRlGDyMb/aZOQ1IIGQgntLPsFA7QqUWACO9TdbU2OErsEhN8/pmpomMk0l56LKzFHQwdXVgSuJfd/DdNm+Tn0B8WlLKYJuqzJFEBZ1drBKk9Jqr1yv+OLFXU1sWWcolO1AcPBym6qXB4BG0reBt9z+gZmk+R/TABfAQX3JITGOTnla+XMMUxdtJcTGSpBB1c3Elq9JONC5nw== Machinst_wq@163.com
```

# Chat AI

一个支持多对话并行处理的智能聊天系统。

## 新功能特性

### 对话独立性
- 每个对话都有独立的状态管理
- 支持多对话并行处理
- 每个对话维护独立的：
  - 发送状态 (`isSending`)
  - 输入内容 (`messageInput`)
  - 文件列表 (`fileList`)
  - 历史记录 (`historyQuestion`)
  - 复制状态 (`copyVisible`, `copyTimeRef`)
  - 日志数据 (`logData`, `loadingLog`)
  - 刷新状态 (`refreshingMessages`)

### 并行处理能力
- 可以在多个对话中同时发送消息
- 每个对话的加载状态互不影响
- 支持在不同对话间快速切换
- 保持每个对话的完整上下文

### 状态管理优化
- 使用 `chatStates` 对象管理所有对话状态
- 通过 `getChatState()` 函数获取或创建对话状态
- 使用 computed 属性实现响应式状态绑定
- 确保对话切换时状态正确恢复

## 技术实现

### 核心架构
```typescript
// 对话状态管理
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

// 获取或创建对话状态
const getChatState = (dialogueId: string) => {
  if (!chatStates.value[dialogueId]) {
    chatStates.value[dialogueId] = {
      // 初始化状态
    };
  }
  return chatStates.value[dialogueId];
};
```

### 响应式状态绑定
```typescript
// 输入框内容 - 基于当前对话
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

## 使用方法

1. **创建新对话**：点击侧边栏的"新对话"按钮
2. **切换对话**：在侧边栏点击任意对话进行切换
3. **并行发送**：可以在不同对话中同时发送消息
4. **状态保持**：切换对话时会保持每个对话的完整状态

## 开发说明

- 所有对话相关的状态都通过 `chatStates` 进行管理
- 使用 `currentChatId` 来标识当前活跃的对话
- 通过 computed 属性实现状态的响应式更新
- 确保每个对话的独立性，避免状态冲突

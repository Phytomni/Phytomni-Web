<script lang="ts">
import type { Chat as ChatRecord } from "../types";

export type ChatHistoryGroupKey = "today" | "yesterday" | "week" | "older";
export type ChatHistoryGroupLabelKey = `chat.timeGroup.${ChatHistoryGroupKey}`;

export interface ChatHistoryGroup {
  key: ChatHistoryGroupKey;
  labelKey: ChatHistoryGroupLabelKey;
  items: ChatRecord[];
}
</script>

<template>
  <div class="chat-history">
    <template v-if="!collapsed">
      <div v-for="group in visibleGroups" :key="group.key" class="time-group">
        <button
          type="button"
          class="time-label"
          :aria-expanded="expandedGroups[group.key]"
          @click="emit('toggle-group', group.key)"
        >
          <span>{{ $t(group.labelKey) }}</span>
          <el-icon
            class="expand-icon"
            :class="{ expanded: expandedGroups[group.key] }"
          >
            <ArrowDown />
          </el-icon>
        </button>
        <div class="chat-items" v-show="expandedGroups[group.key]">
          <el-tooltip
            v-for="chat in group.items"
            :key="chat.id"
            :content="chat.title"
            placement="right"
            :show-after="1000"
            popper-class="chat-tooltip"
          >
            <div
              class="chat-item"
              :class="{ active: currentChatId === chat.dialogue_id }"
            >
              <button
                type="button"
                class="chat-select"
                :aria-current="
                  currentChatId === chat.dialogue_id ? 'page' : undefined
                "
                @click="emit('select', chat.dialogue_id)"
              >
                <span class="chat-title">{{ chat.title }}</span>
              </button>
              <div class="chat-actions" @click.stop>
                <el-dropdown
                  trigger="click"
                  @command="emitAction($event, chat)"
                >
                  <el-icon class="action-icon">
                    <MoreFilled />
                  </el-icon>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="rename" :icon="Edit">
                        {{ $t("chat.actions.rename") }}
                      </el-dropdown-item>
                      <el-dropdown-item command="favorite" :icon="Star">
                        {{
                          chat.isFavorite
                            ? $t("chat.actions.unfavorite")
                            : $t("chat.actions.favorite")
                        }}
                      </el-dropdown-item>
                      <el-dropdown-item command="delete" :icon="Delete" divided>
                        <span class="danger-label">
                          {{ $t("chat.actions.delete") }}
                        </span>
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </div>
          </el-tooltip>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  ArrowDown,
  Delete,
  Edit,
  MoreFilled,
  Star,
} from "@element-plus/icons-vue";
import type { Chat } from "../types";

const props = withDefaults(
  defineProps<{
    groups: ChatHistoryGroup[];
    currentChatId: string;
    expandedGroups: Record<ChatHistoryGroupKey, boolean>;
    collapsed?: boolean;
  }>(),
  {
    collapsed: false,
  }
);

const visibleGroups = computed(() =>
  props.groups.filter((group) => group.items.length > 0)
);

const emit = defineEmits<{
  (event: "select", dialogueId: string): void;
  (event: "toggle-group", groupKey: ChatHistoryGroupKey): void;
  (event: "action", command: string, chat: Chat): void;
}>();

const emitAction = (command: string, chat: Chat) => {
  emit("action", command, chat);
};
</script>

<style lang="scss" scoped>
.chat-history {
  flex: 1;
  overflow-y: auto;
  padding: 0 var(--phy-space-8) var(--phy-space-8);
  height: 100%;
  min-height: 0;
  scrollbar-gutter: stable;

  .time-group {
    margin-bottom: var(--phy-space-8);

    .time-label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      min-height: var(--phy-control-height-compact);
      padding: var(--phy-space-4) var(--phy-space-8);
      border: 0;
      border-radius: var(--phy-radius-sm);
      background: transparent;
      color: var(--phy-color-text-muted);
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.02em;
      text-align: left;
      cursor: pointer;
      user-select: none;

      &:hover {
        color: var(--phy-color-text-secondary);
      }

      &:focus-visible {
        outline: 2px solid var(--phy-color-focus);
        outline-offset: -2px;
      }

      .expand-icon {
        font-size: 12px;
        transition: transform var(--phy-motion-fast) ease;

        &.expanded {
          transform: rotate(180deg);
        }
      }
    }

    .chat-items {
      padding: 0;

      .chat-item {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: var(--phy-control-height-default);
        margin: 1px 0;
        border-radius: var(--phy-radius-md);
        color: var(--phy-color-text-secondary);

        .chat-select {
          display: flex;
          flex: 1;
          align-items: center;
          min-width: 0;
          min-height: var(--phy-control-height-default);
          padding: 0 var(--phy-space-8);
          border: 0;
          border-radius: inherit;
          background: transparent;
          color: inherit;
          font: inherit;
          font-size: 13px;
          text-align: left;
          cursor: pointer;

          &:focus-visible {
            outline: 2px solid var(--phy-color-focus);
            outline-offset: -2px;
          }
        }

        .chat-title {
          display: block;
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          width: 100%;
        }

        .chat-actions {
          margin-right: var(--phy-space-4);
          flex-shrink: 0;
          opacity: 0;
          transition: opacity var(--phy-motion-fast) ease;
          display: flex;

          .action-icon {
            font-size: 16px;
            color: var(--phy-color-text-muted);
            cursor: pointer;
            padding: var(--phy-space-4);
            border-radius: var(--phy-radius-sm);

            &:hover {
              background-color: var(--phy-color-primary-soft);
              color: var(--phy-color-action-text);
            }
          }
        }

        &:hover .chat-actions,
        &:focus-within .chat-actions {
          opacity: 1;
        }

        &:hover {
          background-color: var(--phy-color-fill-subtle);
          color: var(--phy-color-text);
        }

        &.active {
          background-color: var(--phy-color-primary-soft);
          color: var(--phy-color-action-text);
          font-weight: 500;

          &::before {
            position: absolute;
            inset-block: var(--phy-space-8);
            inset-inline-start: 0;
            width: 2px;
            border-radius: var(--phy-radius-pill);
            background: var(--phy-color-action-fill);
            content: "";
          }
        }
      }
    }
  }
}

.danger-label {
  color: var(--el-color-danger);
}

@media (hover: none) {
  .chat-history .time-group .chat-items .chat-item .chat-actions {
    opacity: 1;
  }
}
</style>

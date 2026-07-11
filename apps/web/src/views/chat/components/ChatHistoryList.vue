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
        <div class="time-label" @click="emit('toggle-group', group.key)">
          <span>{{ $t(group.labelKey) }}</span>
          <el-icon
            class="expand-icon"
            :class="{ expanded: expandedGroups[group.key] }"
          >
            <ArrowDown />
          </el-icon>
        </div>
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
              @click="emit('select', chat.dialogue_id)"
            >
              <span class="chat-title">{{ chat.title }}</span>
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
                        <span style="color: #f56c6c">{{
                          $t("chat.actions.delete")
                        }}</span>
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
  padding: 8px;
  height: 100%;
  min-height: 400px;

  .time-group {
    margin-bottom: 16px;

    .time-label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 16px;
      color: var(--phy-color-text-secondary);
      font-size: 14px;
      cursor: pointer;
      user-select: none;

      .expand-icon {
        transition: transform 0.2s ease;

        &.expanded {
          transform: rotate(180deg);
        }
      }
    }

    .chat-items {
      padding: 0 8px;

      .chat-item {
        padding: 10px 16px;
        margin: 4px 0;
        border-radius: 8px;
        cursor: pointer;
        font-size: 14px;
        color: var(--phy-color-text);
        display: flex;
        align-items: center;
        justify-content: space-between;

        .chat-title {
          display: block;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          width: 100%;
        }

        .chat-actions {
          margin-left: 10px;
          flex-shrink: 0;
          opacity: 0;
          transition: opacity 0.2s ease;
          display: flex;

          .action-icon {
            font-size: 18px;
            color: #909399;
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;

            &:hover {
              background-color: var(--phy-color-primary-soft);
              color: var(--phy-color-primary);
            }
          }
        }

        &:hover .chat-actions {
          opacity: 1;
        }

        &:hover {
          background-color: var(--phy-color-primary-soft);
        }

        &.active {
          background-color: var(--phy-color-primary-soft);
          font-weight: 500;
        }
      }
    }
  }
}
</style>

import { computed } from "vue";
import type { Ref } from "vue";
import type { Chat } from "../types";

export function useChatHistoryGroups(chatList: Ref<Chat[]>) {
  // 按日期分组
  const todayChats = computed(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // 设置为今天的开始时间

    return chatList.value.filter((chat: Chat) => {
      const chatDate = new Date(chat.date);
      return chatDate >= today;
    });
  });

  const yesterdayChats = computed(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // 今天的开始时间

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1); // 昨天的开始时间

    return chatList.value.filter((chat: Chat) => {
      const chatDate = new Date(chat.date);
      return chatDate >= yesterday && chatDate < today;
    });
  });

  const weekChats = computed(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // 今天的开始时间

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1); // 昨天的开始时间

    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7); // 7天前的开始时间

    return chatList.value.filter((chat: Chat) => {
      const chatDate = new Date(chat.date);
      return chatDate >= weekAgo && chatDate < yesterday;
    });
  });

  // 添加一周前的聊天记录
  const olderChats = computed(() => {
    const weekAgo = new Date();
    weekAgo.setHours(0, 0, 0, 0); // 今天的开始时间
    weekAgo.setDate(weekAgo.getDate() - 7); // 7天前的开始时间

    return chatList.value.filter((chat: Chat) => {
      const chatDate = new Date(chat.date);
      return chatDate < weekAgo;
    });
  });

  return { todayChats, yesterdayChats, weekChats, olderChats };
}

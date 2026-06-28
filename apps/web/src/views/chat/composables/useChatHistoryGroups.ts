import { computed } from "vue";
import type { Ref } from "vue";
import type { Chat } from "../types";

export function useChatHistoryGroups(chatList: Ref<Chat[]>) {
  // group by date
  const todayChats = computed(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // set to the start of today

    return chatList.value.filter((chat: Chat) => {
      const chatDate = new Date(chat.date);
      return chatDate >= today;
    });
  });

  const yesterdayChats = computed(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // start of today

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1); // start of yesterday

    return chatList.value.filter((chat: Chat) => {
      const chatDate = new Date(chat.date);
      return chatDate >= yesterday && chatDate < today;
    });
  });

  const weekChats = computed(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // start of today

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1); // start of yesterday

    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7); // start of 7 days ago

    return chatList.value.filter((chat: Chat) => {
      const chatDate = new Date(chat.date);
      return chatDate >= weekAgo && chatDate < yesterday;
    });
  });

  // chats older than a week
  const olderChats = computed(() => {
    const weekAgo = new Date();
    weekAgo.setHours(0, 0, 0, 0); // start of today
    weekAgo.setDate(weekAgo.getDate() - 7); // start of 7 days ago

    return chatList.value.filter((chat: Chat) => {
      const chatDate = new Date(chat.date);
      return chatDate < weekAgo;
    });
  });

  return { todayChats, yesterdayChats, weekChats, olderChats };
}

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ref } from "vue";
import { useChatHistoryGroups } from "@/views/chat/composables/useChatHistoryGroups";
import type { Chat } from "@/views/chat/types";
import { buildChat } from "../../../helpers/chatBuilders";

// Frozen clock: 2026-06-16T12:00:00 UTC
// today midnight  = 2026-06-16T00:00:00
// yesterday mid.  = 2026-06-15T00:00:00
// weekAgo mid.    = 2026-06-09T00:00:00

const NOW = new Date("2026-06-16T12:00:00");
const TODAY_MID = new Date("2026-06-16T00:00:00"); // included in todayChats
const YESTERDAY_MID = new Date("2026-06-15T00:00:00"); // lower bound of yesterdayChats (inclusive)
const THREE_DAYS_AGO = new Date("2026-06-13T10:00:00"); // in weekChats
const WEEK_AGO_MID = new Date("2026-06-09T00:00:00"); // lower bound of weekChats (inclusive); upper of olderChats (exclusive)
const TEN_DAYS_AGO = new Date("2026-06-06T08:00:00"); // in olderChats

function makeChat(id: number, date: Date): Chat {
  return buildChat({
    id,
    dialogue_id: `d${id}`,
    title: `Chat ${id}`,
    date: date.toISOString(),
  });
}

describe("useChatHistoryGroups", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── todayChats ──────────────────────────────────────────────────────────────

  it("todayChats: includes a chat from today at noon", () => {
    const todayNoon = makeChat(1, new Date("2026-06-16T09:00:00"));
    const chatList = ref<Chat[]>([todayNoon]);
    const { todayChats } = useChatHistoryGroups(chatList);
    expect(todayChats.value.map((c) => c.id)).toContain(1);
  });

  it("todayChats: includes a chat exactly at today midnight (today lower boundary inclusive)", () => {
    const atMidnight = makeChat(2, TODAY_MID);
    const chatList = ref<Chat[]>([atMidnight]);
    const { todayChats } = useChatHistoryGroups(chatList);
    expect(todayChats.value.map((c) => c.id)).toContain(2);
  });

  // ── yesterdayChats ──────────────────────────────────────────────────────────

  it("yesterdayChats: includes a chat from yesterday morning", () => {
    const yesterdayMorning = makeChat(3, new Date("2026-06-15T10:00:00"));
    const chatList = ref<Chat[]>([yesterdayMorning]);
    const { yesterdayChats } = useChatHistoryGroups(chatList);
    expect(yesterdayChats.value.map((c) => c.id)).toContain(3);
  });

  it("yesterdayChats: includes a chat exactly at yesterday midnight (lower boundary inclusive)", () => {
    const atYesterdayMid = makeChat(4, YESTERDAY_MID);
    const chatList = ref<Chat[]>([atYesterdayMid]);
    const { yesterdayChats } = useChatHistoryGroups(chatList);
    expect(yesterdayChats.value.map((c) => c.id)).toContain(4);
  });

  it("yesterdayChats: excludes a chat exactly at today midnight (upper boundary exclusive)", () => {
    const atTodayMid = makeChat(5, TODAY_MID);
    const chatList = ref<Chat[]>([atTodayMid]);
    const { yesterdayChats } = useChatHistoryGroups(chatList);
    expect(yesterdayChats.value.map((c) => c.id)).not.toContain(5);
  });

  // ── weekChats ───────────────────────────────────────────────────────────────

  it("weekChats: includes a chat from 3 days ago", () => {
    const threeDaysAgo = makeChat(6, THREE_DAYS_AGO);
    const chatList = ref<Chat[]>([threeDaysAgo]);
    const { weekChats } = useChatHistoryGroups(chatList);
    expect(weekChats.value.map((c) => c.id)).toContain(6);
  });

  it("weekChats: includes a chat exactly at weekAgo midnight (lower boundary inclusive)", () => {
    const atWeekAgoMid = makeChat(7, WEEK_AGO_MID);
    const chatList = ref<Chat[]>([atWeekAgoMid]);
    const { weekChats } = useChatHistoryGroups(chatList);
    expect(weekChats.value.map((c) => c.id)).toContain(7);
  });

  it("weekChats: excludes a chat exactly at yesterday midnight (upper boundary exclusive)", () => {
    const atYesterdayMid = makeChat(8, YESTERDAY_MID);
    const chatList = ref<Chat[]>([atYesterdayMid]);
    const { weekChats } = useChatHistoryGroups(chatList);
    expect(weekChats.value.map((c) => c.id)).not.toContain(8);
  });

  // ── olderChats ──────────────────────────────────────────────────────────────

  it("olderChats: includes a chat from 10 days ago", () => {
    const tenDaysAgo = makeChat(9, TEN_DAYS_AGO);
    const chatList = ref<Chat[]>([tenDaysAgo]);
    const { olderChats } = useChatHistoryGroups(chatList);
    expect(olderChats.value.map((c) => c.id)).toContain(9);
  });

  it("olderChats: excludes a chat exactly at weekAgo midnight (boundary is exclusive for olderChats)", () => {
    const atWeekAgoMid = makeChat(10, WEEK_AGO_MID);
    const chatList = ref<Chat[]>([atWeekAgoMid]);
    const { olderChats } = useChatHistoryGroups(chatList);
    expect(olderChats.value.map((c) => c.id)).not.toContain(10);
  });

  // ── reactivity ──────────────────────────────────────────────────────────────

  it("reactivity: todayChats updates when chatList ref is mutated", () => {
    const chatList = ref<Chat[]>([]);
    const { todayChats } = useChatHistoryGroups(chatList);

    expect(todayChats.value).toHaveLength(0);

    chatList.value = [makeChat(11, new Date("2026-06-16T08:30:00"))];
    expect(todayChats.value.map((c) => c.id)).toContain(11);
  });

  // ── no-overlap coverage (partition sanity) ──────────────────────────────────

  it("each representative chat lands in exactly one group with no overlaps", () => {
    const chats: Chat[] = [
      makeChat(20, new Date("2026-06-16T09:00:00")), // today
      makeChat(21, new Date("2026-06-15T10:00:00")), // yesterday
      makeChat(22, THREE_DAYS_AGO), // this week
      makeChat(23, TEN_DAYS_AGO), // older
    ];
    const chatList = ref<Chat[]>(chats);
    const { todayChats, yesterdayChats, weekChats, olderChats } =
      useChatHistoryGroups(chatList);

    expect(todayChats.value.map((c) => c.id)).toEqual([20]);
    expect(yesterdayChats.value.map((c) => c.id)).toEqual([21]);
    expect(weekChats.value.map((c) => c.id)).toEqual([22]);
    expect(olderChats.value.map((c) => c.id)).toEqual([23]);

    // Verify the union covers all 4 chats (no gaps)
    const allIds = [
      ...todayChats.value,
      ...yesterdayChats.value,
      ...weekChats.value,
      ...olderChats.value,
    ].map((c) => c.id);
    expect(allIds.sort()).toEqual([20, 21, 22, 23]);
  });
});

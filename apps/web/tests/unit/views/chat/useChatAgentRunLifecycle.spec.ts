import { nextTick, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentTaskLifecycle, ApiEnvelope } from "@/api/types";
import {
  buildChatMessage,
  buildChatState,
} from "../../../helpers/chatBuilders";
import { useChatAgentRunLifecycle } from "@/views/chat/composables/useChatAgentRunLifecycle";

function lifecycle(
  id: number,
  overrides: Partial<AgentTaskLifecycle> = {}
): AgentTaskLifecycle {
  return {
    id,
    phase: "PREPARING",
    terminal: false,
    child_task_count: 0,
    child_work_accepted: false,
    report_revision: 0,
    artifact_summary: {
      image_count: 0,
      output_directory_count: 0,
      has_report: false,
    },
    reconciliation: "FRESH",
    tracking_degraded: false,
    error_code: null,
    ...overrides,
  };
}

function response(data: AgentTaskLifecycle): ApiEnvelope<AgentTaskLifecycle> {
  return { code: 200, data };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await nextTick();
}

describe("useChatAgentRunLifecycle", () => {
  afterEach(() => vi.useRealTimers());

  it("watches nonterminal background rows in every hydrated dialogue and reloads only material changes", async () => {
    vi.useFakeTimers();
    const stateA = buildChatState({
      historyHydration: "ready",
      renderedChat: {
        messages: [
          buildChatMessage({
            id: "41",
            tool_name: "AnalystAgent",
            status: "RUNNING",
          }),
        ],
      },
    });
    const stateB = buildChatState({
      historyHydration: "ready",
      renderedChat: {
        messages: [
          buildChatMessage({
            id: "42",
            tool_name: "GeneNetworkAgent",
            status: "RUNNING",
          }),
        ],
      },
    });
    const chatStates = ref({ a: stateA, b: stateB });
    const calls = new Map<string, number>();
    const fetchLifecycle = vi.fn((rowId: string) => {
      const count = (calls.get(rowId) ?? 0) + 1;
      calls.set(rowId, count);
      return Promise.resolve(
        response(
          lifecycle(Number(rowId), {
            phase: rowId === "41" && count > 1 ? "RUNNING" : "PREPARING",
          })
        )
      );
    });
    const reloadChat = vi.fn().mockResolvedValue(undefined);
    const coordinator = useChatAgentRunLifecycle({
      chatStates,
      getChatState: (dialogueId) => chatStates.value[dialogueId],
      reloadChat,
      fetchLifecycle,
      jitter: () => 0,
    });

    await flush();
    expect(fetchLifecycle.mock.calls.map(([rowId]) => rowId).sort()).toEqual([
      "41",
      "42",
    ]);
    expect(reloadChat).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    await flush();

    expect(reloadChat).toHaveBeenCalledTimes(1);
    expect(reloadChat).toHaveBeenCalledWith("a");
    expect(stateA.agentRunLifecycles["41"]?.phase).toBe("RUNNING");
    expect(stateB.agentRunLifecycles["42"]?.phase).toBe("PREPARING");
    coordinator.dispose();
  });

  it("excludes synchronous, Deep Genome, malformed, and terminal history rows", async () => {
    const state = buildChatState({
      historyHydration: "ready",
      renderedChat: {
        messages: [
          buildChatMessage({
            id: "51",
            tool_name: "ChatAgent",
            status: "RUNNING",
          }),
          buildChatMessage({
            id: "52",
            tool_name: "DeepGenomeAgent",
            status: "RUNNING",
          }),
          buildChatMessage({
            id: "bad",
            tool_name: "AnalystAgent",
            status: "RUNNING",
          }),
          buildChatMessage({
            id: "53",
            tool_name: "AnalystAgent",
            status: "SUCCEEDED",
          }),
          buildChatMessage({
            id: "54",
            tool_name: "DigitalDesignAgent",
            status: "RUNNING",
          }),
        ],
      },
    });
    const chatStates = ref({ a: state });
    const fetchLifecycle = vi.fn().mockResolvedValue(response(lifecycle(54)));
    const coordinator = useChatAgentRunLifecycle({
      chatStates,
      getChatState: (dialogueId) => chatStates.value[dialogueId],
      reloadChat: vi.fn().mockResolvedValue(undefined),
      fetchLifecycle,
    });

    await flush();
    expect(fetchLifecycle.mock.calls.map(([rowId]) => rowId)).toEqual(["54"]);
    coordinator.dispose();
  });

  it("stops late lifecycle snapshots after a dialogue is removed or disposed", async () => {
    let resolve!: (value: ApiEnvelope<AgentTaskLifecycle>) => void;
    const pending = new Promise<ApiEnvelope<AgentTaskLifecycle>>((settle) => {
      resolve = settle;
    });
    const state = buildChatState({
      historyHydration: "ready",
      agentRunLifecycles: { "61": lifecycle(61) },
      renderedChat: {
        messages: [
          buildChatMessage({
            id: "61",
            tool_name: "AnalystAgent",
            status: "RUNNING",
          }),
        ],
      },
    });
    const chatStates = ref({ a: state });
    const reloadChat = vi.fn().mockResolvedValue(undefined);
    const coordinator = useChatAgentRunLifecycle({
      chatStates,
      getChatState: (dialogueId) => chatStates.value[dialogueId],
      reloadChat,
      fetchLifecycle: vi.fn().mockReturnValue(pending),
    });

    await flush();
    chatStates.value = {};
    await flush();
    resolve(response(lifecycle(61, { phase: "RUNNING" })));
    await flush();
    coordinator.dispose();

    expect(reloadChat).not.toHaveBeenCalled();
  });

  it("disposes only the deleted dialogue controller before its state is removed", async () => {
    let resolve!: (value: ApiEnvelope<AgentTaskLifecycle>) => void;
    const pending = new Promise<ApiEnvelope<AgentTaskLifecycle>>((settle) => {
      resolve = settle;
    });
    const stateA = buildChatState({
      historyHydration: "ready",
      agentRunLifecycles: { "71": lifecycle(71) },
      renderedChat: {
        messages: [
          buildChatMessage({
            id: "71",
            tool_name: "AnalystAgent",
            status: "RUNNING",
          }),
        ],
      },
    });
    const stateB = buildChatState({
      historyHydration: "ready",
      renderedChat: {
        messages: [
          buildChatMessage({
            id: "72",
            tool_name: "GeneNetworkAgent",
            status: "RUNNING",
          }),
        ],
      },
    });
    const chatStates = ref({ a: stateA, b: stateB });
    const reloadChat = vi.fn().mockResolvedValue(undefined);
    const coordinator = useChatAgentRunLifecycle({
      chatStates,
      getChatState: (dialogueId) => chatStates.value[dialogueId],
      reloadChat,
      fetchLifecycle: vi.fn((rowId: string) =>
        rowId === "71" ? pending : Promise.resolve(response(lifecycle(72)))
      ),
    });

    await flush();
    (
      coordinator as unknown as {
        disposeDialogue: (dialogueId: string) => void;
      }
    ).disposeDialogue("a");
    delete chatStates.value.a;
    resolve(response(lifecycle(71, { phase: "RUNNING" })));
    await flush();

    expect(reloadChat).not.toHaveBeenCalledWith("a");
    expect(stateB.agentRunLifecycles["72"]?.id).toBe(72);
    coordinator.dispose();
  });

  it("keeps a duplicated malformed row ownership in the first hydrated dialogue", async () => {
    const stateA = buildChatState({
      historyHydration: "ready",
      renderedChat: {
        messages: [
          buildChatMessage({
            id: "71",
            tool_name: "AnalystAgent",
            status: "RUNNING",
          }),
        ],
      },
    });
    const stateB = buildChatState({
      historyHydration: "ready",
      renderedChat: {
        messages: [
          buildChatMessage({
            id: "71",
            tool_name: "AnalystAgent",
            status: "RUNNING",
          }),
        ],
      },
    });
    const chatStates = ref({ a: stateA, b: stateB });
    const coordinator = useChatAgentRunLifecycle({
      chatStates,
      getChatState: (dialogueId) => chatStates.value[dialogueId],
      reloadChat: vi.fn().mockResolvedValue(undefined),
      fetchLifecycle: vi.fn().mockResolvedValue(response(lifecycle(71))),
    });

    await flush();

    expect(stateA.agentRunLifecycles["71"]?.id).toBe(71);
    expect(stateB.agentRunLifecycles["71"]).toBeUndefined();
    coordinator.dispose();
  });

  it("unwatches terminal lifecycle snapshots without scheduling another poll", async () => {
    vi.useFakeTimers();
    const state = buildChatState({
      historyHydration: "ready",
      renderedChat: {
        messages: [
          buildChatMessage({
            id: "81",
            tool_name: "DigitalDesignAgent",
            status: "RUNNING",
          }),
        ],
      },
    });
    const chatStates = ref({ a: state });
    const fetchLifecycle = vi
      .fn()
      .mockResolvedValue(
        response(lifecycle(81, { phase: "SUCCEEDED", terminal: true }))
      );
    const reloadChat = vi.fn(async () => {
      state.renderedChat = {
        messages: [
          buildChatMessage({
            id: "81",
            tool_name: "DigitalDesignAgent",
            status: "SUCCEEDED",
            content: "completed design",
          }),
        ],
      };
    });
    const coordinator = useChatAgentRunLifecycle({
      chatStates,
      getChatState: (dialogueId) => chatStates.value[dialogueId],
      reloadChat,
      fetchLifecycle,
      jitter: () => 0,
    });

    await flush();
    await vi.advanceTimersByTimeAsync(60000);

    expect(state.agentRunLifecycles["81"]?.terminal).toBe(true);
    expect(reloadChat).toHaveBeenCalledOnce();
    expect(state.renderedChat?.messages[0]?.content).toBe("completed design");
    expect(fetchLifecycle).toHaveBeenCalledOnce();
    coordinator.dispose();
  });
});

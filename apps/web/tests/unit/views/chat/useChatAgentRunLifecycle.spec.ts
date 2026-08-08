import { nextTick, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentTaskLifecycle, ApiEnvelope } from "@/api/types";
import {
  buildChatMessage,
  buildChatState,
} from "../../../helpers/chatBuilders";
import { deferred } from "../../../helpers/mockFactories";
import { useChatAgentRunLifecycle } from "@/views/chat/composables/useChatAgentRunLifecycle";

const SAFE_RESEARCH_PATH_LINES = [
  "/fixtures/rice-root/GSE146033_RAW/GSM4363196_9311RPM.txt.gz",
  "/fixtures/rice-root/GSE146033_RAW/GSM4363198_Nip_RPM.txt.gz",
  "/fixtures/rice-root/GSM4363200_9311/GSM4363200_9311_barcodes.tsv.gz",
  "/fixtures/rice-root/GSM4363200_9311/GSM4363200_9311_genes.tsv.gz",
  "/fixtures/rice-root/GSM4363200_9311/GSM4363200_9311_matrix.mtx.gz",
  "/fixtures/rice-root/GSM4363201_Nip/GSM4363201_Nip_barcodes.tsv.gz",
  "/fixtures/rice-root/GSM4363201_Nip/GSM4363201_Nip_genes.tsv.gz",
  "/fixtures/rice-root/GSM4363201_Nip/GSM4363201_Nip_matrix.mtx.gz",
  "/fixtures/rice-root/Orthologues/Orthologues_A_thaliana_pep/A_thaliana_pep__v__NIP_genome_pep.tsv",
  "/fixtures/rice-root/Orthologues/Orthologues_NIP_genome_pep/NIP_genome_pep__v__A_thaliana_pep.tsv",
  "/fixtures/rice-root/org.Osativa.eg.db.tar.gz",
] as const;

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

  it("keeps the live Research stage sequence owner-scoped until one terminal hydration", async () => {
    vi.useFakeTimers();
    const rawQuery = [
      "Synthetic paper excerpt:",
      "The fixture compares two rice-root sample groups.",
      "",
      "data:",
      ...SAFE_RESEARCH_PATH_LINES,
    ].join("\n");
    const phases = [
      "PREPARING",
      "RESOLVING_INPUTS",
      "PLANNING",
      "RUNNING",
      "FINALIZING",
      "SUCCEEDED",
    ] as const;
    const state = buildChatState({
      historyHydration: "ready",
      renderedChat: {
        dialogue_id: "research",
        messages: [
          buildChatMessage({
            role: "user",
            content: rawQuery,
          }),
          buildChatMessage({
            id: "151",
            tool_name: "InSilicoResearchAgent",
            status: "RUNNING",
            content: "",
          }),
        ],
      },
    });
    const chatStates = ref({ research: state });
    const fetchLifecycle = vi.fn();
    for (const phase of phases) {
      fetchLifecycle.mockResolvedValueOnce(
        response(
          lifecycle(151, {
            phase,
            terminal: phase === "SUCCEEDED",
          })
        )
      );
    }
    const reloadChat = vi.fn(async () => {
      if (state.renderedChat) {
        state.renderedChat.messages[1] = {
          ...state.renderedChat.messages[1],
          status: "SUCCEEDED",
          content: "Final Research report",
        };
      }
      return "applied" as const;
    });
    const coordinator = useChatAgentRunLifecycle({
      chatStates,
      getChatState: (dialogueId) => chatStates.value[dialogueId],
      reloadChat,
      fetchLifecycle,
      jitter: () => 0,
    });

    for (const [index, phase] of phases.entries()) {
      if (index > 0) await vi.advanceTimersByTimeAsync(1000);
      await flush();
      expect(state.agentRunLifecycles["151"]?.phase).toBe(phase);
      expect(fetchLifecycle).toHaveBeenCalledTimes(index + 1);
      if (phase !== "SUCCEEDED") {
        expect(reloadChat).not.toHaveBeenCalled();
        expect(state.renderedChat?.messages[1]).toMatchObject({
          status: "RUNNING",
          content: "",
        });
      }
      expect(state.renderedChat?.messages[0]?.content).toBe(rawQuery);
      expect(
        state.renderedChat?.messages[0]?.content.split("\n").slice(-11)
      ).toEqual(SAFE_RESEARCH_PATH_LINES);
    }

    expect(reloadChat).toHaveBeenCalledOnce();
    expect(state.agentRunLifecycles["151"]).toMatchObject({
      phase: "SUCCEEDED",
      terminal: true,
    });
    expect(state.renderedChat?.messages[1]).toMatchObject({
      status: "SUCCEEDED",
      content: "Final Research report",
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchLifecycle).toHaveBeenCalledTimes(phases.length);
    coordinator.dispose();
  });

  it.each(["FAILED", "CANCELLED"] as const)(
    "settles Research RUNNING to %s without transient success",
    async (terminalPhase) => {
      vi.useFakeTimers();
      const observedStatuses = ["RUNNING"];
      const state = buildChatState({
        historyHydration: "ready",
        renderedChat: {
          messages: [
            buildChatMessage({
              id: "152",
              tool_name: "InSilicoResearchAgent",
              status: "RUNNING",
              content: "",
            }),
          ],
        },
      });
      const chatStates = ref({ research: state });
      const fetchLifecycle = vi
        .fn()
        .mockResolvedValueOnce(response(lifecycle(152, { phase: "RUNNING" })))
        .mockResolvedValueOnce(
          response(lifecycle(152, { phase: terminalPhase, terminal: true }))
        );
      const reloadChat = vi.fn(async () => {
        observedStatuses.push(terminalPhase);
        if (state.renderedChat) {
          state.renderedChat.messages[0] = {
            ...state.renderedChat.messages[0],
            status: terminalPhase,
          };
        }
        return "applied" as const;
      });
      const coordinator = useChatAgentRunLifecycle({
        chatStates,
        getChatState: (dialogueId) => chatStates.value[dialogueId],
        reloadChat,
        fetchLifecycle,
        jitter: () => 0,
      });

      await flush();
      expect(reloadChat).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1000);
      await flush();

      expect(observedStatuses).toEqual(["RUNNING", terminalPhase]);
      expect(observedStatuses).not.toContain("SUCCEEDED");
      expect(reloadChat).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchLifecycle).toHaveBeenCalledTimes(2);
      coordinator.dispose();
    }
  );

  it("reloads the first report-bearing Deep Genome snapshot immediately", async () => {
    vi.useFakeTimers();
    const state = buildChatState({
      historyHydration: "ready",
      renderedChat: {
        messages: [
          buildChatMessage({
            id: "31",
            tool_name: "DeepGenomeAgent",
            status: "RUNNING",
          }),
        ],
      },
    });
    const chatStates = ref({ deep: state });
    const reloadChat = vi.fn().mockResolvedValue("applied");
    const coordinator = useChatAgentRunLifecycle({
      chatStates,
      getChatState: (dialogueId) => chatStates.value[dialogueId],
      reloadChat,
      fetchLifecycle: vi.fn().mockResolvedValue(
        response(
          lifecycle(31, {
            phase: "RUNNING",
            report_revision: 1,
            artifact_summary: {
              image_count: 0,
              output_directory_count: 0,
              has_report: true,
            },
          })
        )
      ),
      jitter: () => 0,
    });

    await flush();

    expect(reloadChat).toHaveBeenCalledOnce();
    expect(reloadChat).toHaveBeenCalledWith("deep");
    coordinator.dispose();
  });

  it("recreates nonterminal material hydration under a same-state dialogue rekey", async () => {
    vi.useFakeTimers();
    const oldReload = deferred<"superseded">();
    const newReload = deferred<"applied">();
    const state = buildChatState({
      historyHydration: "ready",
      renderedChat: {
        dialogue_id: "temporary",
        messages: [
          buildChatMessage({
            id: "311",
            tool_name: "DeepGenomeAgent",
            status: "RUNNING",
            content: "stale partial report",
          }),
        ],
      },
    });
    const chatStates = ref<Record<string, typeof state>>({ temporary: state });
    const reloadChat = vi.fn(async (dialogueId: string) => {
      if (dialogueId === "temporary") {
        const outcome = await oldReload.promise;
        const owner = chatStates.value[dialogueId];
        if (owner?.renderedChat) {
          owner.renderedChat.messages[0].content = "stale old-owner write";
        }
        return outcome;
      }
      const outcome = await newReload.promise;
      const owner = chatStates.value[dialogueId];
      if (owner?.renderedChat) {
        owner.renderedChat.messages[0].content = "hydrated server report";
      }
      return outcome;
    });
    const fetchLifecycle = vi.fn().mockResolvedValue(
      response(
        lifecycle(311, {
          phase: "RUNNING",
          report_revision: 1,
          artifact_summary: {
            image_count: 0,
            output_directory_count: 0,
            has_report: true,
          },
        })
      )
    );
    const coordinator = useChatAgentRunLifecycle({
      chatStates,
      getChatState: (dialogueId) => chatStates.value[dialogueId],
      reloadChat,
      fetchLifecycle,
      jitter: () => 0,
    });

    await flush();
    expect(reloadChat).toHaveBeenCalledOnce();
    expect(reloadChat).toHaveBeenCalledWith("temporary");

    if (!state.renderedChat) throw new Error("expected rendered Chat owner");
    state.renderedChat.dialogue_id = "server";
    chatStates.value = { server: state };
    await flush();

    oldReload.resolve("superseded");
    await flush();
    expect(state.renderedChat.messages[0].content).toBe("stale partial report");
    expect(reloadChat).toHaveBeenCalledTimes(2);
    expect(reloadChat).toHaveBeenLastCalledWith("server");

    newReload.resolve("applied");
    await flush();
    expect(state.renderedChat.messages[0].content).toBe(
      "hydrated server report"
    );
    expect(reloadChat).toHaveBeenCalledTimes(2);
    coordinator.dispose();
  });

  it("settles terminal material hydration under a same-state dialogue rekey before cleanup", async () => {
    vi.useFakeTimers();
    const oldReload = deferred<"superseded">();
    const newReload = deferred<"applied">();
    const state = buildChatState({
      historyHydration: "ready",
      renderedChat: {
        dialogue_id: "temporary",
        messages: [
          buildChatMessage({
            id: "312",
            tool_name: "DeepGenomeAgent",
            status: "RUNNING",
            content: "stale terminal report",
          }),
        ],
      },
    });
    const chatStates = ref<Record<string, typeof state>>({ temporary: state });
    const reloadChat = vi.fn(async (dialogueId: string) => {
      if (dialogueId === "temporary") {
        const outcome = await oldReload.promise;
        const owner = chatStates.value[dialogueId];
        if (owner?.renderedChat) {
          owner.renderedChat.messages[0].content = "stale old-owner final";
        }
        return outcome;
      }
      const outcome = await newReload.promise;
      const owner = chatStates.value[dialogueId];
      if (owner?.renderedChat) {
        owner.renderedChat.messages[0] = {
          ...owner.renderedChat.messages[0],
          content: "hydrated server final",
          status: "SUCCEEDED",
        };
      }
      return outcome;
    });
    const fetchLifecycle = vi.fn().mockResolvedValue(
      response(
        lifecycle(312, {
          phase: "SUCCEEDED",
          terminal: true,
          report_revision: 2,
          artifact_summary: {
            image_count: 0,
            output_directory_count: 0,
            has_report: true,
          },
        })
      )
    );
    const coordinator = useChatAgentRunLifecycle({
      chatStates,
      getChatState: (dialogueId) => chatStates.value[dialogueId],
      reloadChat,
      fetchLifecycle,
      jitter: () => 0,
    });

    await flush();
    expect(reloadChat).toHaveBeenCalledOnce();

    if (!state.renderedChat) throw new Error("expected rendered Chat owner");
    state.renderedChat.dialogue_id = "server";
    chatStates.value = { server: state };
    await flush();

    oldReload.resolve("superseded");
    await flush();
    expect(state.renderedChat.messages[0].content).toBe(
      "stale terminal report"
    );
    expect(reloadChat).toHaveBeenCalledTimes(2);
    expect(reloadChat).toHaveBeenLastCalledWith("server");

    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchLifecycle).toHaveBeenCalledOnce();
    expect(reloadChat).toHaveBeenCalledTimes(2);

    newReload.resolve("applied");
    await flush();
    expect(state.renderedChat.messages[0]).toMatchObject({
      content: "hydrated server final",
      status: "SUCCEEDED",
    });
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchLifecycle).toHaveBeenCalledOnce();
    expect(reloadChat).toHaveBeenCalledTimes(2);
    coordinator.dispose();
  });

  it("converges successive Deep Genome revisions without disturbing another dialogue", async () => {
    vi.useFakeTimers();
    const owner = buildChatState({
      historyHydration: "ready",
      messageInput: "owner draft",
      renderedChat: {
        dialogue_id: "deep",
        messages: [
          buildChatMessage({
            id: "301",
            tool_name: "DeepGenomeAgent",
            status: "RUNNING",
            content: "Server task created: synthetic-child",
          }),
        ],
      },
    });
    const other = buildChatState({
      historyHydration: "ready",
      messageInput: "unchanged composer",
      renderedChat: {
        dialogue_id: "other",
        title: "Unchanged dialogue",
        messages: [
          buildChatMessage({
            id: "302",
            tool_name: "ChatAgent",
            status: "SUCCEEDED",
            content: "Unchanged rendered tree",
          }),
        ],
      },
    });
    const otherRenderedTree = JSON.stringify(other.renderedChat);
    const otherComposer = other.messageInput;
    const chatStates = ref({ deep: owner, other });
    const lifecycleSnapshots = [
      lifecycle(301, {
        phase: "RUNNING",
        report_revision: 1,
        artifact_summary: {
          image_count: 0,
          output_directory_count: 0,
          has_report: true,
        },
      }),
      lifecycle(301, {
        phase: "RUNNING",
        report_revision: 2,
        artifact_summary: {
          image_count: 0,
          output_directory_count: 0,
          has_report: true,
        },
      }),
      lifecycle(301, {
        phase: "SUCCEEDED",
        terminal: true,
        report_revision: 3,
        artifact_summary: {
          image_count: 0,
          output_directory_count: 0,
          has_report: true,
        },
      }),
    ];
    const reports = [
      { content: "Synthetic revision 1", status: "RUNNING" },
      { content: "Synthetic revision 2", status: "RUNNING" },
      { content: "Synthetic final report", status: "SUCCEEDED" },
    ];
    let lifecycleIndex = 0;
    const fetchLifecycle = vi.fn().mockImplementation(() => {
      const snapshot = lifecycleSnapshots[lifecycleIndex];
      lifecycleIndex += 1;
      return snapshot
        ? Promise.resolve(response(snapshot))
        : Promise.reject(new Error("Synthetic lifecycle queue exhausted"));
    });
    const reloadChat = vi.fn(async (dialogueId: string) => {
      const report = reports[reloadChat.mock.calls.length - 1];
      const state = chatStates.value[dialogueId];
      if (!report || !state.renderedChat) return "failed" as const;
      state.renderedChat = {
        ...state.renderedChat,
        messages: state.renderedChat.messages.map((message) =>
          message.id === "301" ? { ...message, ...report } : message
        ),
      };
      return "applied" as const;
    });
    const coordinator = useChatAgentRunLifecycle({
      chatStates,
      getChatState: (dialogueId) => chatStates.value[dialogueId],
      reloadChat,
      fetchLifecycle,
      jitter: () => 0,
    });

    const expectIsolatedRevision = (content: string, status: string) => {
      expect(owner.renderedChat?.messages[0]).toMatchObject({
        content,
        status,
      });
      expect(JSON.stringify(other.renderedChat)).toBe(otherRenderedTree);
      expect(other.messageInput).toBe(otherComposer);
    };

    await flush();
    expectIsolatedRevision("Synthetic revision 1", "RUNNING");

    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expectIsolatedRevision("Synthetic revision 2", "RUNNING");

    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expectIsolatedRevision("Synthetic final report", "SUCCEEDED");
    expect(owner.agentRunLifecycles["301"]).toMatchObject({
      phase: "SUCCEEDED",
      terminal: true,
      report_revision: 3,
    });
    expect(reloadChat).toHaveBeenCalledTimes(3);
    expect(reloadChat).toHaveBeenNthCalledWith(1, "deep");
    expect(reloadChat).toHaveBeenNthCalledWith(2, "deep");
    expect(reloadChat).toHaveBeenNthCalledWith(3, "deep");

    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchLifecycle).toHaveBeenCalledTimes(3);
    expect(reloadChat).toHaveBeenCalledTimes(3);
    coordinator.dispose();
  });

  it("retries failed hydration at one and three seconds total", async () => {
    vi.useFakeTimers();
    const state = buildChatState({
      historyHydration: "ready",
      renderedChat: {
        messages: [
          buildChatMessage({
            id: "32",
            tool_name: "DeepGenomeAgent",
            status: "RUNNING",
          }),
        ],
      },
    });
    const chatStates = ref({ deep: state });
    const reloadChat = vi
      .fn()
      .mockResolvedValueOnce("failed")
      .mockResolvedValueOnce("failed")
      .mockResolvedValueOnce("applied");
    const coordinator = useChatAgentRunLifecycle({
      chatStates,
      getChatState: (dialogueId) => chatStates.value[dialogueId],
      reloadChat,
      fetchLifecycle: vi.fn().mockResolvedValue(
        response(
          lifecycle(32, {
            phase: "SUCCEEDED",
            terminal: true,
            report_revision: 1,
            artifact_summary: {
              image_count: 0,
              output_directory_count: 0,
              has_report: true,
            },
          })
        )
      ),
      jitter: () => 0,
    });

    await flush();
    expect(reloadChat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(reloadChat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(reloadChat).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(reloadChat).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(reloadChat).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60000);
    expect(reloadChat).toHaveBeenCalledTimes(3);
    coordinator.dispose();
  });

  it("exhausts one failed signature after three hydration attempts", async () => {
    vi.useFakeTimers();
    const state = buildChatState({
      historyHydration: "ready",
      renderedChat: {
        messages: [
          buildChatMessage({
            id: "33",
            tool_name: "DeepGenomeAgent",
            status: "RUNNING",
          }),
        ],
      },
    });
    const chatStates = ref({ deep: state });
    const reloadChat = vi.fn().mockResolvedValue("failed");
    const coordinator = useChatAgentRunLifecycle({
      chatStates,
      getChatState: (dialogueId) => chatStates.value[dialogueId],
      reloadChat,
      fetchLifecycle: vi.fn().mockResolvedValue(
        response(
          lifecycle(33, {
            phase: "SUCCEEDED",
            terminal: true,
            report_revision: 1,
            artifact_summary: {
              image_count: 0,
              output_directory_count: 0,
              has_report: true,
            },
          })
        )
      ),
      jitter: () => 0,
    });

    await flush();
    await vi.advanceTimersByTimeAsync(3000);
    expect(reloadChat).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60000);
    expect(reloadChat).toHaveBeenCalledTimes(3);
    coordinator.dispose();
  });

  it("resets retry attempts for a later report revision", async () => {
    vi.useFakeTimers();
    let reportRevision = 1;
    const state = buildChatState({
      historyHydration: "ready",
      renderedChat: {
        messages: [
          buildChatMessage({
            id: "34",
            tool_name: "DeepGenomeAgent",
            status: "RUNNING",
          }),
        ],
      },
    });
    const chatStates = ref({ deep: state });
    const reloadChat = vi
      .fn()
      .mockResolvedValueOnce("failed")
      .mockResolvedValueOnce("failed")
      .mockResolvedValueOnce("failed")
      .mockResolvedValueOnce("failed")
      .mockResolvedValueOnce("applied");
    const coordinator = useChatAgentRunLifecycle({
      chatStates,
      getChatState: (dialogueId) => chatStates.value[dialogueId],
      reloadChat,
      fetchLifecycle: vi.fn().mockImplementation(() =>
        Promise.resolve(
          response(
            lifecycle(34, {
              phase: "RUNNING",
              report_revision: reportRevision,
              artifact_summary: {
                image_count: 0,
                output_directory_count: 0,
                has_report: true,
              },
            })
          )
        )
      ),
      jitter: () => 0,
    });

    await flush();
    await vi.advanceTimersByTimeAsync(3000);
    expect(reloadChat).toHaveBeenCalledTimes(3);

    reportRevision = 2;
    await vi.advanceTimersByTimeAsync(4000);
    expect(reloadChat).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(999);
    expect(reloadChat).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(reloadChat).toHaveBeenCalledTimes(5);
    coordinator.dispose();
  });

  it("cancels an older retry when a newer revision arrives", async () => {
    vi.useFakeTimers();
    let fetchCount = 0;
    const state = buildChatState({
      historyHydration: "ready",
      renderedChat: {
        messages: [
          buildChatMessage({
            id: "35",
            tool_name: "DeepGenomeAgent",
            status: "RUNNING",
          }),
        ],
      },
    });
    const chatStates = ref({ deep: state });
    const reloadChat = vi
      .fn()
      .mockResolvedValueOnce("failed")
      .mockResolvedValueOnce("applied");
    const coordinator = useChatAgentRunLifecycle({
      chatStates,
      getChatState: (dialogueId) => chatStates.value[dialogueId],
      reloadChat,
      fetchLifecycle: vi.fn().mockImplementation(() => {
        fetchCount += 1;
        return Promise.resolve(
          response(
            lifecycle(35, {
              phase: "RUNNING",
              report_revision: Math.min(fetchCount, 2),
              artifact_summary: {
                image_count: 0,
                output_directory_count: 0,
                has_report: true,
              },
            })
          )
        );
      }),
      jitter: () => 0,
    });

    await flush();
    expect(reloadChat).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(999);
    expect(reloadChat).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(reloadChat).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60000);
    expect(reloadChat).toHaveBeenCalledTimes(2);
    coordinator.dispose();
  });

  it("treats superseded hydration as settled without retrying", async () => {
    vi.useFakeTimers();
    const state = buildChatState({
      historyHydration: "ready",
      renderedChat: {
        messages: [
          buildChatMessage({
            id: "36",
            tool_name: "DeepGenomeAgent",
            status: "RUNNING",
          }),
        ],
      },
    });
    const chatStates = ref({ deep: state });
    const reloadChat = vi.fn().mockResolvedValue("superseded");
    const coordinator = useChatAgentRunLifecycle({
      chatStates,
      getChatState: (dialogueId) => chatStates.value[dialogueId],
      reloadChat,
      fetchLifecycle: vi.fn().mockResolvedValue(
        response(
          lifecycle(36, {
            phase: "RUNNING",
            report_revision: 1,
            artifact_summary: {
              image_count: 0,
              output_directory_count: 0,
              has_report: true,
            },
          })
        )
      ),
      jitter: () => 0,
    });

    await flush();
    await vi.advanceTimersByTimeAsync(60000);

    expect(reloadChat).toHaveBeenCalledOnce();
    coordinator.dispose();
  });

  it.each(["removed", "dialogue-disposed", "disposed"] as const)(
    "cancels a pending hydration retry when its row is %s",
    async (mode) => {
      vi.useFakeTimers();
      const state = buildChatState({
        historyHydration: "ready",
        renderedChat: {
          messages: [
            buildChatMessage({
              id: "37",
              tool_name: "DeepGenomeAgent",
              status: "RUNNING",
            }),
          ],
        },
      });
      const chatStates = ref<Record<string, typeof state>>({ deep: state });
      const reloadChat = vi.fn().mockResolvedValue("failed");
      const coordinator = useChatAgentRunLifecycle({
        chatStates,
        getChatState: (dialogueId) => chatStates.value[dialogueId],
        reloadChat,
        fetchLifecycle: vi.fn().mockResolvedValue(
          response(
            lifecycle(37, {
              phase: "RUNNING",
              report_revision: 1,
              artifact_summary: {
                image_count: 0,
                output_directory_count: 0,
                has_report: true,
              },
            })
          )
        ),
        jitter: () => 0,
      });

      await flush();
      expect(reloadChat).toHaveBeenCalledOnce();

      if (mode === "removed") {
        chatStates.value.deep.renderedChat = { messages: [] };
        await flush();
      } else if (mode === "dialogue-disposed") {
        coordinator.disposeDialogue("deep");
      } else {
        coordinator.dispose();
      }

      await vi.advanceTimersByTimeAsync(60000);
      expect(reloadChat).toHaveBeenCalledOnce();
      if (mode !== "disposed") coordinator.dispose();
    }
  );

  it("keeps retries independent across rows without changing dialogue UI state", async () => {
    vi.useFakeTimers();
    const stateA = buildChatState({
      historyHydration: "ready",
      isSending: true,
      messageInput: "foreground a",
      renderedChat: {
        messages: [
          buildChatMessage({
            id: "38",
            tool_name: "DeepGenomeAgent",
            status: "RUNNING",
          }),
        ],
      },
    });
    const stateB = buildChatState({
      historyHydration: "ready",
      isSending: false,
      messageInput: "foreground b",
      renderedChat: {
        messages: [
          buildChatMessage({
            id: "39",
            tool_name: "DeepGenomeAgent",
            status: "RUNNING",
          }),
        ],
      },
    });
    const chatStates = ref({ a: stateA, b: stateB });
    const attempts = new Map<string, number>();
    const reloadChat = vi.fn(async (dialogueId: string) => {
      const attempt = (attempts.get(dialogueId) ?? 0) + 1;
      attempts.set(dialogueId, attempt);
      if (dialogueId === "a") return attempt === 1 ? "failed" : "applied";
      return attempt < 3 ? "failed" : "applied";
    });
    const coordinator = useChatAgentRunLifecycle({
      chatStates,
      getChatState: (dialogueId) => chatStates.value[dialogueId],
      reloadChat,
      fetchLifecycle: vi.fn().mockImplementation((rowId: string) =>
        Promise.resolve(
          response(
            lifecycle(Number(rowId), {
              phase: "RUNNING",
              report_revision: 1,
              artifact_summary: {
                image_count: 0,
                output_directory_count: 0,
                has_report: true,
              },
            })
          )
        )
      ),
      jitter: () => 0,
    });

    await flush();
    expect(attempts).toEqual(
      new Map([
        ["a", 1],
        ["b", 1],
      ])
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(attempts).toEqual(
      new Map([
        ["a", 2],
        ["b", 2],
      ])
    );
    await vi.advanceTimersByTimeAsync(2000);
    expect(attempts).toEqual(
      new Map([
        ["a", 2],
        ["b", 3],
      ])
    );
    expect(stateA.messageInput).toBe("foreground a");
    expect(stateA.isSending).toBe(true);
    expect(stateB.messageInput).toBe("foreground b");
    expect(stateB.isSending).toBe(false);
    coordinator.dispose();
  });

  it("watches background rows and stores phase-only changes without history hydration", async () => {
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
    const reloadChat = vi.fn().mockResolvedValue("applied");
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

    expect(reloadChat).not.toHaveBeenCalled();
    expect(stateA.agentRunLifecycles["41"]?.phase).toBe("RUNNING");
    expect(stateB.agentRunLifecycles["42"]?.phase).toBe("PREPARING");
    coordinator.dispose();
  });

  it("includes Deep Genome while excluding synchronous, malformed, and terminal history rows", async () => {
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
      reloadChat: vi.fn().mockResolvedValue("applied"),
      fetchLifecycle,
    });

    await flush();
    expect(fetchLifecycle.mock.calls.map(([rowId]) => rowId).sort()).toEqual([
      "52",
      "54",
    ]);
    coordinator.dispose();
  });

  it("keeps a scientifically succeeded background row watchable while delivery is pending", async () => {
    vi.useFakeTimers();
    const state = buildChatState({
      historyHydration: "ready",
      renderedChat: {
        messages: [
          buildChatMessage({
            id: "77",
            tool_name: "InSilicoResearchAgent",
            status: "SUCCEEDED",
            delivery: {
              schema_version: 1,
              required: true,
              status: "pending",
              revision: 1,
              name: null,
              size_bytes: null,
              error_code: null,
              retryable: false,
            },
          }),
        ],
      },
    });
    const chatStates = ref({ archive: state });
    const fetchLifecycle = vi
      .fn()
      .mockResolvedValue(
        response(lifecycle(77, { phase: "RUNNING", terminal: false }))
      );
    const coordinator = useChatAgentRunLifecycle({
      chatStates,
      getChatState: (dialogueId) => chatStates.value[dialogueId],
      reloadChat: vi.fn().mockResolvedValue("applied"),
      fetchLifecycle,
      jitter: () => 0,
    });

    await flush();
    expect(fetchLifecycle).toHaveBeenCalledWith("77", expect.any(String));
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
    const reloadChat = vi.fn().mockResolvedValue("applied");
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
    const reloadChat = vi.fn().mockResolvedValue("applied");
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
      reloadChat: vi.fn().mockResolvedValue("applied"),
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
      return "applied" as const;
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

  it("queues one terminal reload after an in-flight material reload settles", async () => {
    vi.useFakeTimers();
    const materialReload = deferred<"applied">();
    const terminalReload = deferred<"applied">();
    const state = buildChatState({
      historyHydration: "ready",
      agentRunLifecycles: { "91": lifecycle(91) },
      renderedChat: {
        messages: [
          buildChatMessage({
            id: "91",
            tool_name: "AnalystAgent",
            status: "RUNNING",
            content: "",
          }),
        ],
      },
    });
    const chatStates = ref({ a: state });
    const reloadChat = vi
      .fn()
      .mockReturnValueOnce(materialReload.promise)
      .mockImplementationOnce(async () => {
        await terminalReload.promise;
        state.renderedChat = {
          messages: [
            buildChatMessage({
              id: "91",
              tool_name: "AnalystAgent",
              status: "SUCCEEDED",
              content: "completed analysis",
            }),
          ],
        };
        return "applied" as const;
      });
    const fetchLifecycle = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          lifecycle(91, {
            phase: "RUNNING",
            report_revision: 1,
            artifact_summary: {
              image_count: 0,
              output_directory_count: 0,
              has_report: true,
            },
          })
        )
      )
      .mockResolvedValueOnce(
        response(
          lifecycle(91, {
            phase: "SUCCEEDED",
            terminal: true,
            report_revision: 2,
            artifact_summary: {
              image_count: 0,
              output_directory_count: 0,
              has_report: true,
            },
          })
        )
      );
    const coordinator = useChatAgentRunLifecycle({
      chatStates,
      getChatState: (dialogueId) => chatStates.value[dialogueId],
      reloadChat,
      fetchLifecycle,
      jitter: () => 0,
    });

    await flush();
    expect(reloadChat).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(reloadChat).toHaveBeenCalledOnce();
    materialReload.resolve("applied");
    await flush();

    expect(reloadChat).toHaveBeenCalledTimes(2);
    terminalReload.resolve("applied");
    await flush();

    expect(state.renderedChat?.messages[0]?.content).toBe("completed analysis");
    expect(state.agentRunLifecycles["91"]?.terminal).toBe(true);
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchLifecycle).toHaveBeenCalledTimes(2);
    coordinator.dispose();
  });

  it("cancels a queued terminal reload when its dialogue is disposed", async () => {
    vi.useFakeTimers();
    const materialReload = deferred<"applied">();
    const state = buildChatState({
      historyHydration: "ready",
      agentRunLifecycles: { "92": lifecycle(92) },
      renderedChat: {
        messages: [
          buildChatMessage({
            id: "92",
            tool_name: "AnalystAgent",
            status: "RUNNING",
            content: "",
          }),
        ],
      },
    });
    const chatStates = ref({ a: state });
    const reloadChat = vi.fn().mockReturnValue(materialReload.promise);
    const fetchLifecycle = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          lifecycle(92, {
            phase: "RUNNING",
            report_revision: 1,
            artifact_summary: {
              image_count: 0,
              output_directory_count: 0,
              has_report: true,
            },
          })
        )
      )
      .mockResolvedValueOnce(
        response(
          lifecycle(92, {
            phase: "SUCCEEDED",
            terminal: true,
            report_revision: 2,
            artifact_summary: {
              image_count: 0,
              output_directory_count: 0,
              has_report: true,
            },
          })
        )
      );
    const coordinator = useChatAgentRunLifecycle({
      chatStates,
      getChatState: (dialogueId) => chatStates.value[dialogueId],
      reloadChat,
      fetchLifecycle,
      jitter: () => 0,
    });

    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(reloadChat).toHaveBeenCalledOnce();

    coordinator.disposeDialogue("a");
    materialReload.resolve("applied");
    await flush();

    expect(reloadChat).toHaveBeenCalledOnce();
    coordinator.dispose();
  });
});

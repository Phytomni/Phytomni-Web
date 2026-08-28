import { NETWORK_SAMPLE_DOWNLOAD_SENTINEL } from "./networkStaticDownload";
import type { AgentCaseDemoFixture } from "./types";

/** Network case tape: question + split-zip download sentinel (no invented report). */
export const NETWORK_CASE_FIXTURE: AgentCaseDemoFixture = {
  tool: "GeneNetworkAgent",
  messages: [
    {
      role: "user",
      content:
        "Please help me to analysis the hormone regulatory network in the traits of TO:0000011",
    },
    {
      role: "assistant",
      content: "Sample task id: 8ab4434b-772a-44f0-aaa5-fa163e7f84a3",
      tool_name: "GeneNetworkAgent",
      download_path: NETWORK_SAMPLE_DOWNLOAD_SENTINEL,
    },
  ],
};

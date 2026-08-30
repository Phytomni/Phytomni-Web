import { NETWORK_SAMPLE_DOWNLOAD_SENTINEL } from "./networkStaticDownload";
import type { AgentCaseDemoFixture } from "./types";

export const NETWORK_CASE_QUESTION =
  "Please help me analyze the hormone regulatory network in the traits of TO:0000011 in rice.";

/** Network case tape: question + split-zip download sentinel (no invented report). */
export const NETWORK_CASE_FIXTURE: AgentCaseDemoFixture = {
  tool: "GeneNetworkAgent",
  messages: [
    {
      role: "user",
      content: NETWORK_CASE_QUESTION,
    },
    {
      role: "assistant",
      content: "Sample task id: 8ab4434b-772a-44f0-aaa5-fa163e7f84a3",
      tool_name: "GeneNetworkAgent",
      download_path: NETWORK_SAMPLE_DOWNLOAD_SENTINEL,
    },
  ],
};

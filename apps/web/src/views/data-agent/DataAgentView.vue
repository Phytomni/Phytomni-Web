<template>
  <AgentDemoShell
    :title="$t('agents.data.title')"
    :subtitle="$t('agents.data.subtitle')"
    @back="goBack"
  >
    <template #default>
      <div class="data-agent-conversation" data-test="data-agent-conversation">
        <article
          v-for="(round, index) in rounds"
          :key="round.captionKey"
          class="data-agent-round"
          data-test="data-agent-round"
        >
          <div class="data-agent-question" data-test="data-agent-question">
            {{ round.question }}
          </div>

          <figure
            class="data-agent-result"
            data-test="data-agent-result"
            :aria-labelledby="`data-agent-caption-${index}`"
          >
            <figcaption :id="`data-agent-caption-${index}`">
              {{ $t(round.captionKey) }}
            </figcaption>
            <div
              class="data-agent-table-scroll"
              data-test="data-agent-table-scroll"
              role="region"
              :aria-labelledby="`data-agent-caption-${index}`"
            >
              <ScientificMarkdown :source="round.response" surface="chat" />
            </div>
          </figure>
        </article>
      </div>
    </template>

    <template #footer>{{ $t("common.Tip") }}</template>
  </AgentDemoShell>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";
import ScientificMarkdown from "@/components/ScientificMarkdown.vue";
import { AgentDemoShell } from "@/components/demo";

const router = useRouter();
const goBack = () => {
  router.back();
};

const rounds = [
  {
    question: "Please list the transcript ID of Os01g0177400 in rice.",
    response: `|  Transcript ID  |
| :-------------: |
| Os01t0177400-01 |
`,
    captionKey: "agents.data.tableCaptions.transcript",
  },
  {
    question:
      "How many bases does the CDS sequence of rice transcript Os01t0177400-01 contain?",
    response: `| LENGTH([sequence_2]) |
| :------------------: |
|         1113         |`,
    captionKey: "agents.data.tableCaptions.cdsLength",
  },
  {
    question: "List the homologous genes of rice Os01g0177400 in maize.",
    response: `| Query Gene ID | Query Species | Homology Gene ID | Homology Species |
| ------------- | :-----------: | :--------------: | :--------------: |
| Os01g0177400  |      osa      | Zm00001eb122500  |       zma        |`,
    captionKey: "agents.data.tableCaptions.homologs",
  },
] as const;
</script>

<style scoped>
.data-agent-conversation {
  display: flex;
  flex-direction: column;
  gap: var(--phy-space-24);
  min-width: 0;
}

.data-agent-round {
  display: flex;
  flex-direction: column;
  gap: var(--phy-space-12);
  min-width: 0;
}

.data-agent-question,
.data-agent-result {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  border-radius: var(--phy-radius-lg);
}

.data-agent-question {
  align-self: flex-end;
  width: min(100%, clamp(820px, 56vw, 1440px));
  padding: var(--phy-space-16) var(--phy-space-20);
  border: 1px solid var(--phy-color-bubble-user-border);
  background: var(--phy-color-bubble-user);
  color: var(--phy-color-text);
  line-height: 1.6;
}

.data-agent-result {
  align-self: flex-start;
  width: min(100%, clamp(960px, 66vw, 1600px));
  margin: 0;
  padding: var(--phy-space-16) var(--phy-space-20) var(--phy-space-20);
  border: 1px solid var(--phy-color-bubble-assistant-border);
  background: var(--phy-color-bubble-assistant);
}

.data-agent-result figcaption {
  margin-bottom: var(--phy-space-8);
  color: var(--phy-color-action-text);
  font-size: 0.75rem;
  font-weight: 650;
  letter-spacing: 0.01em;
}

.data-agent-table-scroll {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  scrollbar-width: thin;
}

.data-agent-table-scroll :deep(.phy-markdown--chat) {
  min-width: 0;
}

.data-agent-table-scroll :deep(.phy-markdown--chat table) {
  width: max-content;
  min-width: 100%;
  max-width: none;
}

@media (max-width: 700px) {
  .data-agent-question,
  .data-agent-result {
    width: 100%;
  }

  .data-agent-result {
    padding-inline: var(--phy-space-16);
  }
}
</style>

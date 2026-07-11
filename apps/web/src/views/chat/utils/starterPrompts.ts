// Starter prompt cards for the chat empty state. Each card carries i18n keys
// only (single-language policy) — the display copy lives in the locale bundles.
export interface StarterPrompt {
  key: string;
  labelKey: string;
  descKey: string;
  promptKey: string;
}

export interface StarterPromptItem {
  key: string;
  label: string;
  description: string;
  disabled: boolean;
}

export const STARTER_PROMPTS: StarterPrompt[] = [
  {
    key: "gene",
    labelKey: "chat.starter.geneLabel",
    descKey: "chat.starter.geneDesc",
    promptKey: "chat.starter.genePrompt",
  },
  {
    key: "species",
    labelKey: "chat.starter.speciesLabel",
    descKey: "chat.starter.speciesDesc",
    promptKey: "chat.starter.speciesPrompt",
  },
  {
    key: "deepGenome",
    labelKey: "chat.starter.deepGenomeLabel",
    descKey: "chat.starter.deepGenomeDesc",
    promptKey: "chat.starter.deepGenomePrompt",
  },
];

export function getStarterPromptItems(
  t: (key: string) => string,
  disabled = false
): StarterPromptItem[] {
  return STARTER_PROMPTS.map((prompt) => ({
    key: prompt.key,
    label: t(prompt.labelKey),
    description: t(prompt.descKey),
    disabled,
  }));
}

// Fill the composer with the selected starter's prompt text. Intentionally fills
// only — it has no send capability, so it can never auto-submit (which would
// consume chat_limit quota before the user edits the example gene ID / species).
export function applyStarterPrompt(
  item: { promptKey: string },
  t: (key: string) => string,
  setInput: (text: string) => void
): void {
  setInput(t(item.promptKey));
}

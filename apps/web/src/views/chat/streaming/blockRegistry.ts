import type { Component } from "vue";
import MarkdownBlock from "../components/blocks/MarkdownBlock.vue";
import ToolBlock from "../components/blocks/ToolBlock.vue";
import StepBlock from "../components/blocks/StepBlock.vue";
import ReasoningBlock from "../components/blocks/ReasoningBlock.vue";
import AgentSurfaceBlock from "../components/blocks/AgentSurfaceBlock.vue";

// The block registry maps a ContentBlock.type to its Vue renderer. New block
// types (log / image / mol3d / agent-surface) register here without touching
// the consumer or StreamMessage — that is the extensibility point.
const registry: Record<string, Component> = {
  markdown: MarkdownBlock,
  tool: ToolBlock,
  step: StepBlock,
  reasoning: ReasoningBlock,
  "agent-surface": AgentSurfaceBlock,
};

export function resolveBlockRenderer(type: string): Component | null {
  return registry[type] ?? null;
}

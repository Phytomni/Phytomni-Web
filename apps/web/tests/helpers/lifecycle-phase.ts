import { expect } from "vitest";
import type { VueWrapper } from "@vue/test-utils";

export function lifecyclePhaseText(wrapper: VueWrapper): string {
  const waitLabel = wrapper.find('[data-test="progress-label"]');
  if (waitLabel.exists()) return waitLabel.text();
  const phase = wrapper.find('[data-test="lifecycle-phase"]');
  if (phase.exists()) return phase.text();
  return wrapper.get(".agent-lifecycle").text();
}

export function expectLifecyclePhase(wrapper: VueWrapper, label: string): void {
  expect(lifecyclePhaseText(wrapper)).toBe(label);
}

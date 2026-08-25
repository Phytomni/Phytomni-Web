import { describe, expect, it } from "vitest";

import {
  executionV2TransportEnabled,
  executionWorkbenchPresentationEnabled,
} from "@/views/chat/executionFeature";

describe("execution workbench presentation flag", () => {
  it("can roll back the UI independently of Bot event production", () => {
    expect(executionWorkbenchPresentationEnabled("false")).toBe(false);
    expect(executionWorkbenchPresentationEnabled("true")).toBe(true);
    expect(executionWorkbenchPresentationEnabled(undefined)).toBe(true);
  });

  it("can roll back V2 transport independently of presentation", () => {
    expect(executionV2TransportEnabled("false")).toBe(false);
    expect(executionV2TransportEnabled("true")).toBe(true);
    expect(executionV2TransportEnabled(undefined)).toBe(true);

    expect(executionV2TransportEnabled("false")).toBe(false);
    expect(executionWorkbenchPresentationEnabled("true")).toBe(true);
  });
});

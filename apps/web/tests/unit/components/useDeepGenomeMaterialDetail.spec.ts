import { effectScope, nextTick, reactive, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { createDeepGenomeMaterialDetailState } from "@/components/research/deep-genome-report";
import { useDeepGenomeMaterialDetail } from "@/components/research/useDeepGenomeMaterialDetail";
import type { DeepGenomeResourceReader } from "@/components/research/deep-genome-report";

const resource = {
  id: "protocol",
  kind: "markdown" as const,
  name: "protocol.md",
  markdownHref: "./protocol.md",
};
const loaded = (text: string) => ({
  text,
  bytes: new TextEncoder().encode(text),
});

function setup(reader: DeepGenomeResourceReader) {
  const scope = effectScope();
  const state = ref(reactive(createDeepGenomeMaterialDetailState()));
  const reportKey = ref("report-a:1");
  const detail = scope.run(() =>
    useDeepGenomeMaterialDetail({
      state: () => state.value,
      reportKey: () => reportKey.value,
      resources: () => [resource, { ...resource, id: "second" }],
      materials: () => [
        { referenceIndex: 1, excerpt: "Source-local [1].", resourceIds: [] },
      ],
      readResource: () => reader,
    })
  );
  if (!detail) throw new Error("Material detail scope did not initialize");
  return { scope, state, reportKey, detail };
}

describe("DeepGenome material detail lifecycle", () => {
  it("rejects oversized decoded material before publishing text or downloads", async () => {
    const content = { text: "", bytes: new Uint8Array(8 * 1024 * 1024 + 1) };
    const { scope, state, detail } = setup(async () => content);
    await detail.open({ kind: "resource", resourceId: "protocol" });
    expect(state.value).toMatchObject({ status: "error", text: "" });
    expect(detail.download.value).toBeNull();
    scope.stop();
  });
  it("loads registered Markdown bytes and resets on Back", async () => {
    const reader = vi.fn<DeepGenomeResourceReader>(async () =>
      loaded("# Protocol\n")
    );
    const { scope, state, detail } = setup(reader);
    await detail.open({ kind: "resource", resourceId: "protocol" });
    expect(state.value).toMatchObject({
      reportKey: "report-a:1",
      status: "ready",
      text: "# Protocol\n",
    });
    expect(detail.download.value).toEqual({
      name: "protocol.md",
      bytes: loaded("# Protocol\n").bytes,
    });
    detail.back();
    expect(state.value.selection).toBeNull();
    expect(detail.download.value).toBeNull();
    scope.stop();
  });

  it("opens the exact source slot without creating an original-file download", async () => {
    const reader = vi.fn<DeepGenomeResourceReader>();
    const { scope, state, detail } = setup(reader);
    await detail.open({ kind: "excerpt", referenceIndex: 1 });
    expect(state.value.text).toBe("Source-local [1].");
    expect(detail.download.value).toBeNull();
    expect(reader).not.toHaveBeenCalled();
    scope.stop();
  });

  it("rejects unknown resource IDs before reading", async () => {
    const reader = vi.fn<DeepGenomeResourceReader>();
    const { scope, state, detail } = setup(reader);
    await detail.open({ kind: "resource", resourceId: "unregistered" });
    expect(state.value).toMatchObject({
      status: "error",
      error: "unavailable",
      text: "",
    });
    expect(reader).not.toHaveBeenCalled();
    scope.stop();
  });

  it("keeps bounded errors and retries only after user action", async () => {
    const reader = vi
      .fn<DeepGenomeResourceReader>()
      .mockRejectedValueOnce(new Error("private storage detail"))
      .mockResolvedValueOnce(loaded("Recovered"));
    const { scope, state, detail } = setup(reader);
    await detail.open({ kind: "resource", resourceId: "protocol" });
    expect(state.value).toMatchObject({
      status: "error",
      error: "failed",
      text: "",
    });
    expect(JSON.stringify(state.value)).not.toContain("private storage");
    expect(reader).toHaveBeenCalledTimes(1);
    await detail.retry();
    expect(state.value.text).toBe("Recovered");
    scope.stop();
  });

  it.each(["back", "switch", "revision", "unmount"] as const)(
    "discards a late response after %s",
    async (action) => {
      let resolve!: (value: ReturnType<typeof loaded>) => void;
      const reader = vi.fn<DeepGenomeResourceReader>(
        (_id, signal) =>
          new Promise((done) => {
            resolve = done;
            expect(signal.aborted).toBe(false);
          })
      );
      const { scope, state, reportKey, detail } = setup(reader);
      const original = state.value;
      const pending = detail.open({ kind: "resource", resourceId: "protocol" });
      const signal = reader.mock.calls[0][1];
      if (action === "back") detail.back();
      if (action === "switch")
        state.value = reactive(createDeepGenomeMaterialDetailState());
      if (action === "revision") reportKey.value = "report-a:2";
      if (action === "unmount") scope.stop();
      await nextTick();
      expect(signal.aborted).toBe(true);
      resolve(loaded("Late secret result"));
      await pending;
      expect(state.value.text).not.toBe("Late secret result");
      expect(original.status).not.toBe("loading");
      scope.stop();
    }
  );

  it("discards A after a faster B result", async () => {
    let resolve!: (value: ReturnType<typeof loaded>) => void;
    const reader = vi
      .fn<DeepGenomeResourceReader>()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          })
      )
      .mockResolvedValueOnce(loaded("B"));
    const { scope, state, detail } = setup(reader);
    const pending = detail.open({ kind: "resource", resourceId: "protocol" });
    await detail.open({ kind: "resource", resourceId: "second" });
    resolve(loaded("A"));
    await pending;
    expect(state.value.text).toBe("B");
    expect(state.value.selection).toEqual({
      kind: "resource",
      resourceId: "second",
    });
    scope.stop();
  });

  it.each([
    loaded("<!DOCTYPE html><html>Error page</html>"),
    { text: "Altered", bytes: new TextEncoder().encode("Original") },
    { text: "", bytes: new Uint8Array([0xff]) },
  ])(
    "rejects invalid Markdown bytes without rendering them",
    async (content) => {
      const { scope, state, detail } = setup(async () => content);
      await detail.open({ kind: "resource", resourceId: "protocol" });
      expect(state.value).toMatchObject({ status: "error", text: "" });
      expect(detail.download.value).toBeNull();
      scope.stop();
    }
  );
});

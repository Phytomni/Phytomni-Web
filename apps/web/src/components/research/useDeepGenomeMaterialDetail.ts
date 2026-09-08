import { computed, onScopeDispose, watch } from "vue";
import type { AuthorizedScientificResource } from "@/utils/scientific-markdown/types";
import {
  createDeepGenomeMaterialDetailState,
  type DeepGenomeLoadedMarkdown,
  type DeepGenomeMaterialDetailState,
  type DeepGenomeMaterialSelection,
  type DeepGenomeReferenceMaterial,
  type DeepGenomeResourceReader,
} from "./deep-genome-report";

const MAX_MARKDOWN_BYTES = 8 * 1024 * 1024;

export function useDeepGenomeMaterialDetail(options: {
  state: () => DeepGenomeMaterialDetailState;
  reportKey: () => string;
  resources: () => readonly AuthorizedScientificResource[];
  materials: () => readonly DeepGenomeReferenceMaterial[];
  readResource: () => DeepGenomeResourceReader | undefined;
}) {
  let revision = 0;
  let controller: AbortController | undefined;
  let pendingState: DeepGenomeMaterialDetailState | undefined;
  let loaded: DeepGenomeLoadedMarkdown | undefined;

  function cancel() {
    revision += 1;
    controller?.abort();
    controller = undefined;
    loaded = undefined;
    if (pendingState?.status === "loading") {
      Object.assign(pendingState, createDeepGenomeMaterialDetailState());
    }
    pendingState = undefined;
  }

  function back() {
    cancel();
    Object.assign(options.state(), createDeepGenomeMaterialDetailState());
  }

  watch(
    [options.state, options.reportKey],
    ([state], [previous]) => {
      cancel();
      if (previous)
        Object.assign(previous, createDeepGenomeMaterialDetailState());
      Object.assign(state, createDeepGenomeMaterialDetailState());
    },
    { flush: "sync" }
  );
  onScopeDispose(back);

  const selectedResource = computed(() => {
    const selection = options.state().selection;
    return selection?.kind === "resource"
      ? options
          .resources()
          .find(
            (resource) =>
              resource.id === selection.resourceId &&
              resource.kind === "markdown"
          )
      : undefined;
  });
  const download = computed(() => {
    if (
      options.state().status !== "ready" ||
      !selectedResource.value ||
      !loaded
    )
      return null;
    return { name: selectedResource.value.name, bytes: loaded.bytes };
  });

  async function open(selection: DeepGenomeMaterialSelection) {
    cancel();
    const request = revision;
    const state = options.state();
    const reportKey = options.reportKey();
    Object.assign(state, {
      reportKey,
      selection,
      status: "loading",
      text: "",
      error: null,
    });
    pendingState = state;
    if (selection.kind === "excerpt") {
      const material = options
        .materials()
        .find((item) => item.referenceIndex === selection.referenceIndex);
      if (
        !material?.excerpt ||
        new TextEncoder().encode(material.excerpt).length > 64 * 1024
      ) {
        state.status = "error";
        state.error = "unavailable";
      } else {
        state.text = material.excerpt;
        state.status = "ready";
      }
      return;
    }
    const reader = options.readResource();
    if (!selectedResource.value || !reader) {
      state.status = "error";
      state.error = "unavailable";
      return;
    }
    controller = new AbortController();
    const signal = controller.signal;
    const current = () =>
      !signal.aborted &&
      request === revision &&
      state === options.state() &&
      reportKey === options.reportKey();
    try {
      const content = await reader(selection.resourceId, signal);
      if (!current()) return;
      if (
        content.bytes.byteLength > MAX_MARKDOWN_BYTES ||
        new TextDecoder("utf-8", { fatal: true }).decode(content.bytes) !==
          content.text ||
        /^\s*(?:<!doctype\s+html|<html\b)/i.test(content.text)
      ) {
        throw new Error("Invalid Markdown resource");
      }
      loaded = content;
      state.text = content.text;
      state.status = "ready";
    } catch {
      if (!current()) return;
      state.status = "error";
      state.error = "failed";
    }
  }

  async function retry() {
    const selection = options.state().selection;
    if (selection) await open(selection);
  }

  return { open, back, retry, download, selectedResource };
}

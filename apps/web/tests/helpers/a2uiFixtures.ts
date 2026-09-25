import type {
  A2uiActionResponse,
  A2uiOpenSurface,
  A2uiTerminalSurface,
  A2uiWidgetKind,
} from "@/views/chat/streaming/a2uiContract";

export function createA2uiOpenSurface(widget: A2uiWidgetKind): A2uiOpenSurface {
  switch (widget) {
    case "confirm":
      return {
        catalog_version: "v1.0",
        surface_id: "sfc-contract-1",
        widget: "confirm",
        props: {
          title: "Continue?",
          body: "Run the analysis as planned.",
          confirm_label: "Confirm",
          cancel_label: "Cancel",
        },
      };
    case "form":
      return {
        catalog_version: "v1.0",
        surface_id: "sfc-contract-1",
        widget: "form",
        props: {
          title: "Gene ID",
          fields: [
            {
              name: "gene_id",
              label: "Gene ID",
              type: "text",
              required: true,
            },
          ],
        },
      };
    case "choice":
      return {
        catalog_version: "v1.0",
        surface_id: "sfc-contract-1",
        widget: "choice",
        props: {
          title: "Choice",
          options: [
            { id: "a", label: "Option A" },
            { id: "b", label: "Option B" },
          ],
          multiple: false,
        },
      };
  }
}

export function createA2uiTerminalSurface(): A2uiTerminalSurface {
  return {
    catalog_version: "v1.0",
    surface_id: "sfc-contract-1",
    widget: "confirm",
    props: { status: "submitted", accepted: true },
  };
}

export function createA2uiSucceededResponse(
  runId = "run-contract-1"
): A2uiActionResponse {
  return {
    status: "succeeded",
    run_id: runId,
    result: {
      formatted: { answer: "Analysis complete." },
      a2ui: createA2uiTerminalSurface(),
    },
  };
}

export function createA2uiInputRequiredResponse(
  runId = "run-contract-1"
): A2uiActionResponse {
  return {
    status: "input_required",
    run_id: runId,
    interrupt: {
      draft: {
        a2ui: {
          catalog_version: "v1.0",
          surface_id: "sfc-contract-2",
          widget: "choice",
          props: {
            title: "Choice",
            options: [
              { id: "a", label: "Option A" },
              { id: "b", label: "Option B" },
            ],
            multiple: false,
          },
        },
      },
    },
  };
}

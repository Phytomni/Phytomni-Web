export const A2UI_CATALOG_VERSION = "v1.0" as const;

export const A2UI_LIMITS = {
  requestBytes: 64 * 1024,
  responseBytes: 1024 * 1024,
  identifierChars: 256,
  formFields: 20,
  choiceItems: 100,
  labelChars: 256,
  textChars: 4096,
} as const;

export type A2uiWidgetKind = "confirm" | "form" | "choice";
export type A2uiRound = 1 | 2;
export type A2uiScalar = string | number;

export interface A2uiActionEnvelope {
  surface_id: string;
  widget: string;
  action_id: string;
  run_id: string;
  payload: Record<string, unknown>;
}

export interface A2uiFormField {
  name: string;
  label: string;
  type: "text" | "number" | "select";
  required: boolean;
  options?: A2uiScalar[];
}

export interface A2uiChoiceOption {
  id: string;
  label: string;
}

interface A2uiSurfaceIdentity {
  catalog_version: string;
  surface_id: string;
}

type A2uiOpenConfirmSurface = A2uiSurfaceIdentity & {
  widget: "confirm";
  props: {
    title: string;
    body?: string;
    confirm_label: string;
    cancel_label: string;
  };
};

type A2uiOpenFormSurface = A2uiSurfaceIdentity & {
  widget: "form";
  props: {
    title: string;
    fields: A2uiFormField[];
  };
};

type A2uiOpenChoiceSurface = A2uiSurfaceIdentity & {
  widget: "choice";
  props: {
    title: string;
    options: A2uiChoiceOption[];
    multiple: boolean;
  };
};

export type A2uiOpenSurface =
  | A2uiOpenConfirmSurface
  | A2uiOpenFormSurface
  | A2uiOpenChoiceSurface;

type A2uiSubmitted = {
  status: "submitted";
};

type A2uiTerminalConfirmSurface = A2uiSurfaceIdentity & {
  widget: "confirm";
  props: A2uiSubmitted & {
    title?: string;
    body?: string;
    confirm_label?: string;
    cancel_label?: string;
    accepted: boolean;
  };
};

type A2uiTerminalFormSurface = A2uiSurfaceIdentity & {
  widget: "form";
  props: A2uiSubmitted & {
    title?: string;
    fields: A2uiFormField[] | Record<string, A2uiScalar>;
    cancelled?: true;
  };
};

type A2uiTerminalChoiceSurface = A2uiSurfaceIdentity & {
  widget: "choice";
  props: A2uiSubmitted & {
    title?: string;
    options?: A2uiChoiceOption[];
    multiple?: boolean;
    selected?: string | string[];
    cancelled?: true;
  };
};

export type A2uiTerminalSurface =
  | A2uiTerminalConfirmSurface
  | A2uiTerminalFormSurface
  | A2uiTerminalChoiceSurface;

export interface A2uiFormattedResult {
  answer?: string;
}

/**
 * The only intermediate action response shape accepted by the Web action
 * transport.  Bot intentionally returns just a fresh draft surface here;
 * terminal result/formatted fields are not carried across the pause boundary.
 */
export interface A2uiInputRequiredInterrupt {
  draft: { a2ui: A2uiOpenSurface };
}

export type A2uiActionResponse =
  | {
      status: "succeeded";
      run_id: string;
      result: {
        a2ui: A2uiTerminalSurface;
        formatted?: A2uiFormattedResult;
      };
    }
  | {
      status: "input_required";
      run_id: string;
      interrupt: A2uiInputRequiredInterrupt;
    };

export type A2uiActionIntent =
  | { widget: "confirm"; payload: { accepted: boolean } }
  | {
      widget: "form";
      payload: { fields: Record<string, A2uiScalar> } | { cancelled: true };
    }
  | {
      widget: "choice";
      payload: { selected: string | string[] } | { cancelled: true };
    };

export type A2uiResolution =
  | "submitted"
  | "cancelled"
  | "rejected"
  | "advanced";

export type A2uiSurfaceState =
  | { status: "ready"; round: A2uiRound; lastError?: "not_sent" }
  | { status: "submitting"; round: A2uiRound; envelope: A2uiActionEnvelope }
  | {
      status: "resolved";
      round: A2uiRound;
      actionId: string;
      resolution: A2uiResolution;
      snapshot?: A2uiTerminalSurface;
    }
  | {
      status: "rejected";
      round: A2uiRound;
      actionId: string;
      code: string;
    }
  | {
      status: "temporarily_rejected";
      round: A2uiRound;
      envelope: A2uiActionEnvelope;
      code: string;
    }
  | {
      status: "expired";
      round: A2uiRound;
      actionId?: string;
      code: string;
    }
  | {
      status: "unknown";
      round: A2uiRound;
      actionId: string;
      code: string;
    }
  | {
      status: "protocol_error";
      round: A2uiRound;
      actionId?: string;
      code: string;
    };

export interface A2uiSurfaceRuntime {
  surface: A2uiOpenSurface;
  state: A2uiSurfaceState;
}

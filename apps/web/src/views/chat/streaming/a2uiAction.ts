// Client→server action uplink for interactive agent-surface widgets.
// Server action-frame format is still open; this module owns a stable
// envelope + swappable transport so UI work is not blocked.

import type { A2uiActionResponse } from "./a2uiContract";
import { decodeA2uiActionResponse } from "./a2uiParse";

export interface A2uiActionEnvelope {
  surface_id: string;
  widget: string;
  action_id: string;
  run_id: string;
  payload: Record<string, unknown>;
}

export type A2uiActionTransport = (
  envelope: A2uiActionEnvelope,
) => Promise<A2uiActionResponse>;

type A2uiActionReply = (
  envelope: A2uiActionEnvelope,
) => A2uiActionResponse;

const INVALID_A2UI_ACTION_RESPONSE = "invalid a2ui action response";

const sentIds = new Set<string>();

export function buildA2uiActionId(): string {
  return `a2ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultMemoryA2uiReply(
  envelope: A2uiActionEnvelope,
): A2uiActionResponse {
  const identity = {
    catalog_version: "v1.0" as const,
    surface_id: envelope.surface_id,
  };
  switch (envelope.widget) {
    case "form":
      return {
        status: "succeeded",
        run_id: envelope.run_id,
        result: {
          a2ui: {
            ...identity,
            widget: "form",
            props: { status: "submitted", fields: {} },
          },
        },
      };
    case "choice":
      return {
        status: "succeeded",
        run_id: envelope.run_id,
        result: {
          a2ui: {
            ...identity,
            widget: "choice",
            props: { status: "submitted" },
          },
        },
      };
    default:
      return {
        status: "succeeded",
        run_id: envelope.run_id,
        result: {
          a2ui: {
            ...identity,
            widget: "confirm",
            props: {
              status: "submitted",
              accepted: Boolean(envelope.payload.accepted),
            },
          },
        },
      };
  }
}

export function createMemoryA2uiTransport(
  sink: A2uiActionEnvelope[],
  reply: A2uiActionReply,
): A2uiActionTransport;
/** Backwards-compatible overload for existing UI tests until their fixtures migrate. */
export function createMemoryA2uiTransport(
  sink: A2uiActionEnvelope[],
): A2uiActionTransport;
export function createMemoryA2uiTransport(
  sink: A2uiActionEnvelope[],
  reply: A2uiActionReply = defaultMemoryA2uiReply,
): A2uiActionTransport {
  return async (envelope) => {
    sink.push(envelope);
    return reply(envelope);
  };
}

export function createFetchA2uiTransport(opts: {
  conversationId: string;
  getToken: () => string | undefined;
  fetchImpl?: typeof fetch;
  // Locale string for Accept-Language; optional to keep tests light.
  acceptLanguage?: string;
}): A2uiActionTransport {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return async (envelope) => {
    const token = opts.getToken() ?? "";
    const resp = await fetchImpl(
      `/api/v1/conversations/${opts.conversationId}/a2ui-actions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Language": opts.acceptLanguage ?? "en-US",
          platform: "bcemis",
          Authorization: "Bearer " + token,
          satoken: token,
        },
        body: JSON.stringify(envelope),
      },
    );
    if (!resp.ok) {
      throw new Error(`a2ui action HTTP ${resp.status}`);
    }
    try {
      const decoded = decodeA2uiActionResponse(await resp.json());
      if (!decoded.ok) throw new Error(INVALID_A2UI_ACTION_RESPONSE);
      return decoded.value;
    } catch {
      throw new Error(INVALID_A2UI_ACTION_RESPONSE);
    }
  };
}

export async function sendA2uiAction(
  envelope: A2uiActionEnvelope,
  transport: A2uiActionTransport,
): Promise<void> {
  if (sentIds.has(envelope.action_id)) return;
  sentIds.add(envelope.action_id);
  try {
    await transport(envelope);
  } catch (e) {
    // Allow a later retry with the same id only if the transport failed.
    sentIds.delete(envelope.action_id);
    throw e;
  }
}

// Test-only helper: clear idempotency set between specs if needed.
export function _resetA2uiActionIdempotencyForTests(): void {
  sentIds.clear();
}

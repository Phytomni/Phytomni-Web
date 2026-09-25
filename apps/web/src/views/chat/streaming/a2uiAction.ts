// Client→server action uplink for interactive agent-surface widgets.
// Server action-frame format is still open; this module owns a stable
// envelope + swappable transport so UI work is not blocked.

import {
  A2UI_LIMITS,
  type A2uiActionEnvelope,
  type A2uiActionResponse,
} from "./a2uiContract";
import { decodeA2uiActionResponse } from "./a2uiParse";

export type { A2uiActionEnvelope } from "./a2uiContract";

export type A2uiActionTransport = (
  envelope: A2uiActionEnvelope
) => Promise<A2uiActionResponse>;

type A2uiActionReply = (envelope: A2uiActionEnvelope) => A2uiActionResponse;

const ACTION_REQUEST_ERROR_MESSAGE = "A2UI action request failed";
const INVALID_RESPONSE_CODE = "a2ui_invalid_response";
const RESPONSE_TOO_LARGE_CODE = "a2ui_response_too_large";
const TRANSPORT_ERROR_CODE = "a2ui_transport_error";
const REJECTED_HTTP_STATUSES = new Set([400, 401, 403, 413, 415, 422]);

export type A2uiTransportErrorKind =
  "rejected" | "temporarily_rejected" | "expired" | "unknown";

export class A2uiTransportError extends Error {
  readonly name = "A2uiTransportError";
  constructor(
    readonly kind: A2uiTransportErrorKind,
    readonly code: string,
    readonly httpStatus: number | undefined,
    readonly forwarded: boolean,
    readonly retryable: boolean
  ) {
    super(ACTION_REQUEST_ERROR_MESSAGE);
  }
}

interface A2uiGatewayEnvelope {
  code?: string;
  forwarded?: boolean;
  retryable?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseGatewayEnvelope(value: unknown): A2uiGatewayEnvelope {
  if (!isRecord(value) || !isRecord(value.error)) return {};
  if (
    value.error.type !== "gateway_error" ||
    typeof value.error.code !== "string"
  ) {
    return {};
  }
  return {
    code: value.error.code,
    ...(typeof value.forwarded === "boolean"
      ? { forwarded: value.forwarded }
      : {}),
    ...(typeof value.retryable === "boolean"
      ? { retryable: value.retryable }
      : {}),
  };
}

async function readJsonBody(
  response: Response
): Promise<{ value?: unknown; tooLarge: boolean }> {
  const body = await response.text();
  const byteLength = new TextEncoder().encode(body).byteLength;
  if (byteLength > A2UI_LIMITS.responseBytes) return { tooLarge: true };
  try {
    return { value: JSON.parse(body), tooLarge: false };
  } catch {
    return { tooLarge: false };
  }
}

function classifyHttpFailure(
  status: number,
  body: unknown
): A2uiTransportError {
  const envelope = parseGatewayEnvelope(body);
  const forwarded = envelope.forwarded ?? true;
  const retryable = envelope.retryable ?? false;
  const code = envelope.code ?? `a2ui_http_${status}`;

  let kind: A2uiTransportErrorKind = "unknown";
  if (status === 404 || status === 409) {
    kind = "expired";
  } else if (status === 500 || status === 502 || status === 504) {
    kind = "unknown";
  } else if (REJECTED_HTTP_STATUSES.has(status)) {
    kind = "rejected";
  } else if (envelope.forwarded === false && envelope.retryable === true) {
    kind = "temporarily_rejected";
  }

  return new A2uiTransportError(kind, code, status, forwarded, retryable);
}

function invalidResponseError(
  status: number,
  code: string = INVALID_RESPONSE_CODE
): A2uiTransportError {
  return new A2uiTransportError("unknown", code, status, true, false);
}

function unexpectedTransportError(): A2uiTransportError {
  return new A2uiTransportError(
    "unknown",
    TRANSPORT_ERROR_CODE,
    undefined,
    true,
    false
  );
}

export function buildA2uiActionId(): string {
  return `a2ui-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function defaultMemoryA2uiReply(
  envelope: A2uiActionEnvelope
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
  reply: A2uiActionReply
): A2uiActionTransport;
/** Backwards-compatible overload for existing UI tests until their fixtures migrate. */
export function createMemoryA2uiTransport(
  sink: A2uiActionEnvelope[]
): A2uiActionTransport;
export function createMemoryA2uiTransport(
  sink: A2uiActionEnvelope[],
  reply: A2uiActionReply = defaultMemoryA2uiReply
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
    try {
      const token = opts.getToken() ?? "";
      const response = await fetchImpl(
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
        }
      );
      const body = await readJsonBody(response);
      if (!response.ok) {
        throw classifyHttpFailure(
          response.status,
          body.tooLarge ? undefined : body.value
        );
      }
      if (body.tooLarge)
        throw invalidResponseError(response.status, RESPONSE_TOO_LARGE_CODE);
      const decoded = decodeA2uiActionResponse(body.value);
      if (!decoded.ok) throw invalidResponseError(response.status);
      return decoded.value;
    } catch (error) {
      if (error instanceof A2uiTransportError) throw error;
      throw unexpectedTransportError();
    }
  };
}

export function sendA2uiAction(
  envelope: A2uiActionEnvelope,
  transport: A2uiActionTransport
): Promise<A2uiActionResponse> {
  return transport(envelope);
}

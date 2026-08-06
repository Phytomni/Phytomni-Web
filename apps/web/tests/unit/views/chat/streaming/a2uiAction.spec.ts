import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi } from "vitest";
import {
  buildA2uiActionId,
  createMemoryA2uiTransport,
  createFetchA2uiTransport,
  sendA2uiAction,
  A2uiTransportError,
  type A2uiActionEnvelope,
} from "@/views/chat/streaming/a2uiAction";
import type { A2uiActionResponse } from "@/views/chat/streaming/a2uiContract";
import { createA2uiSucceededResponse } from "../../../../helpers/a2uiFixtures";

const fixture = (relativePath: string): unknown =>
  JSON.parse(
    readFileSync(
      resolve(process.cwd(), "tests/fixtures/a2ui", relativePath),
      "utf8"
    )
  );

const terminalResponseFor = (
  envelope: A2uiActionEnvelope
): A2uiActionResponse => {
  return createA2uiSucceededResponse(envelope.run_id);
};

const envelope: A2uiActionEnvelope = {
  surface_id: "s1",
  widget: "confirm",
  action_id: "a1",
  run_id: "r1",
  payload: { accepted: true },
};

const gatewayError = (
  code: string,
  overrides: Record<string, unknown> = {}
) => ({
  error: {
    type: "gateway_error",
    code,
    message: "A2UI actions are unavailable.",
    request_id: "req-1",
  },
  forwarded: false,
  retryable: true,
  ...overrides,
});

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("a2uiAction", () => {
  it("buildA2uiActionId returns a non-empty unique-ish id", () => {
    const a = buildA2uiActionId();
    const b = buildA2uiActionId();
    expect(a.length).toBeGreaterThan(4);
    expect(a).not.toBe(b);
  });

  it("memory transport records envelopes", async () => {
    const sink: A2uiActionEnvelope[] = [];
    const t = createMemoryA2uiTransport(sink, terminalResponseFor);
    const response = await sendA2uiAction(envelope, t);
    expect(response.status).toBe("succeeded");
    expect(sink).toEqual([envelope]);
  });

  it("makes two explicit transport calls for the same action_id", async () => {
    const sink: A2uiActionEnvelope[] = [];
    const t = createMemoryA2uiTransport(sink, terminalResponseFor);
    await sendA2uiAction({ ...envelope, action_id: "same" }, t);
    await sendA2uiAction({ ...envelope, action_id: "same" }, t);
    expect(sink).toHaveLength(2);
  });

  it("fetch transport POSTs the envelope to the provisional path", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify(fixture("http/terminal_succeeded.json")), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );
    const t = createFetchA2uiTransport({
      conversationId: "42",
      getToken: () => "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const response = await t({
      surface_id: "s",
      widget: "form",
      action_id: "a9",
      run_id: "r9",
      payload: { fields: { gene: "Os01g0177400" } },
    });
    expect(response.status).toBe("succeeded");
    expect(response.run_id).toBe("run-contract-1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/v1/conversations/42/a2ui-actions");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.action_id).toBe("a9");
    expect(body.payload.fields.gene).toBe("Os01g0177400");
  });

  it("keeps a successful action when the optional formatted answer exceeds the inline budget", async () => {
    const body = structuredClone(fixture("http/terminal_succeeded.json")) as {
      result: { formatted: { answer: string } };
    };
    body.result.formatted.answer = "x".repeat(13_696);
    const fetchImpl = vi.fn(async () => jsonResponse(200, body));
    const t = createFetchA2uiTransport({
      conversationId: "42",
      getToken: () => "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const response = await t(envelope);

    expect(response.status).toBe("succeeded");
    if (response.status === "succeeded") {
      expect(response.result).not.toHaveProperty("formatted");
    }
  });

  it("fetch transport decodes input-required responses", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify(fixture("http/input_required_round2.json")),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
    );
    const t = createFetchA2uiTransport({
      conversationId: "42",
      getToken: () => "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const response = await t({
      surface_id: "s",
      widget: "choice",
      action_id: "a10",
      run_id: "r10",
      payload: { selected: "a" },
    });
    expect(response.status).toBe("input_required");
    expect(response.run_id).toBe("run-contract-1");
  });

  it("does not automatically retry after fetch rejects", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const t = createFetchA2uiTransport({
      conversationId: "42",
      getToken: () => "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(
      sendA2uiAction({ ...envelope, action_id: "network-failure" }, t)
    ).rejects.toMatchObject({ kind: "unknown" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps an invalid upstream gateway envelope to an ambiguous outcome", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        502,
        gatewayError("a2ui_upstream_invalid", {
          forwarded: true,
          retryable: false,
        })
      )
    );
    const t = createFetchA2uiTransport({
      conversationId: "42",
      getToken: () => "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(t(envelope)).rejects.toMatchObject({
      kind: "unknown",
      code: "a2ui_upstream_invalid",
      httpStatus: 502,
      forwarded: true,
      retryable: false,
      message: "A2UI action request failed",
    });
  });

  it("maps an oversized upstream gateway envelope to an ambiguous outcome", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        502,
        gatewayError("a2ui_upstream_too_large", {
          forwarded: true,
          retryable: false,
        })
      )
    );
    const t = createFetchA2uiTransport({
      conversationId: "42",
      getToken: () => "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(t(envelope)).rejects.toMatchObject({
      kind: "unknown",
      code: "a2ui_upstream_too_large",
      httpStatus: 502,
      forwarded: true,
      retryable: false,
    });
  });

  it.each([404, 409])("maps HTTP %s to expired", async (status) => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(status, gatewayError("a2ui_not_found", { retryable: false }))
    );
    const t = createFetchA2uiTransport({
      conversationId: "42",
      getToken: () => "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(t(envelope)).rejects.toMatchObject({
      kind: "expired",
      code: "a2ui_not_found",
      httpStatus: status,
      forwarded: false,
      retryable: false,
    });
  });

  it.each([400, 401, 403, 413, 415, 422])(
    "maps HTTP %s to rejected",
    async (status) => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse(
          status,
          gatewayError("a2ui_invalid_action", { retryable: false })
        )
      );
      const t = createFetchA2uiTransport({
        conversationId: "42",
        getToken: () => "tok",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      await expect(t(envelope)).rejects.toMatchObject({
        kind: "rejected",
        code: "a2ui_invalid_action",
        httpStatus: status,
        forwarded: false,
        retryable: false,
      });
    }
  );

  it("maps a proven pre-dispatch local rejection to temporarily_rejected", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(503, gatewayError("a2ui_gateway_disabled"))
    );
    const t = createFetchA2uiTransport({
      conversationId: "42",
      getToken: () => "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(t(envelope)).rejects.toMatchObject({
      kind: "temporarily_rejected",
      code: "a2ui_gateway_disabled",
      httpStatus: 503,
      forwarded: false,
      retryable: true,
    });
  });

  it("does not trust non-boolean forwarding metadata", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        503,
        gatewayError("a2ui_gateway_disabled", {
          forwarded: "false",
          retryable: true,
        })
      )
    );
    const t = createFetchA2uiTransport({
      conversationId: "42",
      getToken: () => "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(t(envelope)).rejects.toMatchObject({
      kind: "unknown",
      forwarded: true,
      retryable: true,
    });
  });

  it.each([500, 502, 504])("maps HTTP %s to unknown", async (status) => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        status,
        gatewayError("a2ui_internal", { forwarded: true, retryable: false })
      )
    );
    const t = createFetchA2uiTransport({
      conversationId: "42",
      getToken: () => "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(t(envelope)).rejects.toMatchObject({
      kind: "unknown",
      code: "a2ui_internal",
      httpStatus: status,
      forwarded: true,
      retryable: false,
    });
  });

  it.each([
    ["timeout", new Error("timeout")],
    [
      "abort-after-send",
      new DOMException("The operation was aborted", "AbortError"),
    ],
    ["network", new TypeError("Failed to fetch")],
  ])("maps %s failures to unknown", async (_label, failure) => {
    const fetchImpl = vi.fn(async () => {
      throw failure;
    });
    const t = createFetchA2uiTransport({
      conversationId: "42",
      getToken: () => "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(t(envelope)).rejects.toMatchObject({
      kind: "unknown",
      code: "a2ui_transport_error",
      httpStatus: undefined,
      forwarded: true,
      retryable: false,
      message: "A2UI action request failed",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never includes the upstream error message in the local error", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(400, {
        ...gatewayError("a2ui_invalid_action", { retryable: false }),
        error: {
          ...gatewayError("a2ui_invalid_action").error,
          message: "upstream secret should not be exposed",
        },
      })
    );
    const t = createFetchA2uiTransport({
      conversationId: "42",
      getToken: () => "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const error = await t(envelope).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(A2uiTransportError);
    expect((error as Error).message).toBe("A2UI action request failed");
    expect((error as Error).message).not.toContain("upstream secret");
  });
});

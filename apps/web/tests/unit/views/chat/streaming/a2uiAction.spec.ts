import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  decodeA2uiActionResponse,
} from "@/views/chat/streaming/a2uiParse";
import {
  buildA2uiActionId,
  createMemoryA2uiTransport,
  createFetchA2uiTransport,
  sendA2uiAction,
  _resetA2uiActionIdempotencyForTests,
  type A2uiActionEnvelope,
} from "@/views/chat/streaming/a2uiAction";
import type { A2uiActionResponse } from "@/views/chat/streaming/a2uiContract";

const fixture = (relativePath: string): unknown =>
  JSON.parse(
    readFileSync(resolve(process.cwd(), "tests/fixtures/a2ui", relativePath), "utf8"),
  );

const decodedFixture = (relativePath: string): A2uiActionResponse => {
  const decoded = decodeA2uiActionResponse(fixture(relativePath));
  if (!decoded.ok) throw new Error(`invalid test fixture: ${decoded.reason}`);
  return decoded.value;
};

const terminalResponseFor = (
  envelope: A2uiActionEnvelope,
): A2uiActionResponse => {
  const response = decodedFixture("http/terminal_succeeded.json");
  return { ...response, run_id: envelope.run_id };
};

beforeEach(() => _resetA2uiActionIdempotencyForTests());

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
    const env: A2uiActionEnvelope = {
      surface_id: "s1",
      widget: "confirm",
      action_id: "a1",
      run_id: "r1",
      payload: { accepted: true },
    };
    await sendA2uiAction(env, t);
    expect(sink).toEqual([env]);
  });

  it("sendA2uiAction is idempotent on action_id", async () => {
    const sink: A2uiActionEnvelope[] = [];
    const t = createMemoryA2uiTransport(sink, terminalResponseFor);
    const env: A2uiActionEnvelope = {
      surface_id: "s1",
      widget: "confirm",
      action_id: "same",
      run_id: "r1",
      payload: { accepted: false },
    };
    await sendA2uiAction(env, t);
    await sendA2uiAction(env, t);
    expect(sink).toHaveLength(1);
  });

  it("fetch transport POSTs the envelope to the provisional path", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify(fixture("http/terminal_succeeded.json")), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
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

  it("fetch transport decodes input-required responses", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify(fixture("http/input_required_round2.json")), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
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

  it("fetch transport throws when response is not ok", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 500 }));
    const t = createFetchA2uiTransport({
      conversationId: "42",
      getToken: () => "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(
      sendA2uiAction(
        {
          surface_id: "s",
          widget: "form",
          action_id: "fail-http",
          run_id: "r1",
          payload: {},
        },
        t,
      ),
    ).rejects.toThrow("a2ui action HTTP 500");
  });

  it("allows retry with same action_id after transport failure", async () => {
    const sink: A2uiActionEnvelope[] = [];
    let attempts = 0;
    const t = async (envelope: A2uiActionEnvelope) => {
      attempts++;
      if (attempts === 1) throw new Error("transport failed");
      sink.push(envelope);
      return terminalResponseFor(envelope);
    };
    const env: A2uiActionEnvelope = {
      surface_id: "s1",
      widget: "confirm",
      action_id: "retry-me",
      run_id: "r1",
      payload: { accepted: true },
    };
    await expect(sendA2uiAction(env, t)).rejects.toThrow("transport failed");
    await sendA2uiAction(env, t);
    expect(sink).toEqual([env]);
    expect(attempts).toBe(2);
  });
});

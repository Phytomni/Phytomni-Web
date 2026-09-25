import { describe, expect, it, vi } from "vitest";
import { AxiosError } from "axios";
import { buildAxiosError, buildChatResponse } from "../../helpers/apiBuilders";
import { buildChatMessage, buildChatState } from "../../helpers/chatBuilders";
import {
  buildRouteLocation,
  deferred,
  mustGet,
} from "../../helpers/mockFactories";

describe("typed test builders", () => {
  it("returns independent mutable fixtures", () => {
    const firstState = buildChatState();
    const secondState = buildChatState();
    firstState.fileList.push({
      name: "fixture.txt",
      size: 1,
      type: "text/plain",
      file: new File(["fixture"], "fixture.txt", { type: "text/plain" }),
    });
    firstState.reactions["message-1"] = 1;

    const firstMessage = buildChatMessage();
    const secondMessage = buildChatMessage();
    firstMessage.blocks?.push({
      type: "markdown",
      authority: "web",
      text: "fixture",
    });

    const firstResponse = buildChatResponse();
    const secondResponse = buildChatResponse();
    const firstRoute = buildRouteLocation();
    const secondRoute = buildRouteLocation();
    firstRoute.query.page = "2";
    firstRoute.matched.push(firstRoute.matched[0]);

    expect(secondState.fileList).toEqual([]);
    expect(secondState.reactions).toEqual({});
    expect(secondMessage.blocks).toEqual([]);
    expect(firstResponse).not.toBe(secondResponse);
    expect(secondRoute.query).toEqual({});
    expect(secondRoute.matched).toHaveLength(1);
  });

  it("applies typed overrides without changing later defaults", () => {
    const state = buildChatState({
      messageInput: "typed question",
      mode: "expert",
    });
    const message = buildChatMessage({
      role: "user",
      content: "typed question",
    });
    const response = buildChatResponse({
      query: "typed question",
      answer: "typed answer",
      status: "done",
    });
    const route = buildRouteLocation({
      path: "/chat",
      fullPath: "/chat?dialogue=1",
      query: { dialogue: "1" },
    });

    expect(state.messageInput).toBe("typed question");
    expect(state.mode).toBe("expert");
    expect(message).toMatchObject({ role: "user", content: "typed question" });
    expect(response).toMatchObject({
      query: "typed question",
      answer: "typed answer",
      status: "done",
    });
    expect(route.path).toBe("/chat");
    expect(route.query).toEqual({ dialogue: "1" });
    expect(buildChatState().messageInput).toBe("");
  });

  it("resolves and rejects deferred promises without swallowing the reason", async () => {
    const resolved = deferred<number>();
    resolved.resolve(42);
    await expect(resolved.promise).resolves.toBe(42);

    const rejected = deferred<string>();
    const reason = new Error("fixture rejection");
    rejected.reject(reason);
    await expect(rejected.promise).rejects.toBe(reason);
  });

  it("labels missing required values", () => {
    expect(mustGet("ready", "chat answer")).toBe("ready");
    expect(() => mustGet(undefined, "assistant message")).toThrow(
      "Missing test value: assistant message"
    );
    expect(() => mustGet(null, "request call")).toThrow(
      "Missing test value: request call"
    );
  });

  it("creates an AxiosError instance with safe overrides", () => {
    const error = buildAxiosError({
      message: "timeout",
      code: AxiosError.ECONNABORTED,
    });
    expect(error).toBeInstanceOf(AxiosError);
    expect(error.message).toBe("timeout");
    expect(error.code).toBe(AxiosError.ECONNABORTED);
  });

  it("preserves typed mock call signatures", () => {
    const answerFor = vi.fn<
      (query: string) => ReturnType<typeof buildChatResponse>
    >((query) => buildChatResponse({ query }));

    const response = answerFor("typed query");

    expect(response.query).toBe("typed query");
    expect(answerFor).toHaveBeenCalledWith("typed query");
  });
});

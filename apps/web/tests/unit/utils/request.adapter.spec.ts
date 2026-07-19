import { describe, it, expect, vi, afterEach } from "vitest";

const requestMocks = vi.hoisted(() => ({
  alert: vi.fn(),
  fedLogOut: vi.fn(() => Promise.resolve()),
  message: vi.fn(),
  sessionGetJSON: vi.fn(() => null),
  sessionSetJSON: vi.fn(),
}));

vi.mock("@/utils/auth", () => ({
  getToken: vi.fn(() => "test-token"),
  setToken: vi.fn(),
  setExpiresIn: vi.fn(),
  removeToken: vi.fn(),
  removeExpiresIn: vi.fn(),
}));

vi.mock("@/stores", () => ({
  userStore: () => ({ FedLogOut: requestMocks.fedLogOut }),
}));

vi.mock("element-plus", () => ({
  ElMessage: Object.assign(requestMocks.message, {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  }),
  ElMessageBox: { alert: requestMocks.alert, confirm: vi.fn() },
  ElLoading: { service: vi.fn(() => ({ close: vi.fn() })) },
}));

vi.mock("@/locales", () => ({
  default: { global: { locale: { value: "en-US" }, t: (k: string) => k } },
}));

vi.mock("@/plugins/cache", () => ({
  default: {
    session: {
      getJSON: requestMocks.sessionGetJSON,
      setJSON: requestMocks.sessionSetJSON,
    },
  },
}));

import service from "@/utils/request";
import type { AxiosResponse, InternalAxiosRequestConfig } from "axios";

describe("request.ts interceptor pipeline via custom adapter", () => {
  const originalAdapter = service.defaults.adapter;

  afterEach(() => {
    service.defaults.adapter = originalAdapter;
    requestMocks.alert.mockReset();
    requestMocks.fedLogOut.mockReset().mockResolvedValue(undefined);
    requestMocks.message.mockReset();
    requestMocks.sessionGetJSON.mockReset().mockReturnValue(null);
    requestMocks.sessionSetJSON.mockReset();
  });

  it("attaches Authorization, satoken, and platform on the way out", async () => {
    let seen: InternalAxiosRequestConfig | undefined;
    service.defaults.adapter = async (config) => {
      seen = config as InternalAxiosRequestConfig;
      const response: AxiosResponse = {
        data: { code: 200, data: { ok: true } },
        status: 200,
        statusText: "OK",
        headers: {},
        config: config as InternalAxiosRequestConfig,
        request: { responseType: "" },
      };
      return response;
    };

    const data = await service.get("/api/v1/probe");

    expect(seen?.headers?.platform).toBe("bcemis");
    expect(seen?.headers?.Authorization).toBe("Bearer test-token");
    expect(seen?.headers?.satoken).toBe("test-token");
    expect(seen?.headers?.["Accept-Language"]).toBe("en-US");
    expect(data).toEqual({ code: 200, data: { ok: true } });
  });

  it("returns a Blob for blob responses without changing JSON unwrapping", async () => {
    const blob = new Blob(["binary"]);
    service.defaults.adapter = async (config) => ({
      data: blob,
      status: 200,
      statusText: "OK",
      headers: { "content-type": "application/json" },
      config: config as InternalAxiosRequestConfig,
      request: { responseType: "blob" },
    });

    await expect(
      service.post("/api/v1/download", {}, { responseType: "blob" })
    ).resolves.toBe(blob);
  });

  it("preserves the full response for octet-stream responses", async () => {
    const blob = new Blob(["binary"]);
    service.defaults.adapter = async (config) => {
      const response: AxiosResponse = {
        data: blob,
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/octet-stream" },
        config: config as InternalAxiosRequestConfig,
        request: { responseType: "blob" },
      };
      return response;
    };

    const response = await service.post(
      "/api/v1/download",
      {},
      { responseType: "blob" }
    );

    expect(response).toMatchObject({ data: blob, status: 200 });
    expect(response).toHaveProperty(
      "headers.content-type",
      "application/octet-stream"
    );
  });

  it("keeps duplicate-submit cancellation metadata on the second request", async () => {
    const seen: InternalAxiosRequestConfig[] = [];
    requestMocks.sessionGetJSON.mockReturnValueOnce(null).mockReturnValue({
      url: "/api/v1/probe",
      data: JSON.stringify({ value: 1 }),
      time: Date.now(),
    });
    service.defaults.adapter = async (config) => {
      seen.push(config as InternalAxiosRequestConfig);
      return {
        data: { code: 200, ok: true },
        status: 200,
        statusText: "OK",
        headers: {},
        config: config as InternalAxiosRequestConfig,
        request: { responseType: "" },
      };
    };

    await service.post("/api/v1/probe", { value: 1 });
    await service.post("/api/v1/probe", { value: 1 });

    expect(seen).toHaveLength(2);
    expect(seen[0].cancelToken).toBeUndefined();
    expect(seen[1].cancelToken).toBeDefined();
  });

  it("logs response errors without exposing request headers", async () => {
    const secret = "Bearer request-secret";
    const error = {
      config: {
        url: "/api/v1/private",
        headers: { Authorization: secret, satoken: "request-secret" },
      },
      response: { status: 500, data: { message: "server failure" } },
      message: "Request failed with status code 500",
    };
    const consoleLog = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    service.defaults.adapter = async () => Promise.reject(error);

    try {
      await expect(service.get("/api/v1/private")).rejects.toBe(error);
      expect(consoleLog).toHaveBeenCalledWith("response error:", {
        status: 500,
        url: "/api/v1/private",
        message: error.message,
      });
      expect(JSON.stringify(consoleLog.mock.calls)).not.toContain(secret);
    } finally {
      consoleLog.mockRestore();
    }
  });

  it("offers logout for a 401 response without exposing request headers", async () => {
    requestMocks.fedLogOut.mockImplementation(
      () => new Promise<void>(() => undefined)
    );
    requestMocks.alert.mockImplementation(
      (_message: unknown, options: { callback?: () => void }) => {
        options.callback?.();
      }
    );
    service.defaults.adapter = async (config) => ({
      data: { code: 401, message: "expired" },
      status: 200,
      statusText: "OK",
      headers: { Authorization: "Bearer response-secret" },
      config: config as InternalAxiosRequestConfig,
      request: { responseType: "" },
    });

    await expect(service.get("/api/v1/private")).rejects.toBe(
      "request.sessionInvalid"
    );
    expect(requestMocks.alert).toHaveBeenCalledTimes(1);
    expect(requestMocks.fedLogOut).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(requestMocks.alert.mock.calls)).not.toContain(
      "response-secret"
    );
  });

  it("logs out on a forbidden response without logging headers", async () => {
    const secret = "Bearer forbidden-secret";
    const error = {
      config: {
        url: "/api/v1/private",
        headers: { Authorization: secret, satoken: "forbidden-secret" },
      },
      response: { status: 403, data: { detail: { code: 403 } } },
      message: "Request failed with status code 403",
    };
    requestMocks.fedLogOut.mockImplementation(
      () => new Promise<void>(() => undefined)
    );
    const consoleLog = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    service.defaults.adapter = async () => Promise.reject(error);

    try {
      await expect(service.get("/api/v1/private")).rejects.toBe(error);
      expect(requestMocks.fedLogOut).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(consoleLog.mock.calls)).not.toContain(secret);
    } finally {
      consoleLog.mockRestore();
    }
  });
});

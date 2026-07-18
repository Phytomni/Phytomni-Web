import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/utils/auth", () => ({
  getToken: vi.fn(() => "test-token"),
  setToken: vi.fn(),
  setExpiresIn: vi.fn(),
  removeToken: vi.fn(),
  removeExpiresIn: vi.fn(),
}));

vi.mock("@/stores", () => ({
  userStore: () => ({ FedLogOut: vi.fn() }),
}));

vi.mock("element-plus", () => ({
  ElMessage: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
  ElMessageBox: { confirm: vi.fn() },
  ElLoading: { service: vi.fn(() => ({ close: vi.fn() })) },
}));

vi.mock("@/locales", () => ({
  default: { global: { locale: { value: "en-US" }, t: (k: string) => k } },
}));

vi.mock("@/plugins/cache", () => ({
  default: {
    session: {
      getJSON: vi.fn(() => null),
      setJSON: vi.fn(),
    },
  },
}));

import service from "@/utils/request";
import type { AxiosResponse, InternalAxiosRequestConfig } from "axios";

describe("request.ts interceptor pipeline via custom adapter", () => {
  const originalAdapter = service.defaults.adapter;

  afterEach(() => {
    service.defaults.adapter = originalAdapter;
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
});

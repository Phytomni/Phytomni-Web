import axios, {
  type AxiosInstance,
  type AxiosProgressEvent,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import { ElMessage, ElMessageBox } from "element-plus";

import { userStore } from "@/stores";
import { isRecord, optionalString } from "@/api/contracts";
import { getToken } from "@/utils/auth";
import errorCode from "@/utils/error-code";
import { tansParams, blobValidate } from "@/utils";
import cache from "@/plugins/cache";
import { saveAs } from "file-saver";
import i18n from "@/locales";
import { createTransferTracker } from "@/utils/transfer-progress";
import {
  removeDownloadTransfer,
  upsertDownloadTransfer,
} from "@/utils/download-transfers";

const CancelToken = axios.CancelToken;
const source = CancelToken.source();

// whether to show the re-login prompt
export const isRelogin = { show: false };

// don't set the header; let the browser detect it automatically
// axios.defaults.headers['Content-Type'] = 'application/json;charset=utf-8';
// create the axios instance
// const baseURL = import.meta.env.VITE_BASE_API;
const baseURL = "";

const service: AxiosInstance = axios.create({
  // axios request config has a baseURL option for the common URL prefix
  baseURL: baseURL,
  // timeout
  timeout: 100000000,
});

/** Axios returns the interceptor's unwrapped payload at runtime. */
export interface UnwrappedHttpClient {
  <T = unknown, D = unknown>(
    config: AxiosRequestConfig<D> & { requestId?: string }
  ): Promise<T>;
}

const request = service as unknown as UnwrappedHttpClient;

/**
 * Axios types response interceptors as preserving `AxiosResponse<any>`, but
 * this instance deliberately unwraps successful payloads before they reach
 * callers. Keep that runtime contract explicit at the one third-party seam.
 */
interface UnwrappedResponseInterceptorManager {
  use(
    onFulfilled?: ((value: AxiosResponse<unknown>) => unknown) | null,
    onRejected?: ((error: unknown) => unknown) | null
  ): number;
}

const responseInterceptors = service.interceptors
  .response as unknown as UnwrappedResponseInterceptorManager;

// store active request controllers
const activeControllers = new Map<string, AbortController>();

type DuplicateRequestRecord = {
  url?: string;
  data?: unknown;
  time?: number;
};

function readDuplicateRequestRecord(): DuplicateRequestRecord | undefined {
  const raw: unknown = cache.session.getJSON("sessionObj");
  if (!isRecord(raw)) return undefined;

  return {
    url: optionalString(raw, "url"),
    data: raw.data,
    time:
      typeof raw.time === "number" && Number.isFinite(raw.time)
        ? raw.time
        : undefined,
  };
}

// request interceptor
service.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // `isToken` / `repeatSubmit` are custom call-site sentinels stashed on
    // `config.headers` by callers; axios's typed header interface does not
    // know about them, so we treat the access as opaque to read the flags
    // without breaking the public contract.
    const headerFlags = config.headers as unknown as Record<string, unknown>;
    const isToken = headerFlags?.isToken === false;
    // whether to prevent duplicate submissions
    const isRepeatSubmit = headerFlags?.repeatSubmit === false;
    config.headers["platform"] = "bcemis";
    if (getToken() && !isToken) {
      config.headers["Authorization"] = "Bearer " + getToken(); // attach a custom token to every request; adjust as needed
    }
    if (getToken()) {
      config.headers["satoken"] = getToken();
    }
    // have the backend return localized error messages per the current vue-i18n locale
    config.headers["Accept-Language"] = i18n.global.locale.value;
    // map params for GET requests
    if (config.method === "get" && config.params) {
      let url = config.url + "?" + tansParams(config.params);
      url = url.slice(0, -1);
      config.params = {};
      config.url = url;
    }
    if (
      !isRepeatSubmit &&
      (config.method === "post" || config.method === "put")
    ) {
      const requestData: unknown =
        typeof config.data === "object"
          ? JSON.stringify(config.data)
          : (config.data as unknown);
      const requestObj = {
        url: config.url,
        data: requestData,
        time: new Date().getTime(),
      };
      const sessionObj = readDuplicateRequestRecord();
      if (!sessionObj) {
        cache.session.setJSON("sessionObj", requestObj);
      } else {
        const s_url = sessionObj.url; // request URL
        const s_data = sessionObj.data; // request data
        const s_time = sessionObj.time; // request time
        const interval = 1000; // interval (ms); requests within this window are treated as duplicate submissions
        // pre-flight check
        if (
          s_data === requestObj.data &&
          typeof s_time === "number" &&
          requestObj.time - s_time < interval &&
          s_url === requestObj.url
        ) {
          config.cancelToken = source.token;
          // the cancel function can take no args, or an action to run after cancellation; you can prompt the user to log in
        } else {
          cache.session.setJSON("sessionObj", requestObj);
        }
      }
    }

    return config;
  },
  (error: unknown) => {
    // Only log the redacted message; never log the raw error object: an axios error
    // carries config.headers (here including the Authorization Bearer + satoken), so
    // logging the whole thing would write live tokens into the browser console.
    console.log("request error:", readErrorMessage(error));
    return Promise.reject(error);
  }
);

// errorCode keys are HTTP-code strings whose values are i18n thunks; the
// JS code below intentionally chains the lookup with `|| msg || default`
// and feeds the result straight into ElMessage. Casting to a permissive
// record lets that pre-existing pattern type-check without altering its
// runtime path.
type ErrorCodeLookup = Record<string, (() => string) | string>;

const errorCodeLookup: ErrorCodeLookup = errorCode;

function resolveErrorCode(key: string): string | undefined {
  const configured = errorCodeLookup[key];
  if (typeof configured === "function") return configured();
  return typeof configured === "string" ? configured : undefined;
}

type SafeErrorResponse = {
  status?: number;
  data?: unknown;
};

function readErrorResponse(error: unknown): SafeErrorResponse | undefined {
  if (axios.isAxiosError<unknown>(error)) {
    if (!error.response) return undefined;
    return {
      status: error.response.status,
      data: error.response.data,
    };
  }
  if (!isRecord(error) || !isRecord(error.response)) return undefined;
  const status = error.response.status;
  return {
    status:
      typeof status === "number" && Number.isFinite(status)
        ? status
        : undefined,
    data: error.response.data,
  };
}

function readErrorUrl(error: unknown): string | undefined {
  if (axios.isAxiosError<unknown>(error)) return error.config?.url;
  if (!isRecord(error) || !isRecord(error.config)) return undefined;
  return optionalString(error.config, "url");
}

function readErrorMessage(error: unknown): string {
  if (axios.isAxiosError<unknown>(error)) return error.message;
  if (error instanceof Error) return error.message;
  if (isRecord(error)) return optionalString(error, "message") ?? "";
  return "";
}

function isCanceledRequest(error: unknown): boolean {
  if (axios.isCancel(error)) return true;
  if (axios.isAxiosError<unknown>(error)) {
    return error.code === "ERR_CANCELED" || error.name === "CanceledError";
  }
  if (!isRecord(error)) return false;
  return error.code === "ERR_CANCELED" || error.name === "CanceledError";
}

// response interceptor
responseInterceptors.use(
  (res: AxiosResponse<unknown>) => {
    const responseData = isRecord(res.data) ? res.data : undefined;
    // default to a success status when no code is set
    const responseCode = responseData?.code;
    const code =
      typeof responseCode === "number" &&
      Number.isFinite(responseCode) &&
      responseCode !== 0
        ? responseCode
        : 200;
    // get the error message
    const msg =
      errorCodeLookup[code] ||
      optionalString(responseData ?? {}, "message") ||
      errorCodeLookup.default;
    // return binary data directly
    if (res.headers?.["content-type"] === "application/octet-stream") {
      return res;
    }
    const responseType = isRecord(res.request)
      ? res.request.responseType
      : undefined;
    if (responseType === "blob" || responseType === "arraybuffer") {
      return res.data;
    }

    const detailCode =
      responseData && isRecord(responseData.detail)
        ? responseData.detail.code
        : undefined;
    if (code === 401 || detailCode === 403) {
      if (!isRelogin.show) {
        isRelogin.show = true;
        ElMessageBox.alert(i18n.global.t("request.sessionExpired"), {
          confirmButtonText: i18n.global.t("request.confirmButtonText"),
          type: "warning",
          callback: () => {
            isRelogin.show = false;
            const UserStore = userStore();
            UserStore.FedLogOut()
              .finally(() => {
                // clear all caches and cookies
                localStorage.clear();
                sessionStorage.clear();
                document.cookie.split(";").forEach(function (c) {
                  document.cookie = c
                    .replace(/^ +/, "")
                    .replace(
                      /=.*/,
                      "=;expires=" + new Date().toUTCString() + ";path=/"
                    );
                });
                location.href = "/login";
              })
              .catch(() => undefined);
          },
        }).catch(() => undefined);
      }
      return Promise.reject(i18n.global.t("request.sessionInvalid"));
    } else if (code === 500) {
      if (msg !== "Cannot create property 'headers' on boolean 'false'") {
        ElMessage({
          message: msg as string,
          type: "error",
        });
      }
      return Promise.reject(new Error(msg as string));
    } else if (code !== 200) {
      ElMessage({
        message: msg as string,
        type: "error",
      });

      return Promise.reject("error");
    } else {
      return res.data;
    }
  },
  (error: unknown) => {
    const response = readErrorResponse(error);
    const responseData =
      response && isRecord(response.data) ? response.data : undefined;
    let message = readErrorMessage(error);
    // Redacted log — the raw axios error embeds config.headers (Bearer token + satoken),
    // so we expose only the non-sensitive fields useful for debugging.
    console.log("response error:", {
      status: response?.status,
      url: readErrorUrl(error),
      message,
    });
    if (isCanceledRequest(error)) {
      return Promise.reject(error);
    }
    const detailCode =
      responseData && isRecord(responseData.detail)
        ? responseData.detail.code
        : undefined;
    if (detailCode === 403) {
      isRelogin.show = false;
      const UserStore = userStore();
      UserStore.FedLogOut().finally(() => {
        // clear all caches and cookies
        localStorage.clear();
        sessionStorage.clear();
        document.cookie.split(";").forEach(function (c) {
          document.cookie = c
            .replace(/^ +/, "")
            .replace(
              /=.*/,
              "=;expires=" + new Date().toUTCString() + ";path=/"
            );
        });
        location.href = "/login";
      });
    }

    if (message === "Data is being processed, please do not resubmit") return;
    // Prefer the readable server-returned message (Go gateway error body {code, message};
    // legacy Python service detail string), otherwise fall back to axios's generic error text.
    const serverMessage =
      optionalString(responseData ?? {}, "message") ||
      (typeof responseData?.detail === "string" ? responseData.detail : "");
    if (serverMessage) {
      message = serverMessage;
    } else if (message == "Network Error") {
      message = i18n.global.t("request.networkError");
    } else if (message.includes("timeout")) {
      message = i18n.global.t("request.requestTimeout");
    } else if (message.includes("Request failed with status code")) {
      message = i18n.global.t("request.httpStatusError", {
        code: message.substr(message.length - 3),
      });
    }
    if (message !== "Cannot create property 'headers' on boolean 'false'") {
      ElMessage({
        message: message,
        type: "error",
        duration: 5 * 1000,
      });
    }

    return Promise.reject(error);
  }
);

let downloadRequestSeq = 0;

// generic download method
export function download(
  url: string,
  params: unknown,
  filename: string
): Promise<void> {
  const controller = new AbortController();
  const requestId = `download-${Date.now()}-${++downloadRequestSeq}`;
  const tracker = createTransferTracker({ phase: "download", requestId });
  registerAbortController(requestId, controller);

  // The response interceptor unwraps `res.data` for `responseType: 'blob'`;
  // the generic request boundary records that runtime contract explicitly.
  return request<Blob>({
    url,
    method: "post",
    data: params,
    transformRequest: [(p: unknown) => tansParams(p)],
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    responseType: "blob",
    signal: controller.signal,
    onDownloadProgress: (event: AxiosProgressEvent) => {
      upsertDownloadTransfer(tracker.update(event));
    },
  })
    .then(async (data) => {
      const isLogin = await blobValidate(data);
      if (isLogin) {
        const blob = new Blob([data]);
        saveAs(blob, filename);
      } else {
        const resText = await data.text();
        const parsed: unknown = JSON.parse(resText);
        const rspObj = isRecord(parsed) ? parsed : {};
        const codeValue = rspObj.code;
        const codeKey =
          typeof codeValue === "string" || typeof codeValue === "number"
            ? String(codeValue)
            : undefined;
        const errMsg =
          (codeKey ? resolveErrorCode(codeKey) : undefined) ||
          optionalString(rspObj, "msg") ||
          resolveErrorCode("default") ||
          i18n.global.t("chat.downloadError");
        ElMessage.error(errMsg);
      }
    })
    .catch((r) => {
      if (isCanceledRequest(r)) {
        ElMessage.info(i18n.global.t("chat.downloadCancelled"));
        return;
      }
      console.error(r);
      ElMessage.error(i18n.global.t("chat.downloadError"));
    })
    .finally(() => {
      removeDownloadTransfer(requestId);
      unregisterAbortController(requestId);
    });
}

// Create an abortable request — accept the public AxiosRequestConfig shape (headers
// optional) so call sites can pass plain config literals; the stored
// `requestId` is just a tag used to address controller entries.
export const createAbortableRequest = <T = unknown, D = unknown>(
  config: AxiosRequestConfig<D> & { requestId?: string }
): Promise<T> => {
  const controller = new AbortController();
  const requestId = config.requestId || Date.now().toString();

  // store the controller
  activeControllers.set(requestId, controller);

  // add the abort signal to the config
  config.signal = controller.signal;
  config.requestId = requestId;

  return request<T, D>(config).finally(() => {
    // clean up the controller after the request completes
    activeControllers.delete(requestId);
  });
};

// registerAbortController lets a non-axios transport (the fetch-based stream
// path) register its AbortController under the same requestId key that
// abortRequest() looks up, so the existing abort UI works for both paths.
export const registerAbortController = (
  requestId: string,
  controller: AbortController
): void => {
  activeControllers.set(requestId, controller);
};

// unregisterAbortController drops a controller the fetch path registered once
// its stream settles, mirroring the axios path's .finally cleanup so the map
// does not accumulate a stale entry per streamed message.
export const unregisterAbortController = (requestId: string): void => {
  activeControllers.delete(requestId);
};

// abort a specific request
export const abortRequest = (requestId: string): boolean => {
  const controller = activeControllers.get(requestId);
  if (controller) {
    controller.abort();
    activeControllers.delete(requestId);
    return true;
  }
  return false;
};

// abort all active requests
export const abortAllRequests = (): void => {
  activeControllers.forEach((controller) => {
    controller.abort();
  });
  activeControllers.clear();
};

export default request;

import axios, {
  type AxiosInstance,
  type AxiosProgressEvent,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import { ElMessage, ElMessageBox } from "element-plus";

import { userStore } from "@/stores";
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

// store active request controllers
const activeControllers = new Map<string, AbortController>();

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
      const requestObj = {
        url: config.url,
        data:
          typeof config.data === "object"
            ? JSON.stringify(config.data)
            : config.data,
        time: new Date().getTime(),
      };
      const sessionObj = cache.session.getJSON("sessionObj");
      if (
        sessionObj === undefined ||
        sessionObj === null ||
        sessionObj === ""
      ) {
        cache.session.setJSON("sessionObj", requestObj);
      } else {
        const s_url = sessionObj.url; // request URL
        const s_data = sessionObj.data; // request data
        const s_time = sessionObj.time; // request time
        const interval = 1000; // interval (ms); requests within this window are treated as duplicate submissions
        // pre-flight check
        if (
          s_data === requestObj.data &&
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
    console.log(
      "request error:",
      error instanceof Error ? error.message : String(error)
    );
    Promise.reject(error);
  }
);

// errorCode keys are HTTP-code strings whose values are i18n thunks; the
// JS code below intentionally chains the lookup with `|| msg || default`
// and feeds the result straight into ElMessage. Casting to a permissive
// record lets that pre-existing pattern type-check without altering its
// runtime path.
type ErrorCodeLookup = Record<string, (() => string) | string>;

// response interceptor
service.interceptors.response.use(
  (res: AxiosResponse) => {
    // default to a success status when no code is set
    const code = res.data.code || 200;
    // get the error message
    const msg =
      (errorCode as ErrorCodeLookup)[code] ||
      res.data.message ||
      (errorCode as ErrorCodeLookup)["default"];
    // return binary data directly
    if (res.headers["content-type"] === "application/octet-stream") {
      return res;
    }
    if (
      res.request.responseType === "blob" ||
      res.request.responseType === "arraybuffer"
    ) {
      return res.data;
    }

    if (code === 401 || (res.data.detail && res.data.detail.code === 403)) {
      if (!isRelogin.show) {
        isRelogin.show = true;
        ElMessageBox.alert(i18n.global.t("request.sessionExpired"), {
          confirmButtonText: i18n.global.t("request.confirmButtonText"),
          type: "warning",
          callback: () => {
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
          },
        });
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
  (error: any) => {
    // Redacted log — the raw axios error embeds config.headers (Bearer token + satoken),
    // so we expose only the non-sensitive fields useful for debugging.
    console.log("response error:", {
      status: error?.response?.status,
      url: error?.config?.url,
      message: error?.message,
    });
    const { response } = error;
    let { message } = error;
    if (response?.data?.detail?.code === 403) {
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
      response?.data?.message ||
      (typeof response?.data?.detail === "string" ? response.data.detail : "");
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

function isCanceledRequest(error: unknown): boolean {
  const err = error as { code?: unknown; name?: unknown };
  return (
    axios.isCancel(error) ||
    err?.code === "ERR_CANCELED" ||
    err?.name === "CanceledError"
  );
}

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

  // The response interceptor above unwraps `res.data` for `responseType:
  // 'blob'`, so at runtime the promise resolves to a Blob rather than an
  // AxiosResponse. The cast aligns axios's static type with that runtime
  // contract — see the `responseType === 'blob'` branch in the interceptor
  // for the source of the unwrap.
  return (
    service.post(url, params, {
      transformRequest: [
        (p: unknown) => tansParams(p as { [x: string]: unknown }),
      ],
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      responseType: "blob",
      signal: controller.signal,
      onDownloadProgress: (event: AxiosProgressEvent) => {
        upsertDownloadTransfer(tracker.update(event));
      },
    }) as unknown as Promise<Blob>
  )
    .then(async (data) => {
      const isLogin = await blobValidate(data);
      if (isLogin) {
        const blob = new Blob([data]);
        saveAs(blob, filename);
      } else {
        const resText = await data.text();
        const rspObj = JSON.parse(resText);
        const errMsg =
          (errorCode as ErrorCodeLookup)[rspObj.code] ||
          rspObj.msg ||
          (errorCode as ErrorCodeLookup)["default"];
        ElMessage.error(errMsg as string);
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
export const createAbortableRequest = (
  config: AxiosRequestConfig & { requestId?: string }
) => {
  const controller = new AbortController();
  const requestId = config.requestId || Date.now().toString();

  // store the controller
  activeControllers.set(requestId, controller);

  // add the abort signal to the config
  config.signal = controller.signal;
  config.requestId = requestId;

  return service(config).finally(() => {
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

export default service;

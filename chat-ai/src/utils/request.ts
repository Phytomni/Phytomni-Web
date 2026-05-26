import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { ElMessage, ElMessageBox, ElLoading } from 'element-plus';

import { userStore } from '@/stores';
import { getToken } from '@/utils/auth';
import errorCode from '@/utils/errorCode';
import { tansParams, blobValidate } from '@/utils';
import cache from '@/plugins/cache';
import { saveAs } from 'file-saver';

const CancelToken = axios.CancelToken;
const source = CancelToken.source();

let downloadLoadingInstance: ReturnType<typeof ElLoading.service> | undefined;
// 是否显示重新登录
export let isRelogin = { show: false };

//不设置header，让浏览器自动识别
// axios.defaults.headers['Content-Type'] = 'application/json;charset=utf-8';
// 创建axios实例
// const baseURL = import.meta.env.VITE_BASE_API;
const baseURL = '';

const service: AxiosInstance = axios.create({
  // axios中请求配置有baseURL选项，表示请求URL公共部分
  baseURL: baseURL,
  // 超时
  timeout: 100000000,
});

// 存储活跃的请求控制器
const activeControllers = new Map<string, AbortController>();

// request拦截器
service.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // `isToken` / `repeatSubmit` are custom call-site sentinels stashed on
    // `config.headers` by callers; axios's typed header interface does not
    // know about them, so we treat the access as opaque to read the flags
    // without breaking the public contract.
    const headerFlags = config.headers as unknown as Record<string, unknown>;
    const isToken = headerFlags?.isToken === false;
    // 是否需要防止数据重复提交
    const isRepeatSubmit = headerFlags?.repeatSubmit === false;
    config.headers['platform'] = 'bcemis';
    if (getToken() && !isToken) {
      config.headers['Authorization'] = 'Bearer ' + getToken(); // 让每个请求携带自定义token 请根据实际情况自行修改
    }
    if (getToken()) {
      config.headers['satoken'] = getToken();
    }
    // get请求映射params参数
    if (config.method === 'get' && config.params) {
      let url = config.url + '?' + tansParams(config.params);
      url = url.slice(0, -1);
      config.params = {};
      config.url = url;
    }
    if (
      !isRepeatSubmit &&
      (config.method === 'post' || config.method === 'put')
    ) {
      const requestObj = {
        url: config.url,
        data:
          typeof config.data === 'object'
            ? JSON.stringify(config.data)
            : config.data,
        time: new Date().getTime(),
      };
      const sessionObj = cache.session.getJSON('sessionObj');
      if (
        sessionObj === undefined ||
        sessionObj === null ||
        sessionObj === ''
      ) {
        cache.session.setJSON('sessionObj', requestObj);
      } else {
        const s_url = sessionObj.url; // 请求地址
        const s_data = sessionObj.data; // 请求数据
        const s_time = sessionObj.time; // 请求时间
        const interval = 1000; // 间隔时间(ms)，小于此时间视为重复提交
        // 预检拦截
        if (
          s_data === requestObj.data &&
          requestObj.time - s_time < interval &&
          s_url === requestObj.url
        ) {
          config.cancelToken = source.token;
          // cancel函数可以不用传参，也可以传入取消后执行的操作，取消后可提示用户需要登录
        } else {
          cache.session.setJSON('sessionObj', requestObj);
        }
      }
    }

    return config;
  },
  (error: unknown) => {
    console.log(error, 'error');
    Promise.reject(error);
  }
);

// errorCode keys are HTTP-code strings whose values are i18n thunks; the
// JS code below intentionally chains the lookup with `|| msg || default`
// and feeds the result straight into ElMessage. Casting to a permissive
// record lets that pre-existing pattern type-check without altering its
// runtime path.
type ErrorCodeLookup = Record<string, (() => string) | string>;

// 响应拦截器
service.interceptors.response.use(
  (res: AxiosResponse) => {

    // 未设置状态码则默认成功状态
    const code = res.data.code || 200;
    // 获取错误信息
    const msg = (errorCode as ErrorCodeLookup)[code] || res.data.msg || (errorCode as ErrorCodeLookup)['default'];
    // 二进制数据则直接返回
    if (
      res.headers['content-type'] === 'application/octet-stream'
    ) {
      return res;
    }
    if (
      res.request.responseType === 'blob' ||
      res.request.responseType === 'arraybuffer'
    ) {
      return res.data;
    }

    if (code === 401 || (res.data.detail && res.data.detail.code === 403)) {
      if (!isRelogin.show) {
        isRelogin.show = true;
        ElMessageBox.alert(
          '登录已过期，请重新登录',
          {
            confirmButtonText: '我知道了',
            type: 'warning',
            callback: () => {
              isRelogin.show = false;
              const UserStore = userStore();
              UserStore.FedLogOut().then(() => {
                // 清除所有缓存和cookie
                localStorage.clear();
                sessionStorage.clear();
                document.cookie.split(";").forEach(function(c) {
                  document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
                });
                location.href = '/login';
              });
            }
          }
        );
      }
      return Promise.reject('无效的会话，或者会话已过期，请重新登录。');
    } else if (code === 500) {
      if (msg !== "Cannot create property 'headers' on boolean 'false'") {
        ElMessage({
          message: msg as string,
          type: 'error',
        });
      }
      return Promise.reject(new Error(msg as string));
    } else if (code !== 200) {
      ElMessage({
        message: msg as string,
        type: 'error',
      });

      return Promise.reject('error');
    } else {
      return res.data;
    }
  },
  (error: any) => {
    console.log(error, 'error1111');
    let { message, response } = error;
    if (response.data.detail.code === 403) {
      isRelogin.show = false;
      const UserStore = userStore();
      UserStore.FedLogOut().then(() => {
        // 清除所有缓存和cookie
        localStorage.clear();
        sessionStorage.clear();
        document.cookie.split(";").forEach(function (c) {
          document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
        });
        location.href = '/login';
      });
    }

    if (message === '数据正在处理，请勿重复提交') return;
    if (message == 'Network Error') {
      message = '后端接口连接异常';
    } else if (message.includes('timeout')) {
      message = '系统接口请求超时';
    } else if (message.includes('Request failed with status code')) {
      message = '系统接口' + message.substr(message.length - 3) + '异常';
    }
    if (message !== "Cannot create property 'headers' on boolean 'false'") {
      ElMessage({
        message: message,
        type: 'error',
        duration: 5 * 1000,
      });
    }

    return Promise.reject(error);
  }
);

// 通用下载方法
export function download(url: string, params: unknown, filename: string): Promise<void> {
  downloadLoadingInstance = ElLoading.service({
    text: '正在下载数据，请稍候',
    spinner: 'el-icon-loading',
    background: 'rgba(0, 0, 0, 0.7)',
  });
  // The response interceptor above unwraps `res.data` for `responseType:
  // 'blob'`, so at runtime the promise resolves to a Blob rather than an
  // AxiosResponse. The cast aligns axios's static type with that runtime
  // contract — see the `responseType === 'blob'` branch in the interceptor
  // for the source of the unwrap.
  return (service
    .post(url, params, {
      transformRequest: [(p: unknown) => tansParams(p as { [x: string]: unknown })],
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      responseType: 'blob',
    }) as unknown as Promise<Blob>)
    .then(async data => {
      const isLogin = await blobValidate(data);
      if (isLogin) {
        const blob = new Blob([data]);
        saveAs(blob, filename);
      } else {
        const resText = await data.text();
        const rspObj = JSON.parse(resText);
        const errMsg =
          (errorCode as ErrorCodeLookup)[rspObj.code] || rspObj.msg || (errorCode as ErrorCodeLookup)['default'];
        ElMessage.error(errMsg as string);
      }
      downloadLoadingInstance?.close();
    })
    .catch(r => {
      console.error(r);
      ElMessage.error('下载文件出现错误，请联系管理员！');
      downloadLoadingInstance?.close();
    });
}

// 创建可中止的请求 — accept the public AxiosRequestConfig shape (headers
// optional) so call sites can pass plain config literals; the stored
// `requestId` is just a tag used to address controller entries.
export const createAbortableRequest = (config: AxiosRequestConfig & { requestId?: string }) => {
  const controller = new AbortController();
  const requestId = config.requestId || Date.now().toString();

  // 存储控制器
  activeControllers.set(requestId, controller);

  // 添加中止信号到配置
  config.signal = controller.signal;
  config.requestId = requestId;

  return service(config).finally(() => {
    // 请求完成后清理控制器
    activeControllers.delete(requestId);
  });
};

// 中止指定请求
export const abortRequest = (requestId: string): boolean => {
  const controller = activeControllers.get(requestId);
  if (controller) {
    controller.abort();
    activeControllers.delete(requestId);
    return true;
  }
  return false;
};

// 中止所有活跃请求
export const abortAllRequests = (): void => {
  activeControllers.forEach((controller) => {
    controller.abort();
  });
  activeControllers.clear();
};

export default service;
// // 使用方法;
// import request from '@/utils/request';
// // 登录方法
// export function login(name, pwd, code, uuid) {
//   return request({
//     url: '/auth/sso/doLogin',
//     headers: {
//       isToken: false,
//     },
//     method: 'get',
//     params: { name, pwd, code, uuid },
//   });
// }
// // 刷新方法
// export function refreshToken() {
//   return request({
//     url: '/auth/refresh',
//     method: 'post',
//   });
// }

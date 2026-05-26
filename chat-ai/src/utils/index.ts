/*
 * 组件注释
 * @Author: wuq-l
 * @Date: 2022-08-31 21:32:03
 * @LastEditors: machinist_wq
 * @LastEditTime: 2023-01-30 11:11:30
 * @Description:
 * 人生无常！大肠包小肠......
 */

import Cookies from "js-cookie";
const TokenKey = "Admin-Token";

export function getToken() {
  return Cookies.get(TokenKey);
}

export function setToken(token: string) {
  return Cookies.set(TokenKey, token);
}

export function removeToken() {
  return Cookies.remove(TokenKey);
}


/**
* 参数处理
* @param {*} params  参数
*/
export function tansParams(params: { [x: string]: any; }) {
  let result = ''
  for (const propName of Object.keys(params)) {
    const value = params[propName];
    const part = encodeURIComponent(propName) + "=";
    if (value !== null && value !== "" && typeof (value) !== "undefined") {
      if (typeof value === 'object') {
        for (const key of Object.keys(value)) {
          if (value[key] !== null && value !== "" && typeof (value[key]) !== 'undefined') {
            const params = propName + '[' + key + ']';
            const subPart = encodeURIComponent(params) + "=";
            result += subPart + encodeURIComponent(value[key]) + "&";
          }
        }
      } else {
        result += part + encodeURIComponent(value) + "&";
      }
    }
  }
  return result
}

// 验证是否为blob格式
export async function blobValidate(data: { text: () => any; }) {
  try {
    const text = await data.text();
    JSON.parse(text);
    return false;
  } catch (error) {
    return true;
  }
}
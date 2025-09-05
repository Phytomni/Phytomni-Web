/*
 * 组件注释
 * @Author: dingcl-b
 * @Date: 2022-07-04 14:25:19
 * @LastEditors: error: git config user.name & please set dead value or install git
 * @LastEditTime: 2025-05-10 10:48:06
 * @Description:
 * 人生无常！大肠包小肠......
 */
import Cookies from 'js-cookie';

const TokenKey = 'Admin-Token';

const ExpiresInKey = 'Admin-Expires-In';

export function getToken() {
  return Cookies.get(TokenKey);
}

export function setToken(token: string) {
  return Cookies.set(TokenKey, token);
}

export function removeToken() {
  return Cookies.remove(TokenKey);
}

export function getExpiresIn() {
  return Cookies.get(ExpiresInKey) || -1;
}

export function setExpiresIn(time: number) {
  return Cookies.set(ExpiresInKey, time);
}

export function removeExpiresIn() {
  return Cookies.remove(ExpiresInKey);
}

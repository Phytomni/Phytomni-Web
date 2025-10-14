/*
 * 组件注释
 * @Author: wuq-l
 * @Date: 2022-08-18 21:07:25
 * @LastEditors: wuq-l
 * @LastEditTime: 2022-09-01 11:00:05
 * @Description:
 * 人生无常！大肠包小肠......
 */
import { defineStore } from "pinia";

export default defineStore({
  id: "counter",
  state: () => ({
    counter: 0,
  }),
  getters: {
    doubleCount: state => state.counter * 2,
  },
  actions: {
    increment() {
      this.counter++;
    },
  },
});

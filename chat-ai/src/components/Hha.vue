import { ref } from "vue"

import { ref } from "vue"

<!--
 * 组件注释
 * @Author: wuq-l
 * @Date: 2022-08-18 21:23:42
 * @LastEditors: wuq-l
 * @LastEditTime: 2022-09-01 22:40:25
 * @Description: 
 * 人生无常！大肠包小肠......
-->
<template>
  <div>{{msg}}</div>
  <div @click="handleClick">{{msg1}}</div>
</template>

<script setup lang="ts">
import { ref, type Ref } from 'vue'
const props = defineProps({
  msg: Number,
})
let msg = ref(props.msg) 
let msg1 = ref(1) 
setTimeout(() => {
  msg1.value++
}, 1000)
function handleClick() {
   msg1.value++
}
</script>

<style lang="scss" scoped>
</style>
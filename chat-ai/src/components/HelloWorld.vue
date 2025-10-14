 <!--
 * 组件注释
 * @Author: wuq-l
 * @Date: 2022-08-18 21:07:26
 * @LastEditors: wuq-l
 * @LastEditTime: 2022-08-18 22:05:05
 * @Description: 
 * 人生无常！大肠包小肠......
-->
<!-- setup -->
<script lang="ts">
export default {
  props: {
    msg: {
      type: String,
      default: '',
    },
  },
}
</script>

<template>
  <div class="greetings">
    <h1 class="green">{{ msg }}</h1>
    <h3>
      You’ve successfully created a project with
      <a target="_blank" href="https://vitejs.dev/">Vite</a> +
      <a target="_blank" href="https://vuejs.org/">Vue 3</a>. What's next?
    </h3>
  </div>
</template>

<style scoped>
h1 {
  font-weight: 500;
  font-size: 2.6rem;
  top: -10px;
}

h3 {
  font-size: 1.2rem;
}

.greetings h1,
.greetings h3 {
  text-align: center;
}

@media (min-width: 1024px) {
  .greetings h1,
  .greetings h3 {
    text-align: left;
  }
}
</style> -->

<template>
    <div class="ccc">
      <div ref="container" class="mol-container"></div>
    </div>
  </template>
  
  <script setup>
  import { ref, onMounted } from 'vue';
  const props = defineProps({
    pdbName: {
      type: String,
      required: true
    }
  });
  const container = ref(null);
  let viewer = null;
  
  onMounted(() => {
    // 动态加载 3Dmol.js
    const script = document.createElement('script');
    script.src = '/static/js/3Dmol-min.js';
    script.onload = () => {
      // 初始化 viewer
      viewer = window.$3Dmol.createViewer(container.value, {
        backgroundColor: '#ffffff',
        width: 600,
        height: 600
      });
  
      // 加载 PDB 文件
      fetch(`/static/pdb/${props.pdbName}.pdb`)
        .then(response => response.text())
        .then(data => {
          viewer.addModel(data, 'pdb');
          viewer.setStyle({}, { cartoon: { color: 'spectrum' } });
          viewer.zoomTo();
          viewer.render();
          viewer.zoom(1.2, 1000);
        })
        .catch(err => console.error('Failed to load PDB file:', err));
    };
    document.body.appendChild(script);
  });
  </script>
  
  <style scoped>
  .ccc {
    box-sizing: border-box;
    border: 1px solid #cccccc;
    width: 100%;
    height: 600px;
  }
  .mol-container {
    position: relative;
    height: 100%;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
  }
  </style>
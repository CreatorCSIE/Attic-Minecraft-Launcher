<script setup lang="ts">
import { ref } from 'vue';

const ipcResult = ref('未测试');

async function testPing(): Promise<void> {
  if (!window.attic) {
    ipcResult.value = '无 IPC 桥（浏览器直开 vite，未经 Electron 壳）';
    return;
  }
  const res = await window.attic.ping();
  ipcResult.value = res.ok ? `IPC 正常：${res.value}` : `IPC 失败：${res.error}`;
}
</script>

<template>
  <header class="titlebar"></header>
  <main class="content">
    <h1>Attic Launcher</h1>
    <p class="sub">Phase 0 脚手架 · Electron 壳 + Vue 3 UI + IPC 骨架</p>
    <button class="ping" @click="testPing">测试 IPC</button>
    <p class="result">{{ ipcResult }}</p>
  </main>
</template>

<style scoped>
.titlebar {
  height: 36px;
  -webkit-app-region: drag;
}
.content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px 24px;
  text-align: center;
}
h1 {
  margin: 0;
  font-size: 28px;
}
.sub {
  margin: 0;
  opacity: 0.7;
}
.ping {
  margin-top: 16px;
  padding: 8px 24px;
  font-size: 14px;
  cursor: pointer;
  -webkit-app-region: no-drag;
}
.result {
  min-height: 20px;
  font-family: monospace;
  opacity: 0.85;
}
</style>

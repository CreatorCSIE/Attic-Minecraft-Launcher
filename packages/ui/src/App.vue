<script setup lang="ts">
/**
 * 应用壳 —— 顶栏 + 顶部导航（view 切换，零 vue-router）+ 主体 + 缺桥横幅。
 * 启动视图双栏（版本列表 | 启动/控制台），实例/设置各占主区。
 */
import { ref } from 'vue';
import { useI18n } from './i18n';
import { useBridge } from './composables/useBridge';
import TitleBar from './components/TitleBar.vue';
import VersionSelector from './components/VersionSelector.vue';
import LaunchPanel from './components/LaunchPanel.vue';
import ConsolePanel from './components/ConsolePanel.vue';
import InstanceList from './components/InstanceList.vue';
import SettingsPanel from './components/SettingsPanel.vue';

type View = 'launch' | 'instances' | 'settings';
const view = ref<View>('launch');
const { t } = useI18n();
const { hasBridge } = useBridge();

const tabs: { id: View; key: string }[] = [
  { id: 'launch', key: 'nav.launch' },
  { id: 'instances', key: 'nav.instances' },
  { id: 'settings', key: 'nav.settings' },
];
</script>

<template>
  <div class="app">
    <TitleBar />

    <nav class="nav">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="tab"
        :class="{ 'tab--active': view === tab.id }"
        @click="view = tab.id"
      >
        {{ t(tab.key) }}
      </button>
    </nav>

    <div v-if="!hasBridge" class="banner">{{ t('bridge.missing') }}</div>

    <main class="body">
      <div v-if="view === 'launch'" class="launch-grid">
        <aside class="left"><VersionSelector /></aside>
        <div class="right">
          <LaunchPanel />
          <div class="console-wrap"><ConsolePanel /></div>
        </div>
      </div>
      <InstanceList v-else-if="view === 'instances'" />
      <SettingsPanel v-else />
    </main>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--surface);
  color: var(--text-primary);
}
.nav {
  display: flex;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-4);
  background: var(--raised);
  border-bottom: 1px solid var(--border);
  -webkit-app-region: no-drag;
}
.tab {
  padding: var(--space-2) var(--space-4);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: var(--fs-sm);
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.tab:hover {
  background: var(--overlay);
}
.tab--active {
  background: var(--overlay);
  color: var(--text-primary);
}
.banner {
  padding: var(--space-2) var(--space-4);
  background: var(--warn-soft);
  color: var(--warn);
  font-size: var(--fs-sm);
  border-bottom: 1px solid var(--border);
}
.body {
  flex: 1;
  min-height: 0;
}
.launch-grid {
  display: grid;
  grid-template-columns: minmax(280px, 360px) 1fr;
  gap: var(--space-4);
  height: 100%;
  padding: var(--space-4);
}
.left {
  min-height: 0;
  overflow: hidden;
}
.right {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-height: 0;
}
.console-wrap {
  flex: 1;
  min-height: 0;
}
</style>

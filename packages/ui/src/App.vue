<script setup lang="ts">
/**
 * 应用壳 —— 顶栏 + 缺桥横幅 + 左侧窄导航 rail + 主体（ui-design.md §3 布局范式）。
 * 启动视图三栏（rail | 版本列表 | 启动/控制台堆叠），实例/设置为 rail + 居中内容区。
 * view 切换仍是 ref 状态，零 vue-router；图标为内联 lucide 路径（MIT），零新依赖。
 */
import { onMounted, ref } from 'vue';
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

// —— rail 底部作者头像：在线取 GitHub 头像，localStorage 缓存（TTL 7 天），失败回落旧缓存/占位 ——
const CREATOR_GITHUB = 'CreatorCSIE';
const AVATAR_CACHE_KEY = 'attic:creator-avatar:v1';
const AVATAR_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const avatarSrc = ref('');

function readAvatarCache(): { at: number; src: string } | null {
  try {
    const raw = localStorage.getItem(AVATAR_CACHE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { at?: unknown; src?: unknown };
    return typeof v.src === 'string' && typeof v.at === 'number' ? { at: v.at, src: v.src } : null;
  } catch {
    return null;
  }
}

async function loadCreatorAvatar(): Promise<void> {
  const cached = readAvatarCache();
  if (cached && Date.now() - cached.at < AVATAR_TTL_MS) {
    avatarSrc.value = cached.src;
    return;
  }
  try {
    // api.github.com 带 CORS；avatar_url（avatars.githubusercontent.com）同样允许跨域 fetch。
    const user = await fetch(`https://api.github.com/users/${CREATOR_GITHUB}`).then((r) => {
      if (!r.ok) throw new Error(`github api ${r.status}`);
      return r.json();
    });
    const blob = await fetch(`${user.avatar_url}&s=128`).then((r) => {
      if (!r.ok) throw new Error(`avatar ${r.status}`);
      return r.blob();
    });
    const src = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
    localStorage.setItem(AVATAR_CACHE_KEY, JSON.stringify({ at: Date.now(), src }));
    avatarSrc.value = src;
  } catch {
    if (cached) avatarSrc.value = cached.src; // 断网/限流：过期缓存兜底
  }
}

onMounted(() => {
  void loadCreatorAvatar();
});
</script>

<template>
  <div class="app">
    <TitleBar />

    <!-- Tailwind 试点：py-2/px-4/text-sm 经 tailwind.config.ts 映射到 var(--space-2)/var(--space-4)/var(--fs-sm) -->
    <div v-if="!hasBridge" class="banner py-2 px-4 text-sm">{{ t('bridge.missing') }}</div>

    <div class="shell">
      <nav class="rail" :aria-label="t('nav.menu')">
        <button
          class="rail-item"
          :class="{ 'rail-item--active': view === 'launch' }"
          :aria-current="view === 'launch' ? 'page' : undefined"
          :title="t('nav.launch')"
          :aria-label="t('nav.launch')"
          @click="view = 'launch'"
        >
          <!-- lucide: rocket -->
          <svg
            class="rail-icon"
            viewBox="0 0 24 24"
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
            <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
            <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
            <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
          </svg>
        </button>

        <button
          class="rail-item"
          :class="{ 'rail-item--active': view === 'instances' }"
          :aria-current="view === 'instances' ? 'page' : undefined"
          :title="t('nav.instances')"
          :aria-label="t('nav.instances')"
          @click="view = 'instances'"
        >
          <!-- lucide: archive -->
          <svg
            class="rail-icon"
            viewBox="0 0 24 24"
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <rect width="20" height="5" x="2" y="3" rx="2" />
            <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
            <path d="M10 12h4" />
          </svg>
        </button>

        <button
          class="rail-item"
          :class="{ 'rail-item--active': view === 'settings' }"
          :aria-current="view === 'settings' ? 'page' : undefined"
          :title="t('nav.settings')"
          :aria-label="t('nav.settings')"
          @click="view = 'settings'"
        >
          <!-- lucide: settings -->
          <svg
            class="rail-icon"
            viewBox="0 0 24 24"
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path
              d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
            />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>

        <!-- rail 底部作者头像（GitHub 在线获取 + 本地缓存；未就绪时保留圆形占位） -->
        <div class="rail-foot">
          <img
            v-if="avatarSrc"
            class="rail-avatar"
            :src="avatarSrc"
            :alt="`GitHub: ${CREATOR_GITHUB}`"
            :title="`GitHub: ${CREATOR_GITHUB}`"
          />
          <span v-else class="rail-avatar" aria-hidden="true"></span>
        </div>
      </nav>

      <main class="body">
        <div v-if="view === 'launch'" class="launch-grid">
          <aside class="left"><VersionSelector /></aside>
          <div class="right">
            <LaunchPanel />
            <div class="console-wrap"><ConsolePanel /></div>
          </div>
        </div>
        <div v-else class="content">
          <InstanceList v-if="view === 'instances'" />
          <SettingsPanel v-else />
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--surface-1);
  color: var(--text-primary);
}
/* Tailwind 试点：原 padding: var(--space-2) var(--space-4) 与 font-size: var(--fs-sm)
   已替换为模板上的等效工具类 py-2 px-4 text-sm（映射同一组 token）。 */
.banner {
  background: var(--warn-soft);
  color: var(--warn);
  border-bottom: 1px solid var(--border);
}
.shell {
  display: flex;
  flex: 1;
  min-height: 0;
}
/* —— 左侧窄导航（§3 范式；Modrinth 式质感：rail 底=第2级，激活态=overlay 底圆角药丸高亮块包住图标，无竖条，§2） —— */
.rail {
  flex: 0 0 var(--rail-width);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-4) 0;
  background: var(--surface-2);
  border-right: 1px solid var(--border);
  -webkit-app-region: no-drag;
}
.rail-item {
  width: var(--rail-item-size);
  height: var(--rail-item-size);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: var(--radius-pill);
  color: var(--text-secondary);
  transition:
    background-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}
.rail-item:hover:not(:disabled) {
  background-color: var(--surface-3);
}
.rail-item--active {
  background-color: var(--surface-3);
  box-shadow: inset 0 0 0 1px var(--surface-4);
  color: var(--text-primary);
}
.rail-item:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.rail-icon {
  width: var(--rail-icon-size);
  height: var(--rail-icon-size);
}
.rail-foot {
  margin-top: auto;
  display: flex;
  align-items: center;
  justify-content: center;
}
.rail-avatar {
  width: var(--rail-item-size);
  height: var(--rail-item-size);
  border-radius: var(--radius-pill);
  background: var(--surface-3);
  border: 1px solid var(--surface-4);
  object-fit: cover; /* img 态：头像裁正方形铺满圆 */
  display: block;
}
.body {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* —— 实例/设置内容区：max-width 居中（§3 栏宽公式） —— */
.content {
  flex: 1;
  min-height: 0;
  width: 100%;
  max-width: var(--content-max);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
}
/* —— 间距节奏升档（Modrinth 留白范式）：页面外边距 --space-5，卡片间 gap --space-4 —— */
.launch-grid {
  display: grid;
  grid-template-columns: minmax(280px, 360px) 1fr;
  gap: var(--space-4);
  height: 100%;
  padding: var(--space-5);
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

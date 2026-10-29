<script setup lang="ts">
/**
 * 皮肤头头像 —— 在线走 minotar.net（对齐 BlockHelm：LauncherAccount.cs L26），
 * 图片加载失败（断网/限流）时回落**本地默认皮肤脸**——复刻原版 1.19.3+ / HMCL 的 UUID 选型算法：
 * n = floorMod(uuid.hashCode(), 18)，n<9 → slim/<NAMES[n]>，否则 → wide/<NAMES[n-9]>；
 * 9 枚 = alex,ari,efe,kai,makena,noor,steve,sunny,zuri（HMCL TexturesLoader 实拆同款表与次序）。
 * 脸图 = 官方默认皮肤 (8,8) 处 8×8 脸区裁切，内置于 assets/skin-faces/（2026-10-29 用户拍板内置进包，
 * 系「安装包零版权物」戒律的显式豁免——仅这 18 张 8×8 默认皮肤脸，HMCL/各启动器同款做法）。
 * Java UUID.hashCode = (mostSig^leastSig) 高低 32 位互异或折叠——拆成 4 段 32 位直接四次 XOR，无 BigInt。
 * uuid 缺席/非法（如浏览器 demo）→ wide/steve 兜底。
 *
 * 尺寸策略（用户拍板修复像素拉伸）：**恒 8px 原始脸**，放大交给 CSS `image-rendering: pixelated`（最近邻）。
 * 根因：minotar 服务端缩放非整数倍（如 28/8=3.5）产出双线性糊图——糊在源图上救不回。8px 源 + 本地最近邻 = 任意槽位都锐利。
 * 缓存共享：同用户名全站唯一 URL → 启动页 AccountHero(56)/账户列表(28)/详情(64) 三实例经浏览器 HTTP 缓存只取一次。
 */
import { computed, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{ username?: string; uuid?: string; size?: number; rounded?: string }>(),
  { username: 'Steve', uuid: '', size: 48, rounded: 'var(--radius-sm)' },
);

const failed = ref(false);

const src = computed(
  () => `https://minotar.net/avatar/${encodeURIComponent(props.username || 'Steve')}/8.png`,
);

// —— 断网回落：原版 UUID 默认皮肤算法 + 内置脸图 ——
const NAMES = ['alex', 'ari', 'efe', 'kai', 'makena', 'noor', 'steve', 'sunny', 'zuri'] as const;

const faceUrls = import.meta.glob('../assets/skin-faces/*/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** Java UUID.hashCode：(most^least) 折叠 32 位 = 四段 32 位 XOR（有符号）。非法输入回 null。 */
function javaUuidHashCode(uuid: string): number | null {
  const h = uuid.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(h)) return null;
  const mHi = parseInt(h.slice(0, 8), 16);
  const mLo = parseInt(h.slice(8, 16), 16);
  const lHi = parseInt(h.slice(16, 24), 16);
  const lLo = parseInt(h.slice(24, 32), 16);
  return (mHi ^ lHi ^ mLo ^ lLo) | 0;
}

const fallbackSrc = computed(() => {
  const hash = javaUuidHashCode(props.uuid);
  if (hash === null) return faceUrls['../assets/skin-faces/wide/steve.png'];
  const n = ((hash % 18) + 18) % 18;
  const name = NAMES[n < 9 ? n : n - 9];
  return faceUrls[`../assets/skin-faces/${n < 9 ? 'slim' : 'wide'}/${name}.png`];
});

watch(
  () => [props.username, props.uuid, props.size],
  () => {
    failed.value = false;
  },
);
</script>

<template>
  <span class="avatar" :style="{ width: size + 'px', height: size + 'px', borderRadius: rounded }">
    <img
      v-if="!failed"
      class="face"
      :src="src"
      :width="size"
      :height="size"
      :alt="username"
      loading="lazy"
      @error="failed = true"
    />
    <img v-else class="face" :src="fallbackSrc" :width="size" :height="size" :alt="username" aria-hidden="true" />
  </span>
</template>

<style scoped>
.avatar {
  display: inline-block;
  overflow: hidden;
  background: var(--surface-3);
  flex: 0 0 auto;
}
.face {
  display: block;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
}
</style>

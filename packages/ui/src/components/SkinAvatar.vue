<script setup lang="ts">
/**
 * 皮肤头头像 —— 三级优先：
 * ① 官方皮肤（微软账户登录/刷新时随 profile textures 落盘的 skinUrl，textures.minecraft.net
 *    公开直链）→ CSS background 裁 (8,8) 处 8×8 脸区（64px 贴图 800% 缩放，脸偏移 = -size px）；
 * ② minotar.net 用户名头像（对齐 BlockHelm：LauncherAccount.cs L26；离线账户/旧账户无 skinUrl 时）；
 * ③ 内置默认脸回落（复刻原版 1.19.3+ / HMCL 的 UUID 选型算法：n = floorMod(uuid.hashCode(), 18)，
 *    n<9 → slim/<NAMES[n]>，否则 → wide/<NAMES[n-9]>；9 枚 = alex,ari,efe,kai,makena,noor,steve,sunny,zuri）。
 *    slim/wide 脸区字节级相同（模型差异只在手臂宽度，对脸无影响，2026-10-31 用户指正）→
 *    实际只内置 9 张脸，slim/wide 归并到 NAMES[n % 9]。
 * 脸图 = 官方默认皮肤 (8,8) 处 8×8 脸区裁切，内置于 assets/skin-faces/（2026-10-29 用户拍板内置进包，
 * 系「安装包零版权物」戒律的显式豁免——仅这 9 张 8×8 默认皮肤脸，HMCL/各启动器同款做法）。
 * Java UUID.hashCode = (mostSig^leastSig) 高低 32 位互异或折叠——拆成 4 段 32 位直接四次 XOR，无 BigInt。
 * uuid 缺席/非法（如浏览器 demo）→ steve 兜底。
 *
 * 尺寸策略（用户拍板修复像素拉伸）：**源图恒 8px 脸**，放大交给 CSS `image-rendering: pixelated`（最近邻）。
 * 根因：minotar 服务端缩放非整数倍（如 28/8=3.5）产出双线性糊图——糊在源图上救不回。8px 源 + 本地最近邻 = 任意槽位都锐利。
 * 缓存共享：同用户名全站唯一 URL → 启动页 AccountHero(56)/账户列表(28)/详情(64) 三实例经浏览器 HTTP 缓存只取一次。
 */
import { computed, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{ username?: string; uuid?: string; skinUrl?: string; size?: number; rounded?: string }>(),
  { username: 'Steve', uuid: '', skinUrl: '', size: 48, rounded: 'var(--radius-sm)' },
);

// 每级失败逐级降级：officialFailed（skinUrl 图挂）/ minotarFailed（②挂→进③）。
const officialFailed = ref(false);
const minotarFailed = ref(false);

/** ① 官方皮肤脸：整张 64×64 贴图放大 8 倍后偏移裁 (8,8) 处 8×8 脸区
 * （img 元素而非 background——@error 事件可用，加载失败能落②③级）。 */
const officialStyle = computed(() => ({
  width: `${props.size * 8}px`,
  height: `${props.size * 8}px`,
  left: `-${props.size}px`,
  top: `-${props.size}px`,
}));

const minotarSrc = computed(
  () => `https://minotar.net/avatar/${encodeURIComponent(props.username || 'Steve')}/8.png`,
);

// —— ③ 断网回落：原版 UUID 默认皮肤算法 + 内置脸图 ——
const NAMES = ['alex', 'ari', 'efe', 'kai', 'makena', 'noor', 'steve', 'sunny', 'zuri'] as const;

const faceUrls = import.meta.glob('../assets/skin-faces/*.png', {
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
  if (hash === null) return faceUrls['../assets/skin-faces/steve.png'];
  // 原版 18 槽（slim 9 + wide 9）脸区归并 = NAMES[n % 9]。
  const n = ((hash % 18) + 18) % 18;
  return faceUrls[`../assets/skin-faces/${NAMES[n % 9]}.png`];
});

watch(
  () => [props.username, props.uuid, props.skinUrl, props.size],
  () => {
    officialFailed.value = false;
    minotarFailed.value = false;
  },
);
</script>

<template>
  <span class="avatar" :style="{ width: size + 'px', height: size + 'px', borderRadius: rounded }">
    <img
      v-if="skinUrl && !officialFailed"
      class="face face-crop"
      :src="skinUrl"
      :style="officialStyle"
      :alt="username"
      loading="lazy"
      @error="officialFailed = true"
    />
    <img
      v-else-if="!minotarFailed"
      class="face"
      :src="minotarSrc"
      :width="size"
      :height="size"
      :alt="username"
      loading="lazy"
      @error="minotarFailed = true"
    />
    <img v-else class="face" :src="fallbackSrc" :width="size" :height="size" :alt="username" aria-hidden="true" />
  </span>
</template>

<style scoped>
.avatar {
  position: relative;
  display: inline-block;
  overflow: hidden;
  background: var(--surface-3);
  flex: 0 0 auto;
}
/* 官方皮肤裁切：绝对定位偏移出脸区（容器 overflow:hidden 裁边）。 */
.face-crop {
  position: absolute;
}
.face {
  display: block;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
}
</style>

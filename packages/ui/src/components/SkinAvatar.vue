<script setup lang="ts">
/**
 * 皮肤头头像 —— 走 minotar.net 在线头像（对齐 BlockHelm：LauncherAccount.cs L26 / HomePageViewModel.cs L158），
 * 未知用户名由 minotar 自动回落 Steve 脸。图片加载失败时回落到本地 canvas 绘制的 Steve 脸（断网兜底，不阻塞布局）。
 *
 * 尺寸策略（用户拍板修复像素拉伸）：**恒请求 8px 原始脸**，放大交给 CSS `image-rendering: pixelated`（最近邻）。
 * 根因：`/avatar/{name}/{size}.png` 是 minotar 服务端缩放，非整数倍（如 28/8=3.5）产出双线性糊图——
 * 糊在源图上，浏览器端 pixelated 救不回；整数倍（64/8=8）才清晰。8px 源 + 本地最近邻 = 任意槽位都锐利。
 * 缓存共享：同用户名全站唯一 URL → 启动页 AccountHero(56)/账户列表(28)/详情(64) 三实例经浏览器
 * HTTP 缓存只取一次（防多次获取）。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{ username?: string; size?: number; rounded?: string }>(),
  { username: 'Steve', size: 48, rounded: 'var(--radius-sm)' },
);

const failed = ref(false);
const canvas = ref<HTMLCanvasElement | null>(null);

const src = computed(
  () => `https://minotar.net/avatar/${encodeURIComponent(props.username || 'Steve')}/8.png`,
);

// —— 断网回落：8×8 Steve 脸 canvas 放大（与 minotar 像素风一致） ——
const PALETTE: Record<string, string> = {
  h: '#4a3b2a',
  s: '#b58863',
  n: '#9c7350',
  w: '#ffffff',
  b: '#4a4a8a',
  m: '#6e4f34',
};
const FACE = ['hhhhhhhh', 'hhhhhhhh', 'hssssssh', 'swbssbws', 'ssnnnsss', 'ssssssss', 'smssssms', 'ssmmmmss'];

function drawSteveFallback(): void {
  const el = canvas.value;
  const ctx = el?.getContext('2d');
  if (!el || !ctx) return;
  const px = el.width / 8;
  ctx.clearRect(0, 0, el.width, el.height);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      ctx.fillStyle = PALETTE[FACE[y]?.[x] ?? 's'] ?? '#b58863';
      ctx.fillRect(Math.round(x * px), Math.round(y * px), Math.ceil(px), Math.ceil(px));
    }
  }
}

watch(
  () => [props.username, props.size],
  () => {
    failed.value = false;
  },
);
onMounted(() => {
  if (failed.value) drawSteveFallback();
});
watch(failed, async (v) => {
  if (v) {
    await nextTick(); // 等 v-else canvas 上屏再绘制
    drawSteveFallback();
  }
});
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
    <canvas v-else ref="canvas" class="face" :width="size" :height="size" aria-hidden="true"></canvas>
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

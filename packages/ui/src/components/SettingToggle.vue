<script setup lang="ts">
/**
 * 设置页开关行 —— InstanceList addons 开关同款配方（36×20 iOS 式，accent 激活）。
 * 左 = 标题（可带徽标）+ 描述，右 = 开关；行分隔线由父容器首末修边规则处理。
 */
defineProps<{
  modelValue: boolean;
  label: string;
  desc?: string;
  /** 「即将推出」徽标文案（给则显示且应配 disabled=true，占位项语义）。 */
  soon?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();
</script>

<template>
  <div class="toggle-row">
    <div class="toggle-info">
      <span class="toggle-name">
        {{ label }}
        <span v-if="soon" class="soon">{{ soon }}</span>
      </span>
      <p v-if="desc" class="toggle-desc">{{ desc }}</p>
    </div>
    <label class="switch">
      <input
        type="checkbox"
        :checked="modelValue"
        :disabled="disabled"
        @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
      />
      <span class="track"></span>
    </label>
  </div>
</template>

<style scoped>
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--border);
}
.toggle-row:first-child {
  padding-top: 0;
}
.toggle-row:last-child {
  padding-bottom: 0;
  border-bottom: none;
}
.toggle-info {
  min-width: 0;
}
.toggle-name {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-weight: 600;
  color: var(--text-primary);
}
.soon {
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
}
.toggle-desc {
  margin: 2px 0 0;
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
/* iOS 式开关：checkbox 透明覆盖，track/thumb 纯 CSS（与 InstanceList 同步配方） */
.switch {
  position: relative;
  flex-shrink: 0;
  cursor: pointer;
}
.switch input {
  position: absolute;
  inset: 0;
  width: 36px;
  height: 20px;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.switch input:disabled {
  cursor: default;
}
.track {
  position: relative;
  display: block;
  width: 36px;
  height: 20px;
  background: var(--border);
  border-radius: var(--radius-pill);
  transition: background 0.15s ease;
  pointer-events: none;
}
.track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: var(--surface-1);
  border-radius: 50%;
  box-shadow: 0 1px 2px rgb(0 0 0 / 25%);
  transition: transform 0.15s ease;
}
.switch input:checked + .track {
  background: var(--accent);
}
.switch input:checked + .track::after {
  transform: translateX(16px);
}
.switch input:disabled + .track {
  opacity: 0.45;
}
</style>

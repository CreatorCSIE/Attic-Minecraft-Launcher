import type { Config } from 'tailwindcss';

/**
 * Tailwind 试验性接入（参考 Modrinth App 栈：Vue3 + Tailwind3.4 + 自研 token）。
 * 纪律（ui-design.md §1/§8）：一切视觉值必须走 tokens.css 的 CSS 变量——
 * 老 WebKitGTK 不认 oklch，Tailwind 默认色板/刻度只做"映射壳"，不直接产色。
 *
 * preflight:false —— base.css 已自带全局 reset（box-sizing/margin 归零/字体继承），
 * 双重 reset 会打架（如 preflight 的 a{color:inherit} 覆盖 base.css 的 a{color:var(--accent)}、
 * border-width 清零影响现有描边组件）。
 */
export default {
  content: ['./src/**/*.{vue,ts,html}', './index.html'],
  theme: {
    extend: {
      colors: {
        surface: 'var(--surface)',
        raised: 'var(--raised)',
        overlay: 'var(--overlay)',
        border: 'var(--border)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-muted': 'var(--text-muted)',
        accent: 'var(--accent)',
        ok: 'var(--ok)',
        warn: 'var(--warn)',
        danger: 'var(--danger)',
      },
      // 4px 基准刻度（§1）：覆盖默认数值刻度 1–7，工具类直接落 token 变量
      spacing: {
        1: 'var(--space-1)',
        2: 'var(--space-2)',
        3: 'var(--space-3)',
        4: 'var(--space-4)',
        5: 'var(--space-5)',
        6: 'var(--space-6)',
        7: 'var(--space-7)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
      },
      fontSize: {
        xs: 'var(--fs-xs)',
        sm: 'var(--fs-sm)',
        md: 'var(--fs-md)',
        lg: 'var(--fs-lg)',
        xl: 'var(--fs-xl)',
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)',
      },
    },
  },
  corePlugins: {
    preflight: false,
  },
  plugins: [],
} satisfies Config;

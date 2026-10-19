# Attic Launcher — 项目记忆

> 跨会话备忘（不落 plan.md 的待办与约定）。plan.md 仍是开发计划唯一真相，本文件只放零散待办与操作约定。
> **本文件是临时载体：下方 addons 待办办完后，删除本文件。**

## 待办

- [ ] **addons 栏再归类调整**（2026-10-19 记）：实例页 Addons card 的 12 项里，部分条目应移入「基本设置」card（它们更偏基础设置而非 addon 语义）。具体归属清单待用户逐条拍板；预计纯 UI 分组调整——数据层不动（`INSTANCE_ADDONS` 目录、档案 `addons=` 逗号串、`-Dlf.*` 注入链均不变），只改 InstanceList.vue 两 card 的条目分布与 i18n 文案位置。可与设置页重写（plan.md「设置页重写」待办）合并执行。

## 操作约定（沿袭）

- 沟通中文、代码注释中文；验证链 `pnpm -r typecheck; pnpm -r build; pnpm --filter @attic/runtime test`；不 commit（提交归所有者）。
- 浏览器 demo 用 `http://localhost:5173/?demo=1`；demo 无真桥时写侧操作（删除/改名/开关）被 `!hasBridge` 禁用属设计使然，真宿主验证需 electron。

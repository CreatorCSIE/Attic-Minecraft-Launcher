# Attic Minecraft Launcher — 远古 Minecraft 桌面启动器

*Attic Launcher for Minecraft: Java Edition — a lightweight desktop launcher for ancient Minecraft versions.*

> **免责声明**：本项目是独立开发的第三方开源启动器，并非 Minecraft 官方产品，未获 Microsoft、Mojang Studios 或任何第三方平台的赞助、认可或背书。
> *Independently developed third-party open-source launcher. Not an official Minecraft product; not approved or endorsed by Microsoft or Mojang Studios.*

---

**Attic** 专注于 Minecraft 的考古层——Pre-Classic、Classic、Indev、Infdev、Alpha、Beta 直至 b1.8/1.5.2 时代的版本：那些官方启动器不再提供、Betacraft Launcher v1 被其 UI 技术锁死、v2 重写中途停更的领域。

名字取自"阁楼"：家里放旧宝贝的地方，落满灰但都还活着。

## 核心理念：薄执行器（Thin Client）

版本数据与修复能力**不写在客户端里**：

- **数据供给**：Betacraft 版本 API（版本 JSON / 预 patch 资产 / 皮肤与正版验证代理端点）+ 社区归档通道（多源，端点可配置）。
- **修复供给**：[legacyfix](https://github.com/betacraftuk/legacyfix) 标准件——以 `-javaagent` / coremod / mod 三种形态挂载，quirk 矩阵（AMD 云、灰屏、鼠标、Apple Silicon 反色、classic-resize…）全部由它在**游戏进程内**解决。
- **客户端只做五件事**：账户登录（Microsoft / 离线）、版本解析、Java 探测、启动参数拼装（含 legacyfix 挂载决策）、进程生命周期管理。

> 戒律：任何"如果是 c0.0.15a 就……"的念头一律落成数据字段进版本表，不进客户端代码。这是 Betacraft v2 停更教训（功能对齐悬崖）的正面回答。

## 双壳架构（Electron + Tauri）

一份前端，两个宿主壳：

- **`packages/ui`** — 共享 Vue 3 前端（排版、主题、交互全部在此，壳对它透明）。
- **`packages/core-spec`** — IPC 契约唯一真相：类型定义 + 事件 + **双壳共享的契约测试**。
- **`apps/electron`** — Node/TS 宿主。开发参考实现，捆绑 Chromium 换取渲染一致性。
- **`apps/tauri`** — Rust 宿主。分发主力，安装包 3–15MB；渲染按保守 CSS 基线设计（WebKitGTK 版本由发行版决定）。

宿主逻辑允许两份实现（TS / Rust），但**只允许一份契约**——漂移由契约测试拦截。

## 血统

本仓库是 [MCANextGen](../MCANextGen)（已归档）的直接后继。从它继承的资产：

- Java 运行时探测算法（注册表 → 常见目录 → `JAVA_HOME` → `PATH`，逐候选真实 `-XshowSettings` 验证，64 位 Java 8 优先）；
- 离线字节码能力探测（不起 JVM 判定 `resizable` / `supportsFullscreen`，可自动生成 legacyfix/补丁适用表）；
- 远古版本 JVM 参数组与反射补丁的一手实测知识（`dpi_fix`、`15a_server_patch`、Betacraft 代理参数组）；
- 反面结论：**永远不要把游戏窗口嵌进宿主**（焦点、F11、DComp、死锁的全部教训都写在前项目的 plan.md 风险登记里）。

## 仓库结构

```text
Attic-Minecraft-Launcher/
├── apps/
│   ├── electron/        Electron 壳（开发参考实现）
│   └── tauri/           Tauri 壳（分发主力，Rust core）
├── packages/
│   ├── core-spec/       IPC 契约 + 共享类型 + 双壳契约测试
│   ├── ui/              共享 Vue 3 前端
│   └── runtime/         TS 侧启动器核心（供 Electron 壳）
├── docs/                架构决策记录、契约文档、移植笔记、UI 设计守则（ui-design.md）
├── reference/           上游源码克隆（betacraft-launcher / legacyfix，gitignore，不入库）
├── plan.md              分阶段开发计划与风险登记
└── LICENSE              GPL-3.0
```

## 状态

**脚手架阶段**。开发计划、阶段划分与风险登记见 [plan.md](./plan.md)。

## 许可

GPL-3.0。上游参考源码（`reference/` 下的 betacraft-launcher、legacyfix 同为 GPL-3.0）仅作本地研究用途，不随本仓库分发。

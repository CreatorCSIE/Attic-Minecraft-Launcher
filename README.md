# Attic Minecraft Launcher - 远古 Minecraft 桌面启动器 (Legacy Minecraft Desktop Launcher)

`Attic Minecraft Launcher` 是一个**面向 Minecraft 早期历史版本（Pre-Classic、Classic、Indev、Infdev、Alpha、Beta 直至 b1.8 / 1.5.2）的轻量桌面启动器**——那些官方启动器不再提供、Betacraft Launcher v1 被其 UI 技术锁死、v2 重写中途停更的领域。

名字取自"阁楼"：家里放旧宝贝的地方，落满灰但都还活着。

> **免责声明**：本项目是独立开发的第三方开源启动器，并非 Minecraft 官方产品，未获 Microsoft、Mojang Studios 或任何第三方平台的赞助、认可或背书。
> *Independently developed third-party open-source launcher. Not an official Minecraft product; not approved or endorsed by Microsoft or Mojang Studios.*

它的核心理念是**薄执行器（Thin Client）**：版本数据与修复能力不写在客户端里——

```text
数据供给                        修复供给
Betacraft 版本 API              legacyfix javaagent
├── 版本清单 / 版本 JSON         ├── quirk 矩阵（游戏进程内解决）
├── 预 patch 客户端 jar          └── AMD 云 / 灰屏 / 鼠标 / classic-resize…
└── 皮肤与正版验证代理端点
            ↓                            ↓
      Attic 只做五件事：账户 · 版本解析 · Java 探测 · 参数拼装 · 进程生命周期
```

> **戒律**：任何"如果是 c0.0.15a 就……"的念头一律落成数据字段进版本表，不进客户端代码。这是 Betacraft v2 停更教训（功能对齐悬崖）的正面回答。

完整开发计划与架构见 [plan.md](./plan.md)，IPC 契约镜像见 [docs/contract.md](./docs/contract.md)。

---

## 🌟 核心功能特性

- **单一 IPC 契约 + 双壳架构（已可用）**：`packages/core-spec` 是渲染 ↔ 宿主全部通道（14 请求 + 3 事件）的唯一真相，双壳（Electron / Tauri）只允许一份契约、两份实现，漂移由契约测试拦截；`packages/ui` 共享 Vue 3 前端对壳完全透明（浏览器直开自动降级 mock 桥）。
- **Betacraft 数据链路（已可用）**：版本清单（反引号分隔的 4/5 字段行形状）、版本 `.info` → VersionJson（字段集照 v1 `ReleaseJson.java` 逐字核对）、客户端 jar 下载 + sha1 校验、资产索引、legacyfix 从 GitHub Release 自动更新落位。
- **Java 运行时自动探测（已可用，继承自 MCANextGen 算法）**：按**注册表 → 常见安装目录 → `JAVA_HOME` / `JDK_HOME` → `PATH`** 收集候选，逐候选**实测执行** `java -XshowSettings:properties -version` 读取真实版本 / 架构 / `java.home`，**优先 64 位 Java 8**、仅无 64 位时回退 32 位；探测全量报告（候选、拒绝原因、耗时）在设置页可视化。
- **legacyfix 集成与按版本挂载决策（已可用）**：javaagent / coremod / mod 三种形态 + 版本区间过滤（判定失败 fail-open + 诊断）；纯 Applet 容器版本（c0.0.12a 等）自动剔除 classpath 中的 launchwrapper、保持 deawt 开启，修复补丁不再被整体跳过。
- **v1 语义的实例管理（已可用）**：首启自动创建 `default instance`；`gameDir = 数据根/<实例名>`（按实例而非版本派生），同一实例切换版本时存档目录不变、选中版本写回实例；Instance Settings 可编辑集对齐 v1——名字 / 版本 / 游戏目录 / JVM 参数 / 窗口尺寸（默认 **854×480**，而非 legacyfix 兜底的 640×480），实例 JVM 参数紧随全局 `-Xmx` 注入实现按实例覆盖。
- **启动参数拼装（已可用，组序契约化）**：固定 `-Xmx`/`-Xms` → 实例 launchArgs → legacy merge sort → proxyArgs → `-Dlf.proxy.levelServer` → javaagent → extraJvmArgs；Applet 容器 gameArgs 末尾注入 `--width/--height`（v1 Wrapper 面板尺寸语义）；干跑通道（dry-run）返回完整 LaunchConfig 供契约测试与排障共用。
- **进程生命周期与崩溃分类（已可用）**：stdout/stderr 逐行事件流进 UI 控制台；退出自动分类（out-of-memory / gl-init / lwjgl-native / unsatisfied-link / java-missing）；纯 Applet 版本附 Windows 窗口看门狗——游戏窗口关闭即终止后台空转的 Java 进程并触发常规退出事件链。
- **level-server.txt 静默单人修复（已可用）**：legacyfix 的 `legacyfix/level-server.txt` 一旦存在（尤其被设为 `local`）会永久跳过服务器设定对话框；壳侧以 `-Dlf.proxy.levelServer` 系统属性覆盖陈旧 txt（属性优先级高于文件），无需手动删文件即可重选服务器。
- **Electron 壳与开发编排（已可用）**：无边距主窗 + 顶栏拖拽区 + 右上角窗口三键（最小化 / 最大化切换 / 关闭，走 `attic:window:control` 契约通道）；根目录 `pnpm dev` 一条命令完成全链路——串行编译契约/runtime/主进程 → 起 vite（端口复用检测）→ 就绪探测 → 拉起 Electron，关窗自动回收子进程。
- **UI 体系（已可用）**：Modrinth App 组件形态逐字核对迁移（卡片配方、四级 surface 分层、inset 输入质感、状态过渡），全部尺寸/颜色/圆角走语义化 CSS 变量（Tailwind 工具类经映射指向同一组 token）；zh-CN / en 双语 i18n（缺键回落 en）；版本列表按年代分组 + 搜索 + 已安装标记；rail 底部作者头像在线取自 GitHub 并本地缓存（TTL 7 天，断网回落旧缓存）。
- **离线账户与持久化（已可用）**：离线 UUID 确定性生成（version 3 / variant 2 的 MC 离线格式）；设置与实例档案以 Java `.properties` 格式落盘（转义 / 续行 / 非 ASCII `\uXXXX` 全回环测试），数据根三平台解析 + portable 模式。
- **血统**：本仓库是 [MCANextGen](https://github.com/CreatorCSIE/MCANextGen)（已归档）的直接后继，继承其 Java 探测、字节码能力探测与远古版本 JVM 参数知识，并采纳其反面结论——**永远不要把游戏窗口嵌进宿主**。
- **尚未实现**：Microsoft 账户登录（当前离线账户起步）、addons 接入、Tauri 壳（Phase 4）、安装包分发（Phase 5）、levelServer 的设置界面入口（留到控件迭代阶段）。

---

## 💻 运行环境要求

### 1. Java 运行环境（游戏侧必需）

- **推荐：64 位 Java 8（JRE 或 JDK 均可）**，探测逻辑优先命中；**32 位 Java 8** 仅作无 64 位时的回退。
- 探测**不依赖 `PATH` 里第一个 `java` 是谁**：即使系统默认 `java` 已是新版，只要机器上装有 Java 8 就能被找到并选中；也可在设置页手动指定 Java 路径覆盖自动选择。

### 2. 开发环境（构建启动器本体）

- **Node.js ≥ 20（LTS）**
- **pnpm 10**（仓库声明 `packageManager: pnpm@10.34.5`，建议 `corepack enable` 后直接 `pnpm install`）
- 操作系统：Windows / macOS / Linux 均可开发（窗口看门狗等个别逻辑仅 Windows 生效）

---

## 🚀 如何编译与运行

### 1. 从源码构建（开发者）

```bash
# 克隆仓库
git clone https://github.com/CreatorCSIE/Attic-Minecraft-Launcher.git
cd Attic-Minecraft-Launcher

# 安装 workspace 依赖（apps/electron + packages/*）
pnpm install

# 开发一条龙：编译契约/runtime/主进程 → 起 vite(5310) → 拉起 Electron
pnpm dev

# 全仓库构建 / 类型检查 / 测试
pnpm build
pnpm typecheck
pnpm test
```

> **注意**：UI 改动经 vite HMR 即时生效；`runtime` / 主进程改动需重跑 `pnpm dev`（dist 为一次性编译，避免半新半旧的产物不一致）。

### 2. 仓库结构 (Repository Layout)

```text
Attic-Minecraft-Launcher
├── plan.md                 分阶段开发计划与风险登记
├── scripts/dev.mjs         pnpm dev 全链路开发编排
├── docs/                   契约镜像（contract.md）、UI 设计守则（ui-design.md）、移植笔记
├── reference/              上游源码克隆（betacraft-launcher / legacyfix，gitignore，不入库）
├── apps/
│   └── electron/           Electron 壳（开发参考实现）
│       └── src/
│           ├── main.ts     主进程：无边距窗 + IPC 注册 + 事件广播
│           └── preload.ts  contextBridge 暴露 RendererBridge
│   （apps/tauri/ — Rust 壳，Phase 4 计划中）
└── packages/
    ├── core-spec/          IPC 契约唯一真相：类型 + 通道 + 双壳契约测试
    ├── ui/                 共享 Vue 3 前端（对壳透明）
    └── runtime/            TS 启动器核心：数据根 / 下载 / 探测 / 拼装 / 进程
```

### 3. 数据目录

运行时数据落在 `%APPDATA%/.attic`（Windows）/ `~/.attic` 等（`assets/ bin/ launcher/ legacyfix/ versions/` 骨架自动创建；`launcher/instances/` 存实例档案）。仓库根放置 portable 标记时优先使用本地目录。

---

## 🌐 Localization / 国际化与多语言支持

界面内置 zh-CN / en 双语词典（缺键回落 en），欢迎社区补充更多语言的本地化。
*The UI ships with zh-CN / en locales (fallback to en); community translations are welcome.*

---

## ❓ 常见问题排查与解决

### 1. 启动游戏后没有窗口，但进程在跑

纯 Applet 容器版本（c0.0.12a 等）若 classpath 混入 launchwrapper，legacyfix 的全部补丁会被跳过。本启动器已在启动时自动剔除该依赖并保持 deawt 开启；若仍复现，检查是否手动改过实例 JVM 参数。

### 2. 关闭游戏窗口后启动器一直显示"运行中"

Applet 版本关窗不触发 JVM 退出。Windows 下启动器带窗口看门狗自动终止空转进程；若看门狗未生效（如非 Windows 平台），可点【停止】手动回收。

### 3. 进入服务器却静默进了单人

legacyfix 的 `<gameDir>/legacyfix/level-server.txt` 残留（尤其内容为 `local`）会跳过服务器对话框。启动器现以 `-Dlf.proxy.levelServer` 属性覆盖该文件；若需彻底重置，删除该 txt 后下次启动会重新弹设定框。

### 4. IPC 桥无响应 / 一直显示"未检测到 IPC 桥"横幅

Electron 20+ 默认沙箱会让 preload `require` 第三方模块静默失败；主窗口已显式 `sandbox: false`。自行改动壳代码时，先重跑 `pnpm dev` 确认主进程产物与 UI 同为最新（旧 dist + 新 UI 会出现无报错的功能异常）。

### 5. 想改窗口尺寸 / JVM 内存但找不到入口

实例页点击实例卡片进入编辑（v1 Instance Settings 语义）：窗口宽/高仅对 Applet 容器版本生效；JVM 参数（如 `-Xmx2G`）会覆盖全局内存设置。

---

## 📄 许可证与版权声明 (License & Copyright)

- 本项目仅供 Minecraft 历史版本研究、怀旧与技术交流使用。
- 为了防止代码被恶意倒卖、闭源修改或注入恶意软件，本项目源码采用 **[GNU General Public License v3 (GPL v3) 许可证](LICENSE)** 进行强制开源。
  - **Copyright (c) 2026 CreatorCSIE. All rights reserved.**
- **第三方资产与商标免责声明**：
  - 本仓库**不包含、不分发任何官方 Minecraft 游戏 `.jar` 客户端包**；客户端 jar 与资产在首次启动时从 Betacraft 公共端点下载到本地数据目录。
  - `reference/` 下的上游参考源码（betacraft-launcher、legacyfix，同为 GPL-3.0）仅作本地研究用途，不随本仓库分发。
  - 本项目所涉及的 Minecraft 游戏资产、商标与品牌版权均归 **Mojang Studios / Microsoft** 所有。

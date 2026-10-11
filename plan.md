# Attic Minecraft Launcher — Development Plan

> 创库计划。随实测结论同步更新（沿用 MCANextGen 的 plan.md 工作惯例）。
> 状态标记：`[ ]` 未开始 / `[~]` 进行中 / `[x]` 实机验证完成。

## 0. 目标与非目标

**目标**：一个专注远古 Minecraft 版本（Pre-Classic → b1.8/1.5.2）的桌面启动器；一份 Vue 前端 + Electron/Tauri 双壳；Windows 优先，Linux/macOS 保持可用（Tier-2 起步）；GPL-3.0。

**非目标（明确不做，防功能对齐悬崖——Betacraft v2 的死因）**：
- 不在客户端里实现任何版本 quirk 修复 → 全部交给 legacyfix 标准件（`-javaagent` / coremod / mod）。
- 不做现代版本（1.6+）的完整支持：那是 HMCL/Prism/Modrinth App 的饱和赛道。
- 不在 v0/v1 做 mod 仓库、Discord RPC、联机房间：这些是"清单外愿望"，进不了薄客户端。
- **永不把游戏窗口嵌入宿主**（MCANextGen 风险登记 #3/#6 的全部教训：焦点住在 attach 队列、F11 逃逸、DComp 遮挡、三方 AWT 死锁）。游戏开独立顶层窗口。

**戒律（写进代码评审标准）**：
1. 数据驱动：任何 `if (version == "in-20100223")` 式客户端代码 = 评审不通过，改为版本表字段。
2. 契约唯一：双壳（TS/Rust）只共享 `packages/core-spec` 定义的 IPC 契约，契约测试双实现必须同绿。
3. 上游引用不入库：`reference/` 永久 gitignore。
4. 提交一律由项目所有者本人执行。

## 1. Phase 0 — 脚手架

- [x] pnpm workspace：`apps/electron`、`apps/tauri`、`packages/{core-spec,ui,runtime}`
- [x] TS 基座（strict、共享 tsconfig base）、Vue 3 + Vite 进 `packages/ui`
- [x] Electron 最小壳：无边距主窗 + 加载 `packages/ui` 占位页 + IPC 骨架（本地实机验证：窗口标题 "Attic Launcher"，`pnpm -r typecheck` / `pnpm -r build` 全绿）
- [~] CI 静态闸门：`pnpm -r typecheck` + `pnpm -r build`（不含游戏启动，不依赖版权资产）——workflow 已就位（`.github/workflows/ci.yml`），远端首跑待首个 push
- [x] `git init` 已完成（main 分支）；首个 commit 归所有者

> 环境备忘：国内网络下载 electron 二进制需 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`（pnpm 10 需在根 package.json `onlyBuiltDependencies` 放行 electron/esbuild 的 postinstall）。

## 2. Phase 1 — core-spec（契约先行）

- [x] 领域类型：`Account`（MS/离线）、`VersionRef`、`VersionJson`（兼容 Mojang 格式 + Betacraft 扩展字段）、`JavaInstall`、`LaunchConfig`（mainClass/classpath/jvmArgs/gameArgs/**agentMount**）
- [x] `agentMount` 数据模型：`{ form: javaagent|coremod|mod, path, appliesFrom }` —— legacyfix 挂载决策表进版本数据，不进代码
- [x] IPC 通道与事件：launch/kill、stdout/stderr 流、下载进度、Java 探测结果
- [~] 契约测试夹具：同一组 fixture（版本 JSON → 期望 LaunchConfig）由 TS 与 Rust 各自消费断言 —— TS 侧已绿（4 夹具 × 6 不变量，`node --test`），Rust 侧 Phase 4 接入同一 `fixtures/` 目录
- [x] 文档：`docs/contract.md`

### 数据目录布局（Phase 1 补充决策）

根目录改名、内部结构与 Betacraft v1 完全一致（取证自 `BC.java` + `Launcher.java` L256-261 建目录段 + `Wrapper.loadJars` L443-460）：

```text
.attic/                         Win: %APPDATA%\.attic\
                                Linux: ~/.attic/
                                mac: ~/Library/Application Support/attic/（沿 v1 惯例）
                                portable：根 = 可执行文件旁；rootDir 全局可配置
├── launcher/
│   ├── launcher.settings       全局配置（properties，格式兼容 v1）
│   ├── betacraft_wrapper.jar   （v0 不消费——addons 通道顺延，见下；容器用 legacyfix AppletLauncher）
│   ├── legacyfix-*.jar         修复标准件（数据供给面下载，不入库）
│   ├── lang/<lang>.txt         语言文件（v1 格式）
│   ├── addons/<name>.jar       占位目录（机制顺延，v0 不消费）
│   ├── instances/<name>.txt    ★ 实例配置（properties 格式兼容）+ <name>.png 图标
│   └── launch-methods/<meth>.jar
├── bin/
│   ├── *.jar                   跨版本共享库池（LWJGL2 等，整目录上 classpath）
│   └── natives/                natives 解压目录
└── versions/
    ├── <version>.jar           游戏 jar（从配置通道下载）
    └── jsons/<version>.info    版本元数据（每次启动重下）
```

边界注记：
- **addons 机制暂缓（2026-10 决策）**：v1 addons 是 wrapper 进程内 `URLClassLoader` 加载的 hook jar（继承 `Addon` 类 + `applyAfter()` 依赖图），不是启动器侧机制——执行主机只有 wrapper。经对照 legacyfix 补丁矩阵：OfflineDATSave/Demo/ClassicNotPaid/UnlicensedCopy 已被 `LevelProxyPatch`/`DemoPatch`/反盗版 handler 接管；GameModeSwitch/QuitGame/Fullscreen 为上游空缺。故 v0 不做 addon 加载/通道/UI，容器统一 legacyfix；目录占位保留维持结构兼容。wrapper 通道随 addons 一并降级 Phase 6——重启首选路径是给 legacyfix 提补丁（一次 PR 换三个 addon 退役），而非养 wrapper。
- **共存/迁移**：`rootDir` 可配置即天然逃生舱——老用户可直接指回 `.betacraft`；首启"从 .betacraft 导入"是 Phase 3 UI 决策，不在存储层做。
- 游戏 jar / wrapper / legacyfix 全部是**下载的数据构件**，仓库与安装包内零版权物。

## 3. Phase 2 — TS 运行时（Electron 后端）

- [x] Betacraft API 客户端：版本清单、版本 JSON（每次启动重下策略照抄 v2 的已知坑清单）、资产索引；**端点可配置**（风险 #1）。实测（2026-10）：清单 290 版；launch-method 全集 = `preclassic/classic12a/classic/ClassicWithSaving/Classic15aWithSaving/ClassicMpWithSaving/4k/indev/DL_12w18a_19a`——主类由数据表推导，`4k`/`DL_`（超 v0 范围）不映射、拼装器显式报错；**version_list.txt 行序非年代序**（乱序手工清单）
- [x] 存储层：按上文「数据目录布局」实现 `.attic/` 根（三平台路径 + portable + rootDir 可配置）；v1 格式兼容读写 `launcher.settings` / `instances/*.txt`（Java properties 语义完整实现）；`bin/` 库池与 `bin/natives` 进 classpath/参数拼装（addons 仅建目录占位，不做机制）。**库池供给通道**：BC `.info` 无 libraries → 从 Mojang 重发布 JSON 回填（`mojangManifest` 端点）；`*-natives-<os>.jar` 用零依赖 unzip 解到 `bin/natives`（显式 `-Dorg.lwjgl.librarypath` 会短路 LWJGL2 自解压）
- [x] Java 探测：移植 MCANextGen `java-discovery`（四级候选 + 真实 `-XshowSettings` 验证 + 64 位 Java 8 优先）；Win 注册表 / mac `java_home` / linux `/usr/lib/jvm`+alternatives。Win 实机验证：注册表候选 → Oracle 1.8.0_431 x86_64 选中
- [~] 远古 Java 供给通道：Azul Zulu（6/7/8 x64+arm）自动下载 + 手动导入兜底（风险 #7）——代码与解压落位已实现；本机已有 Java 8 未触发自动供给路径，待无 Java 环境实机验证
- [x] 启动参数拼装：JVM 参数组（照抄 MCA/Betacraft 已验证组：代理重定向、渲染修复、`useLegacyMergeSort`、内存上限）+ legacyfix 挂载决策表。agentMount 区间判定按**编译日期升序**（非清单行序）；决策表边界取清单实存 id（`1.4-pre`/`1.5.2`，`1.4`/`1.7.10` 不在清单）
- [x] 进程生命周期：spawn、stdout 解析（崩溃分类器 v0）、kill/退出清理。实机验证：`unsatisfied-link` 分类正确（natives 缺失场景）
- [x] **里程碑 M1**：Electron 壳 IPC 接线完成（九请求通道 + 三事件推送，`pnpm -r typecheck/build/test` 全绿：core-spec 6 + runtime 38）。实机启动验证经 runtime 门面（与壳主进程同一代码路径；UI 启动按钮属 Phase 3）：**c0.0.15a-05311904**（Applet 容器 + legacyfix，世界生成成功）、**2.0-preview**（即计划所写 "c2.0"，BC 清单实名；LF agent + LWJGL2.9.0/OpenAL/纹理动画正常）、**b1.7.3**（LF agent + LaunchWrapper transformer + Display/OpenAL 正常）。三个目标均稳定运行后 SIGTERM 退出。注：classic 联机/验证连 betacraft 代理超时属网络环境因素，游戏本体照常起（离线容错）

## 4. Phase 3 — UI v0

- [ ] **设计守则先行**：[docs/ui-design.md](./docs/ui-design.md)（token 单一真相 / 层级 / 200ms 动效律 / 状态完备性 / Definition of Polish 验收清单进 PR 检查）；动手前截 3 个对标对象提炼可迁移模式
- [ ] 实例列表 + 版本选择器（远古优先的信息架构：年代分层而非字母序）
- [ ] 启动按钮 + 控制台面板（滚动 stdout、崩溃摘要）
- [ ] 设置页：Java 路径、内存、端点、主题（深/浅/系统）
- [ ] i18n 骨架（en/zh 起步；沿用 MCANextGen 的 locale 合并策略与 zh-CN 基准）
- [ ] 保守 CSS 基线文档化（风险 #4）：只用近两代 WebKitGTK 全绿的特性

## 5. Phase 4 — Tauri 壳（Rust core 第二实现）

- [ ] `src-tauri`：core-spec 的 Rust 类型生成/手写对齐
- [ ] Rust 实现：版本解析、Java 探测、参数拼装、进程管理（`std::process` / `tokio`）
- [ ] 契约测试双绿进 CI（TS 跑 Node、Rust 跑 `cargo test`，同一 fixture）
- [ ] **里程碑 M2**：Tauri 壳达到与 Electron 壳相同的游戏可启动面

## 6. Phase 5 — 分发

- [ ] Windows：Tauri NSIS 主发布；Electron 版走 electron-builder 作参考实现
- [ ] Linux：AppImage + 已知问题清单（DMABUF/Wayland 环境变量逃生舱）；Tier-2
- [ ] macOS：ARM 为主（基线 Apple Silicon + 近两版 macOS）；未签名发布 + 右键打开教程；$99 开发者签名作为后置决策（风险 #5）
- [ ] CI 矩阵：三平台仅构建 + 契约测试（不启动游戏）
- [ ] 更新通知：GitHub Releases 轮询（照抄 v2 的做法）
- [ ] README 补免责声明显眼位 + 品牌写法 "Attic Launcher for Minecraft: Java Edition"（风险 #6）

## 7. Phase 6 — 后置（不承诺时间）

- [ ] Android 第三壳调研：共享数据层（版本表/端点），独立 Kotlin 执行壳；参考 FCL 与 Quanta-Craft-Launcher 的 JVM 管线（libjpe/Redcore 路线）——"通道复用"而非"前端复用"
- [ ] 能力探测并入：字节码判定 `resizable`/`supportsFullscreen` 自动填充版本表（MCANextGen 资产，可反哺上游）
- [ ] 与 Betacraft 的协作界面评估（我们做壳、他们做数据/修复的分工是否可正式化）
- [ ] addons 重启路径（若需求真实存在）：优先给 legacyfix 提 GameModeSwitch/QuitGame/Fullscreen 补丁（上游空缺清单已盘点，见数据目录布局注记），而非恢复 wrapper 通道；仅当 addons 生态无法补丁化时才评估 wrapper container 字段

## 8. 风险登记

1. **betacraft.uk 基础设施单点**：proxy/皮肤/资产端点不在我们手里。缓解：端点全配置化、版本表离线缓存优先、归档通道多源。
2. **双壳漂移**：两份宿主实现必然诱惑分叉。缓解：契约测试进 CI 闸门；核心保持薄（重活在数据与 legacyfix，漂移面才小）。
3. **功能对齐悬崖（v2 死因复发）**：任何"把 v1 特性清单抄进 backlog"的冲动。缓解：非目标清单即宪法，超出 Phase 0–5 的一律进 Phase 6 愿望池。
4. **Linux 渲染碎片化**：WebKitGTK 版本由发行版决定。缓解：保守 CSS 基线 + Tier-2 支持定位 + 文档化逃生舱；NixOS 类问题交给社区。
5. **macOS 无实机**：CI ARM runner（构建/冒烟/截图）+ 按小时云 Mac（发版抽查）+ 社区 beta 志愿者；游戏侧 mac quirk（反色/鼠标）由 legacyfix 承担。
6. **商标合规**：产品名用 "Attic Launcher"，"for Minecraft: Java Edition" 仅作描述；显眼免责声明（BlockHelm 模板）；不暗示官方背书。
7. **远古 Java 可得性**：现代系统不发 JRE 6/7/8。缓解：Zulu 归档通道自动拉取 + 手动导入 + 探测失败面板给全候选与原因（MCANextGen 面板范式）。
8. **LWJGL2 native 在现代系统**（声音/GL/32 位库）：属游戏侧问题，优先 legacyfix 补丁覆盖，其次 per-build 已知问题文档，最后才考虑客户端 workaround。

## 9. 参考（本地克隆于 `reference/`，不入库）

- `reference/betacraft-launcher`（v1，Java/Swing；分支 `v2` = C++/Qt 停更重写——其 commit 历史是 API 集成坑的免费地图：token 刷新、version json 重下策略、Linux 声音/工作目录、assets 位置）
- `reference/legacyfix`（v3，javaagent/coremod/mod 三形态；补丁清单即 quirk 矩阵）
- 外部：MCANextGen（../MCANextGen，已归档——java-discovery/能力探测/JVM 参数组/嵌入反面教材）；FCL、Quanta-Craft-Launcher（Android JVM 管线参考）

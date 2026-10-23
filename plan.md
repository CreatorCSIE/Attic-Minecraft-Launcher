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

- [x] Betacraft API 客户端：版本清单、版本 JSON（每次启动重下策略照抄 v2 的已知坑清单）、资产索引；**端点可配置**（风险 #1）。实测（2026-10）：清单 290 版；launch-method 全集 = `preclassic/classic12a/classic/ClassicWithSaving/Classic15aWithSaving/ClassicMpWithSaving/4k/indev/DL_12w18a_19a`——主类由数据表推导，`DL_`（超 v0 范围）不映射、拼装器显式报错（`4k` 后经 AppletLauncher + `--appletClass M` 通道落实映射）；**version_list.txt 行序非年代序**（乱序手工清单）
- [x] 存储层：按上文「数据目录布局」实现 `.attic/` 根（三平台路径 + portable + rootDir 可配置）；v1 格式兼容读写 `launcher.settings` / `instances/*.txt`（Java properties 语义完整实现）；`bin/` 库池与 `bin/natives` 进 classpath/参数拼装（addons 仅建目录占位，不做机制）。**库池供给通道**：BC `.info` 无 libraries → 从 Mojang 重发布 JSON 回填（`mojangManifest` 端点）；`*-natives-<os>.jar` 用零依赖 unzip 解到 `bin/natives`（显式 `-Dorg.lwjgl.librarypath` 会短路 LWJGL2 自解压）
- [x] Java 探测：移植 MCANextGen `java-discovery`（四级候选 + 真实 `-XshowSettings` 验证 + 64 位 Java 8 优先）；Win 注册表 / mac `java_home` / linux `/usr/lib/jvm`+alternatives。Win 实机验证：注册表候选 → Oracle 1.8.0_431 x86_64 选中
- [~] 远古 Java 供给通道：Azul Zulu（6/7/8 x64+arm）自动下载 + 手动导入兜底（风险 #7）——代码与解压落位已实现；本机已有 Java 8 未触发自动供给路径，待无 Java 环境实机验证
- [x] 启动参数拼装：JVM 参数组（照抄 MCA/Betacraft 已验证组：代理重定向、渲染修复、`useLegacyMergeSort`、内存上限）+ legacyfix 挂载决策表。agentMount 区间判定按**编译日期升序**（非清单行序）；决策表边界取清单实存 id（`1.4-pre`/`1.5.2`，`1.4`/`1.7.10` 不在清单）
- [x] 进程生命周期：spawn、stdout 解析（崩溃分类器 v0）、kill/退出清理。实机验证：`unsatisfied-link` 分类正确（natives 缺失场景）
- [x] **里程碑 M1**：Electron 壳 IPC 接线完成（九请求通道 + 三事件推送，`pnpm -r typecheck/build/test` 全绿：core-spec 6 + runtime 38）。实机启动验证经 runtime 门面（与壳主进程同一代码路径；UI 启动按钮属 Phase 3）：**c0.0.15a-05311904**（Applet 容器 + legacyfix，世界生成成功）、**2.0-preview**（即计划所写 "c2.0"，BC 清单实名；LF agent + LWJGL2.9.0/OpenAL/纹理动画正常）、**b1.7.3**（LF agent + LaunchWrapper transformer + Display/OpenAL 正常）。三个目标均稳定运行后 SIGTERM 退出。注：classic 联机/验证连 betacraft 代理超时属网络环境因素，游戏本体照常起（离线容错）

## 4. Phase 3 — UI v0

- [x] **设计守则先行**：[docs/ui-design.md](./docs/ui-design.md)（token 单一真相 / 层级 / 200ms 动效律 / 状态完备性 / Definition of Polish 验收清单进 PR 检查）；对标范式已沉淀进守则 §3/§9（Prism/HMCL/Raycast 双栏 + 左导航骨架）
- [x] 实例列表 + 版本选择器（远古优先的信息架构：年代分层而非字母序，组内按编译/发布日期升序，era 色码 chip，搜索 + 已安装标记）
- [x] 启动按钮 + 控制台面板（每屏唯一 accent 实心 Play；stdout/stderr 环形缓冲滚动 + 崩溃摘要卡 + 下载进度 MB/s）
- [x] 设置页：Java 路径（含探测全候选面板，风险 #7）、内存、端点（下次启动生效）、主题（深/浅/系统，即时应用）
- [x] i18n 骨架（en 为 base/fallback、zh-CN 默认基准，手写深合并 + 点路径 t()，locale 持久化 localStorage）
- [x] 保守 CSS 基线落地（风险 #4）：[styles/base.css](./packages/ui/src/styles/base.css) + [tokens.css](./packages/ui/src/styles/tokens.css)，规避 color-mix/无降级 backdrop-filter，五态 focus ring + 自定义滚动条 + prefers-reduced-motion

> v0 决策：零新依赖——不引入 Tailwind/shadcn/vue-router/路由库/i18n 库；纯 CSS token + 响应式 view 切视图 + 手写 i18n；缺桥降级（`window.attic` 不存在时 useBridge 返回 mock，UI 走空状态不崩）。闸门 `pnpm -r typecheck/build/test` 三绿；浏览器验证缺桥降级三视图 + 主题切换通过、控制台无报错。

> **UI 迭代候选（BlockHelm 参考，已逐字核对源码，暂缓不落实）**：
> - **版本列表可伸缩侧栏 + 图钉**：BlockHelm 把游戏列表做成浮于主页的覆盖面板（`HomeLaunchGameListView`，Panel.ZIndex=4），折叠用附加行为 `AnimatedCollapse`（高度+外边距+透明度组合动画，Behaviors/Animation/AnimatedCollapse.cs L120-139）；图钉语义 = `IsLaunchMenuPinned`（ToggleButton+VM 命令，pin 图标 ForceFill 绑状态）——**钉住=常驻展开且主内容让位（FallbackPinnedContentGap=24），未钉=失焦自动收起**。对应到 Attic：LaunchView 版本列表改可折叠侧栏，折叠动画走既有 200ms 动效律（grid-template-rows/max-height + opacity），pin 态持久化进 AppSettings。
> - **主页简洁化**：hero 背景 + 启动面板 + 浮层游戏列表的三段式（HomePageView.xaml L25-36），可作为 LaunchView 布局演进方向。
> - **强调色（accent）面板（BlockHelm 主题体系已深挖核对）**：选项全集=主题 Dark/Light+跟随系统开关（Attic 已有三态即时切换）、**8 个强调色** Blue/Cyan/Green/Emerald/Purple/Pink/Orange/Amber（ThemeSettingsViewModel.cs L43-64）、背景效果 None/Acrylic/Image+不透明度+模糊开关（**Acrylic/模糊排除**，违反保守 CSS 基线）。**Image 背景已定案（用户决策：内置默认+保留外置替换）**：内置一张品牌背景（自有资产入 `packages/ui`，随打包分发）；AppSettings 增 `backgroundImage?` 绝对路径——空=内置默认，设置页可浏览选择/清除回落；叠加一档固定暗色遮罩保证可读性（不照抄其 OpacityPercent 全量旋钮）；与主页 hero 三段式候选同题，落实时合并设计。核心可迁配方=**正交分层**：ThemeResourceLayerManager 用"基础主题层 Dark/Light + Accents/{color}.xaml 覆盖层"两独立层解 8×2 组合（非 16 套全组合，ThemeResourceLayerManager.cs L49-81）——对应 CSS 即 `[data-theme]` 与 `[data-accent]` 属性选择器块各管一组变量，accent 层只覆写 `--accent/--accent-hover/--accent-ink` 三变量；持久化对齐其字段名（Theme/AccentColor/ThemeFollowSystem，LauncherSettings.cs L28-40），AppSettings 增 `accentColor` 即契约小改（无新通道）。跟随系统其机理=注册表 `AppsUseLightTheme`+UserPreferenceChanged 事件（ThemeService.cs L191-244），Electron 侧对应 `nativeTheme.on('updated')`（已具备）。
> - **账号页（BlockHelm 账号界面配方，已核对源码；微软登录与 3D 皮肤预览明确不做）**【已落实 2026-10，形态微调：添加账户=类型选择两步弹窗（正版/第三方占位禁用）；删除=列表项 hover 垃圾桶直删；详情区仅 UUID 节+复制+重命名（皮肤节按用户指示不做）；首启无默认 Player，账户恒可空、空列表禁用 Play】：骨架=左账户卡片列表 + 右详情区（SecondaryMenuFrame 范式，AccountPageView.xaml L28-53）；列表项=皮肤头像（SkinFrontPreviewControl 正面渲染，离线账户回落默认 Steve）+ 显示名 + 类型徽章（离线）+ 详情/编辑/删除；底部"+ 添加账户"仅弹离线账户对话框（用户名校验照 AccountNameValidator 的 MC 规则 3-16 字符）；删除走确认对话框（DeleteAccountDialog 范式）。**前置是契约扩展而非纯 UI**：现 AppSettings 仅单一离线 username，多账户需新增 AccountView 类型 + accounts 通道（list/add/remove/select）+ 持久化（账号档案 properties/JSON）+ LaunchRequest 携带所选账户——落实时按戒律四处同步（ipc.ts/contract.md/双壳/UI）。
> - **账户 + 上次启动版本（含所在实例）恢复缓存（Betacraft v1 机理已核实，暂缓实现）**：
>   - **v1 做法（源码取证，非三层合一而是分治）**：① 当前账户 = `launcher/accounts.json`（`Accounts{accounts[], current=local_uuid}`，Gson 序列化；启动 `Util.readAccounts()` 按 `current` 恢复 `Launcher.auth`，找不到回落首个并回写 current；切换/登录/退出时 `saveAccounts()` 落盘）；② 上次实例 = `launcher/launcher.settings` 的 `lastInstance=<实例名>`（自定义 PropertyFile `key:value` 行格式；`Launcher.setInstance()` 即 `setProperty("lastInstance",…) + flushToDisk()`——切实例、实例设置保存都触发）；③ **上次版本不全局存——版本是实例的字段**：`launcher/instances/<name>.txt` 的 `version=`（`SelectVersion.saveVersion()` → `currentInstance.version=…; setInstance(); currentInstance.saveInstance()`）。启动恢复序（Launcher.java L275-282）：settings 缺失或 lastInstance 空 → 新建 "default instance"；否则 `loadInstance(lastInstance)`，读取失败按同名 `newInstance` 重建。
>   - **Attic 对应方案**：现"当前账户"选中在渲染侧 localStorage（`attic:account:current`），落实时迁宿主侧——`accounts.json` 结构从裸数组升级为 `{accounts[], current}`（v1 同款语义，双壳共享、Electron/Tauri 一致）；`launcher.settings` 增 `lastInstance` 键（走既有 SETTINGS_GET/SET 通道，AppSettings 视图加字段）；版本继续随实例（`InstanceConfig.version` 已有，与 v1 语义天然一致）。启动/主页恢复序 = lastInstance → 该实例 version → 选中账户；`useSelection` 与实例切换联动。改动面：storage.ts 读写结构 + core-spec AppSettings/账户存储类型 + contract.md + 双壳镜像 + UI 接线 + runtime 测试（current 回落首个、lastInstance 缺失建 default instance 两条语义进夹具）。
> - **自定义版本配置页（已落实 2026-10-18）**：编辑 custom 版本 `.info` 元数据的双栏页（排版镜像账户页；Betacraft 官方版本不落入）。左栏 = 搜索框 + 「导入 jar」按钮 + custom 版本列表（裸 jar=未配置徽标 / `.info` custom=true=已配置徽标）；右栏 = info 编辑表单（launch-method 下拉——合法键集由契约随数据下发 `launchMethods[]`，UI 零硬编码；main-class / minecraft-arguments / assets / type / url / sha1 / proxy-args 等字段文本输入）。契约新增四通道：`CUSTOM_LIST` / `CUSTOM_GET_INFO` / `CUSTOM_SAVE_INFO` / `CUSTOM_IMPORT_JAR`（导入=主进程原生文件对话框，复制为 `versions/<id>.jar`，同名 jar 报错不覆盖，落裸 jar=未配置态）；保存强制写 `custom=true`、`launch-method` 必填（其余字段选填，留空落盘为 `key=` 空值段）、非法 launch-method（主类表无映射且未显式给 main-class）显式报错；未配置裸 jar 的 get 返回 `detectLaunchMethod` 建议值供预填。
> - **全局设置升级 + 实例继承开关（BlockHelm Global Settings 参考，设计已定案待落实）**：现有设置页升级为完整全局参数组（内存/GC/并行度/额外 JVM 参数 + 全局默认窗口尺寸 + 全局默认 Java + 多账号默认项）。冲突解法=**组级继承**：实例增 `inheritsGlobal` 布尔（UI 为"实例独立设置"复选框，默认勾选=跟随全局）；未开独立则实例的 launchArgs/width/height/javaPath **整组不生效**（替换现有字段级回落），开则整组生效。注意：v1 实例永远全独立（全局仅作建档默认），此开关是超越 v1 的可用性增强，落实前需用户确认；属契约级改动——buildContext 覆盖序从字段级改组级，contract.md §2.6 组序重写，四处同步 + 测试。
> - **关于页 + 语言（必落实，BlockHelm/MCDArchive 双源核对）**〔2026-10-19：并入下方「设置页重写」正式待办，本条调研作为输入〕：
>   - 关于页结构取 MCDArchive（项目名/版本标识/版权/GPL-3.0/主页/反馈链接，MainWindow.axaml L154-220）+ 环境信息取 MCANextGen 前身模式（构建注入 `__HOST_VERSION__` + `HOST_GET_INFO` 返回 hostVersion/platform/arch/Electron/Node/Chrome）；检查更新按钮取 BlockHelm（InfoSettingsView.xaml L50-68 + `CheckForUpdatesAsync(版本, 更新频道)`，即 Phase 5 既定的 GitHub Releases 轮询，可前置到本页先做"检测+提示"，下载自更新留 Phase 5）。契约需新增 HOST_INFO / CHECK_UPDATE 通道（四处同步）。
>   - 语言：Attic i18n 骨架已具备（zh-CN/en 深合并 + localStorage + 即时生效），**只差设置页语言下拉**；扩展路线采 MCDArchive 的 `lang/*.json` 外置自动发现（扫目录读 `_LanguageName` 构造选项，缺失回落内置 en）而非 BlockHelm 的编译期 resx+重启生效（MCDArchive 即时切换体验优于重启提示）；社区翻译即"丢一个 JSON 进 lang/"。
> - **设置页其它候选控件**（BlockHelm 分组 General/Download/Language/LaunchMemory/Java/Theme/Info/Feedback 中筛）：主题页"跟随系统开关+强调色下拉"（ThemeSettingsView.xaml L38-73，与 token 体系契合，并入 accent 色候选）；打开/导出日志、重置窗口大小类小控件（低成本高价值）；快捷键页（全局热键）与下载通道页暂缓——前者非 v1 语义、后者端点设置已有。
> - **不适用项**（明示排除）：BackdropBlur 刷新协调器违反保守 CSS 基线（风险 #4 规避无降级 backdrop-filter）；SkinCarousel3DControl（3D 皮肤轮播）依赖 WebGL，进 Phase 6 愿望池；游戏分辨率/全屏/缩放（a1.0.4+ 主类自管，Applet 容器无此能力）；模组/存档/服务器管理等页面（非目标清单）。

### 设置页重写（BlockHelm 逐分区调研定稿 2026-10-19，**已落实 2026-10-20**）

> 调研输入：`reference/BlockHelm-Launcher` 设置页全量源码核对（分区框架/通用/语言/启动内存/Java/主题/关于/反馈）+ Attic 现状盘点。用户拍板的移植范围已在各节标注（必须/部分/占位）。文末 4 个待决策点已全部拍板（见该节定稿）。下列条目按实际落地形态定稿。

**框架**
- [x] 单页流（SettingsPanel.vue 一滚到底）→ **左栏分区导航 + 右侧内容区**（分区：通用 / 语言 / 启动与内存 / Java / 主题 / 关于 / 开发者；末项「建议与反馈」点击弹对话框、不切页，同 BlockHelm Feedback 语义；右栏详情 max-width 680px 浮中）
- [x] **即改即存**：去掉底部「保存设置」按钮，改动防抖落盘（UI 侧采 400ms 防抖；抽出泛型组合式 `useDebouncedField(get, commit, delayMs)`，SettingsLaunch/SettingsPanel 共用；走既有 SETTINGS_SET 全量语义在 UI 侧合并）
- [x] bool 项统一胶囊 toggle（复用 SettingToggle）；分区图标**未用 IconPark**，采内联 SVG lucide 路径/自绘（globe/coffee/info/code/message-square/lightbulb/bug + 主题对比圆自绘），零新增依赖

**通用栏**（BlockHelm 两大项均可搬）
- [x] 数据根：当前路径展示 + 打开目录 + 更换根（新键 `rootOverride`，宿主启动解析生效；pendingRoot warn 提示需重启）；采**单根+更换/打开**（待决策 #2 已拍板）；打开/更换走 `shell:open-dir` / `dialog:pick` 新通道，demo 无桥时禁用属设计使然
- [x] 启动器日志：日志目录只读展示 + 打开目录 + 清理日志（ConfirmDialog 复用 + clearMsg 结果行）+ 诊断日志开关 `diagnosticLog`（实时生效，控制 launch- 前缀诊断日志落盘）

**语言栏**（必须完整复制；游戏语言 GroupBox 按用户决策排除）
- [x] 启动器语言下拉 + 持久化进契约（AppSettings 新键 `language`；收编 localStorage 缓存仅作 bootstrap，useSettings.load 后 applyLanguage() 以 settings 为单一真相调 setLocale）
- [x] 清单先给实际有的（AVAILABLE_LOCALES：zh-CN/en 自名形态，不随 locale 翻译）；zh-Hant/ja-JP 待翻译，i18n 深合并机制加文件即得
- [x] **热切换已拍板并落地**（待决策 #1）：切换即全站即时生效零 reload，demo 实测英↔中往返通过

**启动和内存栏**（部分复制，逐项判定过）
- [x] 开关落地 **4 个**（SettingToggle）：启动前检查文件完整性 `checkIntegrity` / 缺失自动补全 `fixMissing`（前者关则后者禁用+联动，betacraft 侧 repair=false 抛明确诊断）/ 启动后最小化 `minimizeOnLaunch` / **启动时自动打开控制台窗 `consoleOnLaunch`**（v1「Game log」开关的全局化转置，缺省开；testLaunch 恒弹不受约束——2026-10-20 调研补入）；启动后自动加入服务器采 serverInput 文本输入（收编契约悬空键 `levelServer` 为地址输入项）；**「全屏启动」明示不搬**（老 Applet 容器无此能力，见旧不适用项注记）
- [x] 内存：自动/手动模式下拉 `memoryMode` + 最大内存滑杆（滑杆上限 = `min(总-2GB, 75%总)` + 系统总/可用内存摘要走宿主 `attic:sys:info` 通道）；auto 估算 `estimateMaxMemoryMb = round(总×0.4/128)×128` 夹 `[512,2048]`，UI 与宿主双侧同公式（contract.md 有双侧同步警示），demo 16384MB→2048 实测一致
- [x] 全局 JVM 参数 `globalJvmArgs` 落 settings（组序插位：Xmx → globalJvmArgs → launchArgs → legacyfix 系，launch.test.js 断言锁定）；与旧候选「inheritsGlobal 全局设置升级」同题的部分留待该待办落实时合并设计
- [x] 不搬：pre/post 执行命令、全局游戏参数（老版本场景价值低）；下载分区对应物 endpoints + username 按待决策 #3 拍板**迁入新建「开发者设置」栏**（逐键防抖合并写，warn 注记下次启动生效；发行时再评估可见性）

**Java 栏**（必须完整复制：自动探测 + 候选自主选择 + 自动选择）
- [x] 形态照搬 BlockHelm：自动/手动模式下拉 + 状态消息行（当前自动选中/手动指定/扫描中/为空）+ 刷新/导入按钮 + 候选列表（每行 = `Java {major}` + 完整版本串 + x64/x86 + 全路径省略号；**自动模式下列表禁点选**，auto→manual 切换固化当前自动选中项）
- [x] 数据源复用现成 `detectJava()` 报告的 `installs[]`；**契约键零增量**——原拟 `javaSelectionMode` 最终改为 `javaPath` 派生语义（有值=手动/空=自动，contract.md §2.7 已录派生规则）
- [x] 「导入」走 `dialog:pick` 原生文件对话框新通道选 java.exe（demo 无桥禁用）
- [x] Attic 独有资产保住：auto 模式探测失败 → Zulu 8 自动下载兜底保留；探测报告面板（失败候选/诊断）降级为栏内可折叠详情

**主题栏**（后期实现，目前占位）
- [x] 分区先建：深/浅/跟随系统 segmented 即时生效（tokens.css 体系已完备）；强调色/背景效果 = 「即将推出」灰条目（soon-row）；强调色正交分层方案（`[data-accent]` 只覆写三变量）见旧候选注记，日后落实

**关于栏**（必须参考 BlockHelm 格式搭建）
- [x] 头区：山形 logo 占位 + 启动器名 + `v{info.launcherVersion}`（无桥隐藏，demo 显 v0.0.0-demo）+ 「查看 GitHub 仓库」+「检查更新」按钮（disabled+soon 徽标，下载自更新留 Phase 5 GitHub Releases 轮询）
- [x] 启动器更新 card：更新通道下拉（正式版/测试版）disabled 占位——未来启动器更新系统的挂载点
- [x] 版权及法律声明三行「标题+说明+查看」：版权声明→仓库主页 / 开源协议→`${REPO_URL}/blob/HEAD/LICENSE` / 用户协议→disabled 占位（条款文本需另拟）
- [x] 引用的项目 card：组件内数据驱动数组（名称+desc+许可证 mono+查看外链，走 `shell:open-url` 白名单通道），7 条清单：Betacraft v1 / legacyfix / MCANextGen / BlockHelm-Launcher / Vue / Electron / Lucide；**许可证与 URL 全部实查**（四主项目本地 LICENSE+`.git/config` remote 逐字核对，均 GPL-3.0；Vue/Electron MIT、Lucide **ISC**——App.vue 旧注释"lucide MIT"有误，关于页已用正确 ISC）；未落 `ReferenceProjects.json` 外置文件，直接数组
- [x] **侧栏左下角头像点击 → 跳转本分区**：useSettingsNav 模块级 `goSection`（App.vue 直 import）+ activeSection 模块级持久，点头像 view='settings' + 关于栏立现

**建议和反馈栏**（必须完整移植）
- [x] 分区列表末项，点击弹 AppDialog 不切页：「新功能建议」→ `issues/new?template=feature-request` /「Bug 反馈」→ `issues/new?template=bug-report` / 底部取消——纯外链大按钮行（lightbulb/bug 图标），零表单零 API（待决策 #4 已拍板：仓库未开 Discussions，两条均指 Issues 模板区分）

**待决策（已全部拍板 2026-10-20，随落实定稿）**
1. 语言：**热切换** ✅ 已落地（settings.language 单一真相，localStorage 仅 bootstrap）
2. 数据根：**单根+更换/打开** ✅ 已落地（rootOverride + pendingRoot 重启提示）
3. endpoints + username 去向：**新建「开发者设置」栏** ✅ 已落地（发行时再评估可见性）
4. 反馈链接：**两条均指 GitHub Issues**，template=feature-request / bug-report 区分 ✅ 已落地

### Mods repository 与四功能调研（v1/legacyfix 源码核对 + 端点实测 2026-10-19，待落实）

> 调研输入：`reference/betacraft-launcher`（ModsRepository/ReleaseJson/Launcher/Wrapper/InstanceSettings/Instance）、`reference/legacyfix`（IntelGraphicsPatch/Patcher/Patch）源码 + `http://api.betacraft.uk/getmods.jsp` 2026-10-19 实测（HTTP 200 / 52KB / `last_modified` 至 2026-06，**端点存活且被维护**，mod `.info` 多已迁 GitHub releases 作者自托管）。

**Mods repository → 独立页面（下载图标）**：v1 模型 = mod 即**自定义版本**（`.info` + `base-version` 基座 rezip 合成，非 mods/ 文件夹模型；安装仅落 `.info`，jar 下载与合成延迟到点 Play；加载器 = `launch-method-link` wrapper jar 启动前自动拉取；零鉴权零 API key、与登录解耦、离线可装）。
- [x] **一期**（2026-10-21 落地，契约 §2.8 + modrepo.test.js 14 项）：左栏「Mods」页（下载图标、排版镜像自定义版本页）——左 = Betacraft 单源卡（拍板：一期不加其他源）；右 = animated 折页分组（`ModCategory[]/ModEntry[]`：full_name/version/info_file_url/website/autoupdate 五字段，last_modified 上游有而 v1 模型不消费、维持丢弃；现拉现发无进程内缓存，失败空态+重试）+ 安装 = GET `info_file_url` 原子落 `versions/jsons/<full_name>.info`（tmp+rename+样貌校验；登记 `launcher/mods.json`；拍板：官方同名拒绝、只安装不动实例、Mods 页无卸载钮——删除途径 = 自定义版本页，见下方修订记录）+ **base-version rezip 合成链**（mod jar → `versions/mods/<name>.jar` sha1 强制 → 基座 jar/libraries/assets 借用 → 每次启动重合成剥 `META-INF` 直接子级签名（保 MANIFEST/嵌套资源）→ `versions/<name>.jar`；缺料给显式「缺基座合成」诊断错，不假可用）+ `autoupdate` 启动期按登记 URL 刷新 info（失败留旧文件可离线，本地缺失=显式失败）
- [ ] **二期**：`launch-method-link` wrapper jar 挂载链（GET `{hash,url}` → 比对 `launcher/launch-methods/` → 下载 → classpath 挂载 + wrap 参数启动）——涉及启动装配模型改变（现主类数据表是绕开 wrapper 的原生复刻，mods 的第三方 wrapper 无法原生复刻，必须真实挂载）；`launchMethodsDir()` 目录 helper 已在、无消费方，即此缺口
- [x] 复刻时修 v1 三缺陷（2026-10-21 随一期落地）：`loadMods()` 追加不清空 → Attic 无进程内列表缓存、每次现拉；Load 按钮文案笔误 → 不照抄（Attic UI 自有 i18n「下载」文案）；mod jar 下载无 sha1 → `ensureModJar` 强制 sha1（校验开启时缺 sha1 拒绝无锚点下载，本地复用先复核）
- [x] **一期实测两缺陷（2026-10-21 修复）**：① 下载完成后按钮闪回「下载」再翻「已安装」→ `useMods.install` 成功路径改为「先重拉列表、后解锁 installingId」（解锁早于 load 完成 = 三态中间态回退）；② mod 装完不落自定义版本页（与 v1「mod 即自定义版本」模型、且自定义页是唯一删除途径的拍板相悖）→ `listCustomVersions`/`getCustomVersionInfo` 认 `base-version`（打 `mod` 标、右栏只读），`saveCustomVersionInfo` 拒绝编辑托管 .info（autoupdate 整文件重写、编辑必丢）+ 托管键 `base-version` 禁经编辑器写入（UI 表单同步撤字段），`removeCustomVersion` 联动清 `launcher/mods.json` 登记（防幽灵条目复活），自定义页删 mod 项成功后联动重拉 Mods 列表（徽标即时恢复「下载」）
- [x] **一期 UI 反馈三则（2026-10-22）**：① 版本行「自动更新」徽标删除（用户口径 = 无实际意义；`autoupdate` 数据/登记/启动刷新机制保留，仅撤展示 + i18n 键）；② 项目主页外链从逐版本行移到**组头折页行**（工程级属性，取组内首个非空 website，全无则不显示；HTML 禁 button 嵌套 → 开合钮与外链钮并列于 `.cat-head-row`）；③ **外链打开失败弹窗**（用户报「找不到默认浏览器静默失败」）：新增 `useExternalLink` 共享状态 + `ExternalLinkErrorDialog`（AppDialog 复用，App.vue 全局单例挂载），Mods 页/关于页外链统一走此通道——宿主 `shell.openExternal` reject（无 http/https 关联）与浏览器 mock 弹窗拦截（`window.open` 返回 null）都显式呈现错误详情 + 默认浏览器指引。
- [x] **设置页开发者栏两问定夺（2026-10-22 用户拍板）**：① 端点 Override **不加保存按钮**——`useDebouncedField` 400ms 防抖即改即存（与用户名/启动页同契约），按钮反而制造半保存态；缺的是回执 = `useDebouncedField` 新增 `savedFlash`（commit 后 1.5s true），开发者页五端点 + 启动页 levelServer/JVM 参数四个文本字段挂「已保存」微徽标（绝对定位零抖动；内存滑杆不挂避免拖拽频闪）。② **`AppSettings.username` 删除**——账户体系落地后零消费方的孤儿字段（全仓库唯一读写 = 设置输入框自身；启动玩家名恒取 `account.name`，无账户显式报错与「账户恒可空」拍板一致），契约/映射/UI/i18n/demo 五面清除；v1 数据面安全 = `launcher.settings` 里既有 `username` 键退出 managed 集后按「未知键原样保留」纪律不读写不清除。

**Force Update → 进实例设置（搬语义不搬缺陷）**：v1 实况 = 会话级全局静态字段（不持久化、放在实例设置对话框属 UI 错位、`readyAddons` 收参未用）；有效覆盖仅 libs/natives 重装 + 无 sha1 版本 jar 强下。
- [x] 实例级持久布尔键（2026-10-21 实现，用户口径改为常开开关、取消"一次性复位"）：`InstanceView.forceUpdate`（缺键=false，Attic 扩展键，非缺省才落档）→ launch() 编排读取，`{force:true}` 旁路四下载（client jar/libs/assets index/objects）的"已存在即复用"与 repair=false 缺失抛错；落基本设置 card

**Intel 双件套（调研澄清：v1 开关与 legacyfix 是两码事，都收）**
- [x] v1 "Apply performance trick for Intel Graphics" = `-XX:HeapDumpPath=java.exe_minecraft.exe.heapdump`（仅 Windows，Java 5u7 时代驱动 workaround，v1 默认开）→ 已实现（2026-10-21）：实例级布尔 `intelFix`（缺键=true），宿主 buildContext win32 门控注入 **jvmArgs 首位**（对齐 v1 Launcher.java L576-578 javapath 后首位语义），落基本设置 card
- [ ] legacyfix `-Dlf.intel`（`IntelGraphicsPatch`：glActiveTexture 前补 glClientActiveTexture，修老 Intel GPU 多纹理渲染错乱 b1.9–1.7.10，opt-in 默认关）→ 作 **addons 目录第 10 个实装项**（enable 族，现有注入链零改造）

**Discord RPC → 暂不实现（挂 Phase 6 愿望池）**：v1 = 游戏子进程 JVM 内 discord-rpc native 连本机 Discord IPC，展示"User/Version"；app id `939918927989973052` 为 Betacraft 注册物不可复用（需自注册开发者门户+传图）。若未来做：electron 主进程直连 `discord-ipc` 命名管道（纯 WebSocket，无需游戏侧注入），实例档案加 `RPC` 布尔键（v1 键集本有）即可。

### Phase 4 前置核查（2026-10-22 用户点单：15a 路由核对 + 实例列表时序 + addons 探查）

- [x] **c0.0.15a「硬编码 patch 没有生效」根因 = 版本钉缺失（非 launch-method 路由问题）**：路由本就正确（官方 `.info` `launch-method=Classic15aWithSaving` → info.ts 方法表 → AppletLauncher 容器，javaagent 区间 c0.0.13a–1.3.2 含 15a；WithSaving jar 本地反汇编：增量仅 betacraft 在线存档鉴权 API，legacyfix `LevelProxyAuthenticator` 为等价现代替代，存盘两腿 `LevelProxyPatch`（shape 触发）+ `DeAwtPatch`（`appletMode=false`）已在）。真缺 = `Classic15aServerPortPatch.shouldApply` 判 `lf.version=="c0.0.15a"` 的决策在 `Agent.premain`（Patcher.apply），早于 `--version` 解析与窗口标题探测两条晚到通道 → 修复：launch.ts 全版本无条件注入 `-Dlf.version=${versionJson.id}`（`-D` 经 Agent 静态块 `lf.*` 收集 = 唯一赶得上决策点的通道；数据表键戒律不破）。契约 §2.6 + 4 夹具 expected + 新断言，验证链 118/118。
- [x] **点启动后实例列表等游戏起来才更新（时序修复）**：宿主 `persistInstanceVersion` 从 launch 编排末端前移到**首个 await 前的同步段**（建档+版本回写，启动失败也已落盘；幂等不重写）；UI `useGame.launch()` 发起 launch IPC 后立即 fire-and-forget 重拉实例清单（Electron IPC FIFO 保证同步段先执行）+ resolve 后双刷新兜底。新 storage 测试钉死「离线 launch reject 但档案 version=请求值、gameDir/可编辑字段不动」。
- [x] **addons 未实现面探查（结论呈报，执行面待拍板）**：v1 addon 机制 = `org.betacraft.Addon` 抽象类进程内钩子（`launcher/addons/<名>.jar` 动态 classload，效果 = 注 applet 参数/反射改游戏对象）——AppletLauncher 架构下**无宿主通道**，legacyfix 侧只有 javaagent patches + proxy、无 addon 宿主。本地 7 jar 逐个 javap 定语义（ClassicNotPaid/Demo/Fullscreen/GameModeSwitch/OfflineDATSave/QuitGame/UnlicensedCopy）：Demo 已转正（原生 `-Dlf.demo`）；OfflineDATSave 被 LevelProxy+DeAwt 覆盖；ClassicNotPaid/UnlicensedCopy = DRM 装饰不建议移植；Fullscreen/GameModeSwitch/QuitGame = legacyfix 无对应开关，移植 = 上游 PR 级工作量，三 placeholder 维持现状。**26.10 复核（2026-10-22 用户实测口报）：addons 宿主机制依然没有——结论不变。**
- [x] **legacyfix 钉版 26.10（2026-10-22 升级，nightly 路线废除）**：Release 26.10（2026-10-19）构件 `legacyfix-26.10.jar`（无签名复核通过）。① `DEFAULT_AGENT_MOUNTS` path 文件名钉版 `legacyfix.jar`→`legacyfix-26.10.jar`——「存在即复用」对旧名自然失配 = 显式升级通道，且与 asset 名精确同名命中构件匹配主支；② 26.10 含 c0.0.15a 非 5565 端口补丁（昨日 `-Dlf.version` 版本钉的上游对偶，Release 首发包）+ DemoPatch + VisualizerPatch 重实现 → Phase 6 nightly 供给通道与「生效待 nightly」措辞全数废除；③ DeAwtPatch.class 哈希漂移 `d1003d49…`（=2026-10-18 nightly 实测同值，锚点恰 1 次/未含补丁串，窗口补丁仍必要且兼容）补入钉版表，release 通道恢复「下载即补丁」；④ visualizer 剩实机验收（b1.7.3 俯视图，Phase 6 验收路径不变）。
- [x] **版本列表首帧空窗（纯视觉 bug，2026-10-22 SWR 修复）**：现象 = 清单未取完时列表内容不可见（骨架/空区，取完恢复+锚定正常）。根因 = 宿主 `listVersions()` 旧策略「永远 await 网络、失败才退缓存」——`versionListCacheFile` 早已落盘却从不作首帧数据源，UI 每帧为网络让路。v1 对照 = 无清单缓存机制（`version_list.txt` 每次全量远取，首帧空列表直到惰性 `loadVersions`，「选择版本」按钮 size>0 门禁哑火）——不需要照抄，attic 连续渲染列表必须自建答案。修复 = stale-while-revalidate 双通道拆分（`runtime.ts`：`listVersions` 缓存即在即返+后台刷新=最终一致；新增私有 `refreshVersionListCache` 直网面，`installMod` 官方同名门禁切至该面保「先刷新再判」拍板不破；在途合并防并发重复下载）；UI 零改动（骨架期自然消失，首次运行无缓存仍诚实等待）；storage.test 新增手动闸门用例（网络不 resolve 列表也必须返回旧缓存）。

**落实顺序（用户口径）**：设置页重写 → Force Update + Intel 双件套（蹭 addons 归置待办顺路做）→ Mods 页一期 → wrapper 二期 → Discord RPC 挂起。

## 5. Phase 4 — Tauri 壳（接入模型改口径：sidecar 承载，Rust 只做壳层）

- [x] **接入模型定稿（2026-10-22 改口径）**：Rust **不再重实现**版本解析/Java 探测/参数拼装/进程管理——`@attic/runtime` 由 **Node sidecar 子进程**承载（stdio NDJSON RPC），Rust 面 = 窗口/宿主命令（窗控、对话框、外链、openPath）+ 转发白名单 + 事件桥。双壳漂移风险（#2）随之降维：启动核心单一承载，无第二拼装器可对撞。
- [x] `src-tauri` 骨架（2026-10-22 落）：`Cargo.toml`/`main.rs`/`lib.rs`（Sidecar 进程监督 + `ipc_forward` + 7 宿主命令）/`tauri.conf.json`（WebView2 110 钉 + embedBootstrapper + nsis.installerHooks + updater 占位）/`capabilities/default.json`/`windows/attic-checks.nsh`
- [x] `apps/tauri/sidecar`（2026-10-22 落）：runtime esbuild 单文件化 + NDJSON RPC 服务（方法面 = ipc.ts 白名单，backlog 归 sidecar）；本地 Node 握手测试 4 例（tests/rpc.test.js）
- [x] 契约测试双绿进 CI（改口径后的形态）：TS 侧 `fixtures:check`（导出表→fixture 漂移闸门）+ Rust 侧 `cargo test`（fixture 镜像比对），ci.yml `rust-contract` job（Windows 原生 runner）
- [~] **里程碑 M2**：Tauri 壳达到与 Electron 壳相同的游戏可启动面。**自动化可验证面已全绿（2026-10-12）**：rustup 就位（cargo 1.99）→ `cargo test` 契约镜像 2/2；sidecar RPC 握手 4/4 且经 NDJSON 面取回真实数据根 290 版清单（`@attic/runtime` 真门面加载）；`fixtures:check` in sync + `gate:node16` ok + `pnpm -r build/test` 全量绿；`tauri dev` 端到端：Rust 壳启动 → sidecar 干净拉起（进程存活、无崩溃）。**联调中修复一处真实缺陷**：`resolve_sidecar_launch` 开发态用 `app.path().resolve(Resource)` 返回 `\\?\` 扩展长度前缀路径，node 模块解析器不识别 → 退化成盘符相对 `E:` → `EISDIR`；改 `is_file()` 择优 + 剥 `\\?\` 前缀 + 开发态优先仓内 dist（`lib.rs`）。**余下 = 桌面手动验收**：真窗内点 Play 起游戏（需交互 + 真实游戏构件），无法无头自动化。
- [ ] 联调遗留（脚手架注记）：①无边距窗拖拽——WebView2 不认 `-webkit-app-region`，UI 顶栏需补 `data-tauri-drag-region`（Electron 线零影响，条件注入或双属性并存）；②sidecar 便携 node 发行形态（随行 node.exe vs SEA 单文件）发版 SOP 定稿；③updater：密钥对已生成（2026-10-22，`tauri signer generate`）——公钥已入 `tauri.conf.json`，私钥+口令在 `apps/tauri/.secrets/`（已 gitignore；**GitHub Secrets 需登记 `TAURI_UPDATER_PRIVATE_KEY` / `TAURI_UPDATER_PRIVATE_KEY_PASSWORD`**，丢失任一则更新全废）；endpoints 占位（REPLACE_OWNER/REPLACE_REPO）随发布仓库定稿替换；④品牌图标现为占位（`scripts/make-placeholder-icon.mjs` 生成），正式资产替换 `brand/attic-icon.png` 后重跑 `tauri icon`。

**WebView 最低版本支持做法（2026-10-21 调研，来源 tauri.app distribute/windows-installer + reference/webview-versions + 2.12 release notes）**：
- **Windows（WebView2，自更新 Chromium）**：官方做法 = `bundle.windows.minimumWebview2Version`（如 `"110.0.1531.0"`）——安装器检测本机 WebView2 版本，不达标即按 `webviewInstallMode` 拉起运行时安装，五档：`downloadBootstrapper`（缺省，~0MB 需联网）/ `embedBootstrapper`（+1.8MB，内置引导器，Win7 msi 兼容路径）/ `offlineInstaller`（+127MB 全离线）/ `fixedVersion|fixedRuntime`（+180MB 自带固定运行时，体积大且安全补丁自担）/ `skip`（不推荐）。**决策建议**：NSIS + `embedBootstrapper` + 钉一个满足前端特性的最低版本；Win10 1803+/Win11 预装 Evergreen 基本免装。
- **Win7 红线**：Tauri 2.12（2026-09-26）官宣放弃 Win7——新版 WebView2 installer 在 Win7 崩于 `GetPackagesByPackageFamily` 入口点缺失；MSRV 同步提至 Rust 1.90（stable-3 政策）。我们的 Win7 老玩家需求由 **Electron 壳兜底**（Electron 最后支持 Win7 的版本仍可发布）或旧版安装包，不在 Tauri 壳上追。
- **macOS（WKWebView，随系统）**：10.10 起系统内置、随 OS 更新，**不受支持版本不再更新 WebKit** → 没有"装 WebView"这回事，只能钉 OS 下限：`bundle.macOS.minimumSystemVersion`（Tauri 官方支持面 10.15+，对应 WebKit 608/Safari 13 等价基线）。CSS/JS 保守基线按 Safari 13 划线。
- **Linux（webkit2gtk-4.1，发行版决定）**：无法自带运行时，最低版本 = **构建基线发行版决定**：官方口径"用最旧的受支持且仓库提供 `libwebkit2gtk-4.1-dev` 的系统构建"——Ubuntu 22.04 / Debian 12 为合格基线（webkit 2.36 ≈ Safari 16 等价）；deb 包自动声明依赖 `libwebkit2gtk-4.1-0` + `libgtk-3-0`，老发行版（如 Ubuntu 20.04 初始 2.28）装得上但 WebView 漂移——与风险 #4 缓解一致，Tier-2 定位不变。

**用户侧真正可用版本下限钉死（2026-10-21，补上述"做法/档位"缺的数字锚点）**：
- **两个天然硬锚（皆上游官方弃支持线，无需我们写 OS 检测逻辑）**：
  - Windows 主通道锚 = **WebView2 110**：Edge/WebView2 Evergreen 运行时在 Win7/8/8.1 永久停在 109（2023-01-10 起停支持，110+ 仅 Win10）——`minimumWebview2Version: "110.0.1531.0"` 钉下即自动排除 7/8/8.1（旧系统装得到 109 但不达标 → 安装器按 webviewInstallMode 拉 bootstrap，成功后仍是 109 → 显式失败提示，天然形成"版本墙"）。有效 OS 下限 = **Win10**（1803+ 可装 WebView2，21H2+ 预装免拉）。
  - 兜底通道锚 = **Electron 22.x**：官方官宣 22 = 最后支持 Win<10 的 major（23 起要求 Win10+，与 Chromium 110 弃支持同拍）；钉 22 线末期补丁（22.3.x，具体末版发版 SOP 时锁），OS 下限 = **Win7 SP1**（含 8.1），运行面 = Chromium 108 / Node 16 代。
- **特性下限自检（已核，非假设）**：当前 UI 保守基线对运行面的最高要求 = Chromium **107**（折页动画 grid-template-rows 0fr→1fr 插值）；无 `:has()`（105+ 才有）、`color-mix`（111+）已规避（tokens.css 注记"基线风险 #4 规避 → 预计算 rgba"）、`backdrop-filter` 全带降级 → **两锚皆绿**（110 ≥ 107 ✓、108 ≥ 107 ✓）。macOS 已知视觉降级：0fr 插值 WebKit 需 16 → 10.15–15 的 WKWebView 上折页退化为无动画显隐（功能完整）。Linux ≥2.36（≈Safari 16）全绿。
- **兜底通道的隐性锁（新增约束，易踩）**：runtime/core-spec 共享代码会进 Electron 22 **主进程 = Node 16 代**——`structuredClone`（Node 17+）等 API 宿主侧禁用；TS 编译 target 需确认落 ES2021 面（现状 tsconfig 待核，Phase 4 双壳 CI 闸门加 lint/lib 约束）。UI 侧 renderer 由 Chromium 108 供给，另受"≤108 ∩ ≤WebKit 608"特性天花板约束——未来引入 >108 特性须显式评估兜底降级。
- **工具链下限（构建面，随记）**：Rust MSRV 1.90（Tauri 2.12 stable-3 政策）；此为玩家无关的 CI 面约束。
- **已拍板（2026-10-21）**：
  - ① **WebView2 钉 `110.0.1531.0`**（特性余量最小够用，未来引入 >110 特性时再评估上调）。落点 = `tauri.conf.json: bundle.windows.minimumWebview2Version`。
  - ② **安装器加旧系统检测提示**（非仅文档指路）：NSIS 自定义逻辑二判——OS 版本 < Win10（6.2/6.3/6.1 = 7/8.1）或 WebView2 Evergreen 注册表键（`…\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`，HKLM+HKCU/WOW6432Node）读到的版本 ≤109 → MessageBox 明示「本机 WebView2 已停更，请改下载 electron 兼容构件」+ releases 页 URL 常量。实现通道 = ~~`nsis.template` 抄模板~~ **改核为官方轻量钩 `bundle.windows.nsis.installerHooks`**（bundler 模板以 `!ifmacrodef` 守 `NSIS_HOOK_PREINSTALL`，版本无关免维护整模板；2026-10-22 官方文档核实）。**「需要定制 NSIS 吗」定稿：不需要编译级定制**——官方预编译 makensis + 自带 LogicLib/WinVer/x64.nsh 足够，定制面 = 纯脚本层 .nsh；自定义插件 DLL（才需编译 NSIS）无需求。WebView2≥110 保证继续归 bundler `minimumWebview2Version`+`embedBootstrapper`，nsh 只做 OS/架构防错装。已落 `src-tauri/windows/attic-checks.nsh`；URL 占位（`ATTIC_LEGACY_DOWNLOAD_URL`）与构件命名（`attic-electron-*`）对齐发版 SOP。

## 6. Phase 5 — 分发

- [ ] Windows：Tauri NSIS 主发布；Electron 版走 electron-builder（同为 NSIS）= 兼容兜底通道（2026-10-21 从「参考实现」升格，细则见下方选型调研）**〔脚手架已落 2026-10-22：release.yml Windows 首发矩阵（tauri x64/arm64 NSIS + electron-legacy x64/ia32 NSIS）；src-tauri 构建面、updater 占位、便携 node 随装三项待 CI 首跑收口〕**
- [ ] Linux：AppImage + 已知问题清单（DMABUF/Wayland 环境变量逃生舱）；Tier-2
- [ ] macOS：ARM 为主（基线 Apple Silicon + 近两版 macOS）；未签名发布 + 右键打开教程；$99 开发者签名作为后置决策（风险 #5）
- [ ] CI 矩阵：三平台仅构建 + 契约测试（不启动游戏）
- [ ] 更新通知：GitHub Releases 轮询（照抄 v2 的做法）
- [ ] README 补免责声明显眼位 + 品牌写法 "Attic Launcher for Minecraft: Java Edition"（风险 #6）

**安装包选型 + 架构矩阵早期调研（2026-10-21，来源 tauri.app distribute 文档 + tauri-bundler changelog）**：
- **格式支持面**：Tauri bundler 原生 targets 仅 `["deb","rpm","appimage","nsis","msi","app","dmg"]` 或 `"all"`——**Inno Setup 无官方通道**（需社区外挂自写 .iss），排除；结论：Windows 不引入 Inno，维持 NSIS 主发布。
- **「NSIS 比 Inno 好」论据展开（2026-10-21 补充）**：installer 工艺层面两者互有胜负、Inno 甚至略占优（Pascal 式脚本更易学文档更稳、LZMA2 solid 压缩略好、6.3+ 有 WoA 原生 arm64 stub——NSIS stub 仍是 x86 靠 Prism 模拟，ARM64 机器装用无感）；per-user 免管理员（MULTIUSER vs `PrivilegesRequired=lowest`）、静默参数（`/S` vs `/VERYSILENT`）两等价。选型真正的依据是**供给链三点，非工艺优劣**：① Tauri 官方 target 零维护 vs Inno 自写 `.iss` 并跟随 bundler 打包布局变化（目录结构/快捷方式/卸载注册键全自维护）；② `makensis` 有 Linux/macOS 原生二进制，装包步骤可在任一 runner 交叉出，`ISCC` 是 Windows-only——引入 Inno = CI 被迫加专职 Windows installer-build job，与「三平台仅构建+契约测试」矩阵相抵；③ Tauri updater 直接消费 `*-setup.exe`（NSIS 静默升级=通道本体），Inno 需自造与插件协议对齐的升级逻辑。加成项：**electron-builder Windows 缺省 target 同为 NSIS**——双壳同 installer 栈（静默/卸载/文档一套通用）；若 Tauri 侧引入 Inno 则一项目两套 installer 体系（Tauri 自造外挂、Electron 仍 NSIS），最差分叉。
- **Windows NSIS vs MSI**：NSIS 出 `*-setup.exe`，可 Linux/macOS 上 `cargo-xwin` 交叉构建，且 updater 直接复用 setup 包；MSI 走 WiX v3，**只能在 Windows 上构建**（.NET 3.5 依赖需装 VBSCRIPT 可选功能），价值在企业/GPO 静默分发场景——按需后置（`targets` 加一项即可，不费力）。双轨发：NSIS 必发，MSI 可选附件。
- **Linux 三发**：deb（Debian/Ubuntu 系）+ rpm（Fedora/openSUSE 系）+ AppImage（免 root 兜底）全发——bundler 一次构建各格式自动产出，边际成本低；AppImage 运行仍需 FUSE（Ubuntu 24.04 只带 fuse3 的发行版给 `--appimage-extract-and-run` 逃生舱，进已知问题清单）；pacman 等社区需求出现再加。
- **macOS**：`app`（.app 目录）+ `dmg`（分发容器）两个都发，未签名 + 右键打开教程（承接上条）。
- **架构矩阵（arm64 / x86 早期结论）**：
  - Windows：`x86_64-pc-windows-msvc` 必发；**arm64（`aarch64-pc-windows-msvc`）值得做**——需 VS C++ ARM64 build tools，注意 NSIS 安装器 stub 本身仍是 x86（靠 Prism 模拟运行，装在 ARM64 机器上无感），包内应用为原生 arm64；Win-on-ARM 设备保有量上升（Copilot+ PC），供给成本低。i686 32 位（`i686-pc-windows-msvc` 可构建）暂缓——仅服务 32 位老系统，而那批用户已被分流到 Electron 兜底壳（见 Phase 4 Win7 红线）。
  - macOS：ARM（Apple Silicon）为主已定；x86_64 版本靠 Rosetta 2 过渡，或 CI 加一条 `--target x86_64-apple-darwin` 发 universal dmg（`lipo` 合并，成本低，发版前决策）。
  - Linux：`x86_64` 必发；`aarch64-unknown-linux-gnu` 用 Ubuntu 22.04 arm64 runner 原生构建即可（webkit2gtk-4.1 在 arm64 仓库同源），面向树莓派 OS 64 位等 SBC 玩家——老 Minecraft 与 SBC 重叠度待社区验证，Tier-2/3。
  - Electron 对照（同一矩阵口径）：electron-builder 支持 win x64/arm64/ia32、linux x64/arm64/armv7l、mac x64/arm64——兜底通道实际发版面：win x64 + win ia32（2026-10-21 修正：原「ia32 暂缓」与兜底定位矛盾——32 位 Win7/8.1 正是远古 MC 玩家存量大头、兜底唯一服务对象；Electron 22 全系有官方 win32-ia32 构件，官方砍线在 Electron 44，22 不受影响）；electron 的 mac/linux/arm64 构件不发（兜底卖点=老 Windows 面，见 Phase 5 兜底通道细则）。
- **Electron 发行 = 兼容兜底通道（用户意向 2026-10-21，从「参考实现」升格为备选发行）**：
  - **通道定位**：Tauri = 主发布（最新壳体验、updater 自动升级）；Electron = 兼容兜底——服务对象与 Phase 4 既有红线一致：Win7/8.1 老玩家（钉 **Electron 22.x** 最后支持线，23 起官方放弃）为**唯一承诺面**；Linux WebKitGTK 碎片化/老 glibc、macOS 老 WKWebView 两面由主通道基线（22.04/10.15）承接其合理部分，**比这更老的 mac/linux 面不承诺、兜底不发其构件**（2026-10-21 收窄，避免发布矩阵虚胖）。Electron 自带 Chromium，运行面确定性正是 Win7 兜底场景要的。
  - **安装包同栈**：Windows 走 electron-builder 缺省 NSIS（与主通道同静默参数/卸载行为，文档一套），仅出 x64+ia32 两构件；不做 linux/mac 包（与发布面收窄定稿一致）。
  - **发布面**：同一 GitHub Releases，构件命名分通道（如 `attic-tauri-*` / `attic-electron-*`）；更新通知沿用 Releases 轮询（照抄 v2 做法），latest 解析按通道前缀分轨——玩家侧「哪里下」只有一个入口，兼容需求者按文档选 electron 构件。
  - **责任边界（必须文档明示）**：22.x 线自身 EOL，兼容通道**不回填壳侧安全更新**，按现状提供（as-is）；主通道修复不承诺同步。这是双壳维护费的真正大头——发版承诺从「一套构件」变「两套」，CI 矩阵×2（契约测试闸门本已按双壳设计，边际=构件上传与体积：Electron 包 ~90MB 级 vs Tauri ~10MB，beta 社区可接受）。
  - **升级 vs 参考实现的区别**：参考实现=可跑即可不承诺发版；兜底通道=发版矩阵含它、issue 标签分轨（`shell:electron`）、已知问题清单独立。若发版负担超预期，降回「仅 Win7 备档、随版本滚动停更」也留了退路（构件仍在 releases，只是不再跟发）。
  - **游戏侧无关约束**：发行版架构 ≠ 游戏 JVM 架构——远古版本要 32 位 x86 JRE（Zulu 归档 x86 有、arm64 无 JRE 8 老构建则另议），壳的 arm64 发行不能替玩家解决 JVM 供给，安装器文档需说明（风险 #7 同族）。WoA 补充：arm64 Win 设备跑 x86/x64 JRE 靠 Prism 模拟（对玩家无感，但远古 Java8 无 arm64 构建 = 只能走模拟，性能可接受——远古版本本就低负载）。

**多架构维护方案与发行数定稿（2026-10-21）**：
- **戒律**：架构数 = 设备存量 × 无替代品，两个因子缺一个就不发——架构是用户设备问题不是技术虚荣，矩阵宁小勿大（首发总额 **6 个安装包**）。
- **两架构总方针（用户拍板 2026-10-21）**：**持续发行线严格 x86_64 + arm64 一路走**——所有跟版本迭代的构件（主通道全量、updater 轨、未来新增面）不引入第三架构，与上游收线节奏同向（Electron 44 砍 ia32、Tauri 无 i686、armv7l 天花板锁死）。唯一例外 = 兜底 `win-ia32`：它不属于"持续线"，是 Electron 22.x EOL 钉死线**同次构建多开一个 target 的一次性构件**（零后续维护，拍板保留），服务的恰是 32 位 Win7/8.1 无替代存量。心智模型：持续线两架构 = 承诺面；一次性构件 = 覆盖面，两者分开记账。
- **首发清单**：
  - 主通道 Tauri（4）：`win-x64` NSIS（绝对主力）；`win-arm64` NSIS（Copilot+ 世代保有量上升，构建成本≈0，见下交叉注记）；`mac-universal` dmg（**定稿采 universal 单包**：`lipo` 合并 arm64+x86_64，体积 ×~1.8 换「玩家无需自辨架构」的引导简化——远古 MC 玩家 Intel Mac 存量大，双包制选择成本高于体积成本）；`linux-x86_64` deb+rpm+AppImage（一架构三格式）。
  - 兜底 Electron 22.x（2）：`win-x64` + `win-ia32`（32 位 Win7/8.1 存量面，修正见上）。
- **明确暂缓（含翻案条件）**：`linux-arm64`（SBC×远古 MC 重叠未验证，社区信号出现即翻案——GH arm64 Linux runner 原生构建，边际成本低）；`armv7l`（Chromium/Electron 官方砍线在前，天花板锁死）；Tauri `i686`（32 位需求已由兜底 ia32 承接，主通道不做）；electron mac/linux（超兜底定位）。
- **CI 编排**：一条 release workflow，jobs = 目标矩阵——`windows-latest`（x64 原生 + arm64 交叉：cargo/aarch64-msvc target + VS ARM64 库；NSIS 打包 stub 仍 x86 无所谓）、`macos-latest`（ARM runner 上 `--target aarch64,x86_64` 直出 universal）、`ubuntu-24.04`（x64；arm64 暂缓故不用 ARM runner）。**契约测试只在原生 arch runner 跑**，交叉构件 = 构建+打包+冒烟启动（`--version` 级），不做全量测试；构件统一命名 `attic-<tauri|electron>-<os>-<arch>-<ver>.<ext>`（ia32 面用户群不会自辨，命名即文档）。
- **Updater 分轨**：Tauri updater `manifest.json` 平台键全量维护（`windows-x86_64`/`windows-aarch64`/`darwin-aarch64`+`darwin-x86_64` 两键同指 universal 构件/`linux-x86_64`）——发版 SOP 步骤化：**缺键 = 该架构用户静默收不到更新（fail 比静默好，SOP 加脚本核对清单对账）**；兜底通道无自动更新（钉 EOL 线，手动下，运维面天然归零）。
- **防错装**：NSIS customInit 加架构 guard（x64 机误下 arm64 包、arm64 机误下 ia32 包 → 提示正确构件；与 WebView2 检测提示同一钩子位，一套模板维护）。
- **portable 形态定稿（2026-10-21）= 目录构件，不做单文件自解压 exe**：win `zip` / linux `tar.xz`（mac `.app` 打 tar 优先级低）随 release 挂出，CI 成本一条压缩命令。**否单文件 exe 的四条理由**：① electron-builder `portable` 默认每次启动全量解包到 `%TEMP%`（~90MB 级，老机器惩罚最重），cache 模式则退化为目录包换壳；② 自解压单文件是杀软启发式误报重灾区，服务老系统反添开机拦截；③ 供给通道错位——Tauri 无 portable 官方 target（硬做=自写外挂，违「官方通道零维护」戒律），linux 单文件免装需求已被 **AppImage 满足**，真剩的只有 win/electron 面；④ portable 目标人群（U 盘/机房/无管理员权）解 zip 零门槛，且数据根外置 + `rootDir` 可配置 = 解压目录 + 指定数据根即干净 portable 语义。**升级语义**：portable 无 updater 通道，重新解压即升级（文档写明）；构件命名并入统一规范 `attic-<shell>-<os>-<arch>-<ver>-portable.<ext>`。
- **退役纪律**：撤架构 = 公告 + 末版构件保留在 releases 永不删（历史版本可回溯）；加架构走翻案条件，不进「全矩阵齐了才体面」的心智。

## 7. Phase 6 — 后置（不承诺时间）

- [ ] **Infdev 地图预览器（legacyfix VisualizerPatch，方案已调研定稿；2026-10-21 UI 先行落地：启动页「≡」菜单**动作项**「启动无限地图可视化器」——点击 = `LaunchRequest.visualizer` 一次性启动（不写实例档案，注入位与 addons 族同位、档案已含 visualizer 时去重），可点前置 = 选中版本 jar 类探测（`probeVersionClass`，`net/minecraft/isom/IsomPreviewApplet.class`，mtime 缓存）+ 常规可启动；**2026-10-22 生效条件满足：legacyfix 26.10 Release 已含 VisualizerPatch/VisualizerLauncher，nightly 路线废除，剩实机验收）**：
  - 上游依据：`6ed9e82`（2026-10-13，v3 HEAD）新增 `VisualizerPatch`——opt-in 补丁，`-Dlf.visualizer` 存在即生效（`Patch.shouldApply` 走 Agent SETTINGS 的 `lf.*` 通道，与 `-Dlf.assetsDir` 等同源），把启动主类 `main()` 替换为反射调用 `VisualizerLauncher.launchPreviewApplet("net.minecraft.isom.IsomPreviewApplet")`；`VisualizerLauncher` 自建 AWT 窗口「Minecraft Infinite Map Visualizer」854×480，关窗 `System.exit(0)` 进程自退（**无需窗口看门狗**）。`reference/legacyfix` 已同步至 `6ed9e82`（顺带含 c0.0.15a 非 5565 端口补丁、LWJGL 3.1.3 方法补丁、ProxyPatch 增强 + version_data.json 新行）。
  - jar 供给：~~**免自编译**——CI nightly 构件~~（**2026-10-22 整段废除：Release 26.10 已含全部所需补丁，nightly 供给通道不再需要**；下文保留作取证记录）——CI nightly 构件 `https://nightly.link/betacraftuk/legacyfix/workflows/gradle/v3`（最新 `legacyfix-nightly-<run_id>.zip`，内含 shadow 胖 jar，version=`nightly-<run_id>`）；Release 26.8（2026-08-23）不含 visualizer，走 nightly 才有。落地通道二选一：① 端点/设置增 legacyfix 渠道（release/nightly），nightly 先经 GitHub API `actions/workflows/gradle.yml/runs?branch=v3&status=success` 解析最新 run → 构件名拼 `nightly.link/.../<name>.zip`（构件名含 run 号、每次 push 变化，索引页 `workflows/gradle/v3` 亦可解析）；② 手动把 nightly jar 覆盖数据根 `launcher/legacyfix-*.jar`（`ensureLegacyfix` 见文件已存在即跳过，零代码改动，先验证用）。
  - **2026-10-18 全链路实测（run `38431103449`，head=`6ed9e82`，最新成功 nightly）**：
    - 通道成立：nightly.link 免登录取回 `legacyfix-nightly-38431103449.zip` 1016350B，与 GitHub API `size_in_bytes` 逐字节一致（代理未改内容），zip 内即单个 shadow jar；`VisualizerPatch`/`VisualizerLauncher` 类在场（5 条目），Release 26.8 无 → "预览器必须走 nightly"前提坐实。
    - **DeAwtPatch.class 哈希漂移**：nightly=`d1003d49a286c48696992427f63ac9d4efa105700c4fbf3b3d0d0156ece3b7ef` ≠ release 钉版 `bcf09fe0...31b0e`（26.8 实测仍逐字节命中钉版表 → release 通道"下载即补丁"零维护；26.8 的 asset 自带 GitHub sha256 digest `d64cd29a...`，实测吻合，可作下载完整性校验增强）；漂移源=上游 `0394721`（2026-10-03，"MP quick join pre-1.6, c0.0.15a fix"）动过 DeAwtPatch.java——该文件近半年 5 次提交（≈月频），nightly 移动目标下人工追钉哈希不现实。
    - **补丁本体对 nightly 兼容**：锚点句仍恰 1 次、upstream 未合并 setLocation（补丁仍必要）；`patchDeawtClassBytes` 直喂 nightly 的 class 字节 → OK（14528→14593，delta=65=setLocation 句长），再入护栏正常返回 null。
    - **门两级定稿**：release jar 走钉版哈希表（语义保险）；nightly jar 走**结构校验门**——锚点恰 1 次 + 常量池唯一命中 + 回写后重读自检（本就是补丁函数硬前置），每次应用打印 class sha256 供抽检、永不静默；上游若改掉锚点句，结构门自然 skip+显式诊断、不阻断启动。`applyLegacyfixDeawtPatch(jarPath, pins)` 注入点已预留，nightly 分支传结构模式即可。
  - 版本门控（数据驱动，戒律 #1）：本地 jar 含 `net/minecraft/isom/IsomPreviewApplet.class` 才暴露入口——复用 `listZipEntryNames`，同 `probeIndevEntry` 配方。官方 docs 范围：inf-20100616 引入、a1.2.0 移除、b1.3 起损坏（本次 reimplementation 即修复）；class 实际残存至 b1.7.3 jar（实测本地已装 jar 仅 b1.7.3 含该类）。
  - 启动链路：`LaunchContext` 增 `visualizer?: boolean` → jvmArgs 注入 `-Dlf.visualizer`（固定组位置建议 levelServer/assetsDir/assetIndex 之后、javaagent 之前，进 contract.md §2.6 钉序）；UI 入口 = 主页「| ≡」菜单「以地图预览器启动」；契约基线夹具不变，`launch.test.js` 补注入/不注入两条断言。
  - 验收路径：先跑 b1.7.3（已装且含类）看俯视图渲染存档；注意其主类为 launchwrapper `Launch`，补丁 hook 的是 `sun.java.command` 首 token（=Launch），实机为准；代理/皮肤/资产链路不变。
- [ ] ~~**nightly.link 免登录下载 Actions artifacts（通用构件通道，visualizer jar 供给的前置能力）**~~（**2026-10-22 拍板废除：legacyfix 26.10 Release 内容完备、nightly 依赖清零；本条作已调研档案保留，未来真有「上游只发 CI 构件不发 Release」的依赖再重启**）：GitHub 官方 artifact 下载需登录（`/suites/.../artifacts/<id>` 直链 403，API `download-artifact` 需 token），而 nightly.link 把同一构件代理为**公开免登录直链**——`https://nightly.link/<owner>/<repo>/workflows/<workflow>/<branch>/<artifact-name>.zip`（已实测：legacyfix v3 最新构件可匿名取回，zip 内即 `build/libs` 原样内容）。要点：① 索引页 `workflows/<wf>/<branch>` 列出最新构件名（构件名含 run 号、每次 push 变化），程序化取回=先抓索引页或 GitHub API runs 列表解析构件名，再拼 zip URL；② nightly.link 页内的 Azure blob "ephemeral direct link" <1 分钟过期，**不可缓存**，稳定入口只有 nightly.link zip URL（302 现签）；③ 属第三方代理服务（开源 roidelity/nightly.link），有可用性/时效风险（仅保留近期 run），作 fallback 通道而非唯一供给面，与 Release 渠道并存（风险 #1 同族：端点全配置化）。适用面：legacyfix nightly jar、后续任何"上游只发 CI 构件、不发 Release"的依赖供给。
- [ ] Android 第三壳调研：共享数据层（版本表/端点），独立 Kotlin 执行壳；参考 FCL 与 Quanta-Craft-Launcher 的 JVM 管线（libjpe/Redcore 路线）——"通道复用"而非"前端复用"
- [ ] 能力探测并入：字节码判定 `resizable`/`supportsFullscreen` 自动填充版本表（MCANextGen 资产，可反哺上游）
- [ ] 与 Betacraft 的协作界面评估（我们做壳、他们做数据/修复的分工是否可正式化）
- [ ] addons 重启路径（若需求真实存在）：优先给 legacyfix 提 GameModeSwitch/QuitGame/Fullscreen 补丁（上游空缺清单已盘点，见数据目录布局注记），而非恢复 wrapper 通道；仅当 addons 生态无法补丁化时才评估 wrapper container 字段
- [ ] **外置登录（BlockHelm 语义 = authlib-injector 族）落实前置注记（用户拍板 2026-10-22：现在不落实，社区需求出现时随外置登录一并实现）**：指涉澄清——**不是**微软账户体系；UI 头像面正版/离线账户共用 minotar.net（`SkinAvatar.vue` 已落地），正版皮肤走官方 session 链路，与下述机制无关。**BlockHelm 外置登录机理（取证锚）**：`AuthlibInjectorProvisioningService`（yushi/authlib-injector，`artifact/latest.json` 取回 + SHA-256 校验 + 缓存 manifest）+ 启动注入 `-javaagent:<jar>=<serverUrl>` + `-Dauthlibinjector.yggdrasil.prefetched=<b64>`（LaunchService.Preparation.cs L220-225）；离线皮肤面 = 同 injector + `-Dauthlibinjector.side=client` + 本地 prefetched（L233-239，`OfflineSkinYggdrasilService` 扮演 yggdrasil 服务端）。**与 legacyfix `docs/Skin overrides.md` 的交点（本文档存在的原因）**：authlib-injector 官方支持面 = Minecraft 1.7.2+——远古版本（Classic/Indev/Infdev/Alpha/beta）无 authlib/会话校验注入面，injector 物理进不去；而 attic 的主战场恰是远古段。远古外置登录的**皮肤通路**因此只剩 legacyfix 原生覆写机制：`-Dlf.proxy.overrides.mode`（默认 `mixed` 本地优先→远端回落；`api`/`local`/`disabled`，另有 `.disable`）+ `-Dlf.proxy.overrides.host=https://<外置登录服>` 指 `/api/skin|cape/<username>`（Betacraft API 形状），或壳侧拉取端自产 png 落 gameDir `legacyfix/skin|cape/<username>.png`（大小写敏感）走 `local` 通道。全部钩子挂 `-Dlf.*` 通道（与 vsync/demo/版本钉同源），**不需要新 agent 补丁**；账户类型通道已具备（添加账户两步弹窗的第三方占位）。落实三件套 = authlib-injector 供给面（照 BlockHelm：latest.json+校验+缓存）× 较新版本走 injector 注入 × 远古版本走 overrides 皮肤通路。
- [ ] **i18n 全量人工润色（用户反馈 2026-10-21：部分句子/词语用语生硬）**：现有 zh-CN/en 文案多为随功能落地时的直译/机翻初稿（Mods 页、自定义版本页、设置页等新节尤甚），需逐页功能核对语境后完善表达——键面零改动（双语镜像 + `contract.test.js` 键集绊线不动），只改 value 措辞；核对时顺带清理中英混排不一致（如「下载中…」「已安装」类状态词的全页统一口径）。

## 8. 风险登记

1. **betacraft.uk 基础设施单点**：proxy/皮肤/资产端点不在我们手里。缓解：端点全配置化、版本表离线缓存优先、归档通道多源。
2. **双壳漂移**：两份宿主实现必然诱惑分叉。缓解：契约测试进 CI 闸门；核心保持薄（重活在数据与 legacyfix，漂移面才小）。
3. **功能对齐悬崖（v2 死因复发）**：任何"把 v1 特性清单抄进 backlog"的冲动。缓解：非目标清单即宪法，超出 Phase 0–5 的一律进 Phase 6 愿望池。
4. **Linux 渲染碎片化**：WebKitGTK 版本由发行版决定。缓解：保守 CSS 基线 + Tier-2 支持定位 + 文档化逃生舱；NixOS 类问题交给社区。
5. **macOS 无实机**：CI ARM runner（构建/冒烟/截图）+ 按小时云 Mac（发版抽查）+ 社区 beta 志愿者；游戏侧 mac quirk（反色/鼠标）由 legacyfix 承担。
6. **商标合规**：产品名用 "Attic Launcher"，"for Minecraft: Java Edition" 仅作描述；显眼免责声明（BlockHelm 模板）；不暗示官方背书。
7. **远古 Java 可得性**：现代系统不发 JRE 6/7/8。缓解：Zulu 归档通道自动拉取 + 手动导入 + 探测失败面板给全候选与原因（MCANextGen 面板范式）。
8. **LWJGL2 native 在现代系统**（声音/GL/32 位库）：属游戏侧问题，优先 legacyfix 补丁覆盖，其次 per-build 已知问题文档，最后才考虑客户端 workaround。
9. **LWJGL2 arm64 架构死区**（2026-10-23 拍板闭环）：LWJGL 2.x 官方从未发布 arm64/armhf 原生库（2015 停维）；BC depends 三平台 natives 实测零 arm 覆盖（osx 单文件 = x86_64）。缓解已落地：启动链 `checkLwjgl2Arch` 闸门——mac arm64 拦 arm64 JVM 并指路 x64 JDK + Rosetta（Java 选择架构偏好天然优先 x64，Rosetta 路线零改动）、Linux arm/arm64 明示暂不支持、Windows arm64 放行（x64 模拟）。分发口径（同日二拍）：**Windows/macOS arm64 照常分发**（壳原生，游戏侧模拟/Rosetta）；Linux 仅 x86_64 且**优先 Debian 系（deb，AppImage 随发供 updater），arch/redhat 有需求再说**；linux arm64 不分发。社区 arm64 LWJGL2 重编译进 Phase 6 愿望池（第三方二进制信任评估前置）。

## 9. 参考（本地克隆于 `reference/`，不入库）

- `reference/betacraft-launcher`（v1，Java/Swing；分支 `v2` = C++/Qt 停更重写——其 commit 历史是 API 集成坑的免费地图：token 刷新、version json 重下策略、Linux 声音/工作目录、assets 位置）
- `reference/legacyfix`（v3，javaagent/coremod/mod 三形态；补丁清单即 quirk 矩阵）
- `reference/BlockHelm-Launcher`（WPF/.NET，GPL-3.0；UI 参考——可伸缩+图钉版本列表、三段式主页、AnimatedCollapse 折叠配方；候选项见 §4 钉住注记）
- 外部：MCANextGen（../MCANextGen，已归档——java-discovery/能力探测/JVM 参数组/嵌入反面教材）；MCDArchive（E:\4k\MCDArchive，Avalonia/.NET——lang/*.json 外置语言自动发现+即时切换、关于页结构，见 §4 必落实注记）；FCL、Quanta-Craft-Launcher（Android JVM 管线参考）

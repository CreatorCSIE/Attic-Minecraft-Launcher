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
- [x] 开关实际落地 **3 个**（SettingToggle）：启动前检查文件完整性 `verifyClientJar` / 缺失自动补全 `autoRepairJar`（前者关则后者禁用+联动，betacraft 侧 repair=false 抛明确诊断）/ 启动后自动加入服务器（legacyfix `-Dlf.server=`，UI 采 serverInput 文本输入而非开关——收编契约悬空键 `levelServer` 为地址输入项）；**「启动后最小化启动器」「全屏启动」明示不搬**（前者涉主窗 IPC 超出本次范围，后者老 Applet 容器无此能力，见旧不适用项注记）
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
- [ ] **一期**：左栏「Mods」页（下载图标）——列表分组（`ModCategory[]/ModEntry[]`：full_name/version/info_file_url/website/autoupdate/last_modified，全量 GET 无分页，失败空态）+ 安装 = GET `info_file_url` 落 `versions/jsons/<full_name>.info`（jsons 监视器现成，落入即自动出现在自定义版本页/启动版本列表）+ **base-version rezip 合成链**（mod jar → `versions/mods/<name>.jar` 带 sha1 → 基座 jar 就绪 → 合并剥 `META-INF/*` 签名 → `versions/<name>.jar`；无合成则点 Play 给明确「缺基座合成」诊断错，不假可用）+ `autoupdate` 启动期刷新 info（失败留备份可离线）
- [ ] **二期**：`launch-method-link` wrapper jar 挂载链（GET `{hash,url}` → 比对 `launcher/launch-methods/` → 下载 → classpath 挂载 + wrap 参数启动）——涉及启动装配模型改变（现主类数据表是绕开 wrapper 的原生复刻，mods 的第三方 wrapper 无法原生复刻，必须真实挂载）；`launchMethodsDir()` 目录 helper 已在、无消费方，即此缺口
- [ ] 复刻时修 v1 三缺陷：`loadMods()` 追加不清空静态 list、Load 按钮文案笔误、mod jar 下载无 sha1 前置校验（.info 层）

**Force Update → 进实例设置（搬语义不搬缺陷）**：v1 实况 = 会话级全局静态字段（不持久化、放在实例设置对话框属 UI 错位、`readyAddons` 收参未用）；有效覆盖仅 libs/natives 重装 + 无 sha1 版本 jar 强下。
- [ ] 实例级持久布尔键 + **一次性生效**：勾选 → 下次启动跳过"本地存在即复用"（libs/natives/版本 jar 强制重下重解压）→ 启动后自动复位取消；落基本设置 card

**Intel 双件套（调研澄清：v1 开关与 legacyfix 是两码事，都收）**
- [ ] v1 "Apply performance trick for Intel Graphics" = `-XX:HeapDumpPath=java.exe_minecraft.exe.heapdump`（仅 Windows，Java 5u7 时代驱动 workaround，v1 默认开）→ 忠实搬进基本设置（实例级布尔，成本一条 JVM 参数，现代驱动无害）
- [ ] legacyfix `-Dlf.intel`（`IntelGraphicsPatch`：glActiveTexture 前补 glClientActiveTexture，修老 Intel GPU 多纹理渲染错乱 b1.9–1.7.10，opt-in 默认关）→ 作 **addons 目录第 10 个实装项**（enable 族，现有注入链零改造）

**Discord RPC → 暂不实现（挂 Phase 6 愿望池）**：v1 = 游戏子进程 JVM 内 discord-rpc native 连本机 Discord IPC，展示"User/Version"；app id `939918927989973052` 为 Betacraft 注册物不可复用（需自注册开发者门户+传图）。若未来做：electron 主进程直连 `discord-ipc` 命名管道（纯 WebSocket，无需游戏侧注入），实例档案加 `RPC` 布尔键（v1 键集本有）即可。

**落实顺序（用户口径）**：设置页重写 → Force Update + Intel 双件套（蹭 addons 归置待办顺路做）→ Mods 页一期 → wrapper 二期 → Discord RPC 挂起。

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

- [ ] **Infdev 地图预览器（legacyfix VisualizerPatch，方案已调研定稿，用户决策：暂不实现）**：
  - 上游依据：`6ed9e82`（2026-10-13，v3 HEAD）新增 `VisualizerPatch`——opt-in 补丁，`-Dlf.visualizer` 存在即生效（`Patch.shouldApply` 走 Agent SETTINGS 的 `lf.*` 通道，与 `-Dlf.assetsDir` 等同源），把启动主类 `main()` 替换为反射调用 `VisualizerLauncher.launchPreviewApplet("net.minecraft.isom.IsomPreviewApplet")`；`VisualizerLauncher` 自建 AWT 窗口「Minecraft Infinite Map Visualizer」854×480，关窗 `System.exit(0)` 进程自退（**无需窗口看门狗**）。`reference/legacyfix` 已同步至 `6ed9e82`（顺带含 c0.0.15a 非 5565 端口补丁、LWJGL 3.1.3 方法补丁、ProxyPatch 增强 + version_data.json 新行）。
  - jar 供给：**免自编译**——CI nightly 构件 `https://nightly.link/betacraftuk/legacyfix/workflows/gradle/v3`（最新 `legacyfix-nightly-<run_id>.zip`，内含 shadow 胖 jar，version=`nightly-<run_id>`）；Release 26.8（2026-08-23）不含 visualizer，走 nightly 才有。落地通道二选一：① 端点/设置增 legacyfix 渠道（release/nightly），nightly 先经 GitHub API `actions/workflows/gradle.yml/runs?branch=v3&status=success` 解析最新 run → 构件名拼 `nightly.link/.../<name>.zip`（构件名含 run 号、每次 push 变化，索引页 `workflows/gradle/v3` 亦可解析）；② 手动把 nightly jar 覆盖数据根 `launcher/legacyfix-*.jar`（`ensureLegacyfix` 见文件已存在即跳过，零代码改动，先验证用）。
  - **2026-10-18 全链路实测（run `38431103449`，head=`6ed9e82`，最新成功 nightly）**：
    - 通道成立：nightly.link 免登录取回 `legacyfix-nightly-38431103449.zip` 1016350B，与 GitHub API `size_in_bytes` 逐字节一致（代理未改内容），zip 内即单个 shadow jar；`VisualizerPatch`/`VisualizerLauncher` 类在场（5 条目），Release 26.8 无 → "预览器必须走 nightly"前提坐实。
    - **DeAwtPatch.class 哈希漂移**：nightly=`d1003d49a286c48696992427f63ac9d4efa105700c4fbf3b3d0d0156ece3b7ef` ≠ release 钉版 `bcf09fe0...31b0e`（26.8 实测仍逐字节命中钉版表 → release 通道"下载即补丁"零维护；26.8 的 asset 自带 GitHub sha256 digest `d64cd29a...`，实测吻合，可作下载完整性校验增强）；漂移源=上游 `0394721`（2026-10-03，"MP quick join pre-1.6, c0.0.15a fix"）动过 DeAwtPatch.java——该文件近半年 5 次提交（≈月频），nightly 移动目标下人工追钉哈希不现实。
    - **补丁本体对 nightly 兼容**：锚点句仍恰 1 次、upstream 未合并 setLocation（补丁仍必要）；`patchDeawtClassBytes` 直喂 nightly 的 class 字节 → OK（14528→14593，delta=65=setLocation 句长），再入护栏正常返回 null。
    - **门两级定稿**：release jar 走钉版哈希表（语义保险）；nightly jar 走**结构校验门**——锚点恰 1 次 + 常量池唯一命中 + 回写后重读自检（本就是补丁函数硬前置），每次应用打印 class sha256 供抽检、永不静默；上游若改掉锚点句，结构门自然 skip+显式诊断、不阻断启动。`applyLegacyfixDeawtPatch(jarPath, pins)` 注入点已预留，nightly 分支传结构模式即可。
  - 版本门控（数据驱动，戒律 #1）：本地 jar 含 `net/minecraft/isom/IsomPreviewApplet.class` 才暴露入口——复用 `listZipEntryNames`，同 `probeIndevEntry` 配方。官方 docs 范围：inf-20100616 引入、a1.2.0 移除、b1.3 起损坏（本次 reimplementation 即修复）；class 实际残存至 b1.7.3 jar（实测本地已装 jar 仅 b1.7.3 含该类）。
  - 启动链路：`LaunchContext` 增 `visualizer?: boolean` → jvmArgs 注入 `-Dlf.visualizer`（固定组位置建议 levelServer/assetsDir/assetIndex 之后、javaagent 之前，进 contract.md §2.6 钉序）；UI 入口 = 主页「| ≡」菜单「以地图预览器启动」；契约基线夹具不变，`launch.test.js` 补注入/不注入两条断言。
  - 验收路径：先跑 b1.7.3（已装且含类）看俯视图渲染存档；注意其主类为 launchwrapper `Launch`，补丁 hook 的是 `sun.java.command` 首 token（=Launch），实机为准；代理/皮肤/资产链路不变。
- [ ] **nightly.link 免登录下载 Actions artifacts（通用构件通道，visualizer jar 供给的前置能力）**：GitHub 官方 artifact 下载需登录（`/suites/.../artifacts/<id>` 直链 403，API `download-artifact` 需 token），而 nightly.link 把同一构件代理为**公开免登录直链**——`https://nightly.link/<owner>/<repo>/workflows/<workflow>/<branch>/<artifact-name>.zip`（已实测：legacyfix v3 最新构件可匿名取回，zip 内即 `build/libs` 原样内容）。要点：① 索引页 `workflows/<wf>/<branch>` 列出最新构件名（构件名含 run 号、每次 push 变化），程序化取回=先抓索引页或 GitHub API runs 列表解析构件名，再拼 zip URL；② nightly.link 页内的 Azure blob "ephemeral direct link" <1 分钟过期，**不可缓存**，稳定入口只有 nightly.link zip URL（302 现签）；③ 属第三方代理服务（开源 roidelity/nightly.link），有可用性/时效风险（仅保留近期 run），作 fallback 通道而非唯一供给面，与 Release 渠道并存（风险 #1 同族：端点全配置化）。适用面：legacyfix nightly jar、后续任何"上游只发 CI 构件、不发 Release"的依赖供给。
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
- `reference/BlockHelm-Launcher`（WPF/.NET，GPL-3.0；UI 参考——可伸缩+图钉版本列表、三段式主页、AnimatedCollapse 折叠配方；候选项见 §4 钉住注记）
- 外部：MCANextGen（../MCANextGen，已归档——java-discovery/能力探测/JVM 参数组/嵌入反面教材）；MCDArchive（E:\4k\MCDArchive，Avalonia/.NET——lang/*.json 外置语言自动发现+即时切换、关于页结构，见 §4 必落实注记）；FCL、Quanta-Craft-Launcher（Android JVM 管线参考）

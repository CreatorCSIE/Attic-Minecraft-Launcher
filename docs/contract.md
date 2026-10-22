# Attic 契约文档（@attic/core-spec）

> 唯一真相在 [packages/core-spec/src](../packages/core-spec/src)。本文解释形状从何而来、双壳如何镜像、夹具如何消费。
> 状态：Phase 1 定稿。Phase 2（TS 运行时）与 Phase 4（Rust core）实现时若需改契约，必须改 core-spec + 本文 + 夹具三处并过 CI。

## 1. 设计戒律在契约中的落点

| 戒律 | 契约落点 |
| --- | --- |
| 数据驱动（无 `if (version == …)`） | 版本差异全部表达为 `VersionJson.betacraft` 扩展字段与 `agentMount` 决策表；`LaunchConfig` 是拼装终点，壳拿到即可 spawn，不再判断版本 |
| 契约唯一 | 通道名/事件名/payload 只在 `ipc.ts` 定义；Rust 侧按 §5 镜像规则一一对应 |
| 机密不出宿主 | `Account`（含 token）仅存在于主进程/Rust core；渲染侧只见 `AccountView` |

## 2. 领域类型

### 2.1 Account（[account.ts](../packages/core-spec/src/account.ts)）

`MicrosoftAccount | OfflineAccount`，判别字段 `type`。

- 事实来源：Betacraft v1 `uk.betacraft.auth`——MS 流程产出 `local_uuid + username + sessionid(token:accessToken:profileId)`（`MicrosoftAuth.java`），离线走 `NoAuth(username, uuid)`。
- `accessToken`/`refreshToken`/`tokenExpiresAt`/`profileId` 为宿主侧字段；刷新策略（v2 已知坑：token 过期未刷新导致皮肤/验证失效）在 Phase 2 的 runtime 实现。

### 2.2 VersionRef / VersionManifest（[version.ts](../packages/core-spec/src/version.ts)）

清单条目轻量形状。事实来源：Betacraft v1 `version_list.txt`（反引号分隔行，字段 0 为 id）+ `.info` 属性文件（`release-date`/`compile-date`/`other-name`）。`era` 供 Phase 3 年代分层 UI；`installed` 由本地扫描填充（真相源 = `versions/<id>.jar` 实存）。`custom` 按 v1 语义标记自定义版本：裸 jar（有 jar 无 `.info`）或 `.info` 声明 `custom=true`；custom 版本的 `.info` 归用户所有，启动时跳过远端重下/覆盖（v1 Launcher.java L412/L432 豁免），裸 jar 由类检测（`wrapperDetector.ts`，v1 WrapperDetector 移植，4k 除外——4k 走 `--appletClass M` 显式数据路径）合成启动元数据，检测失败显式报错（Error 7 语义）。取数策略 = **stale-while-revalidate**（2026-10-22 修「列表首帧空窗」）：`launcher/version_list.json` 缓存在即返 + 后台刷新落盘（最终一致，下一次拉取生效；UI 每次展开重拉，钉开态滞留一帧）；缓存缺席才 await 网络。需要「刷新完成」语义的门禁方（installMod 官方同名拒绝，用户拍板）走运行时内部直网面，不经本缓存即返路径。v1 无清单缓存机制（`version_list.txt` 每次全量远取、首帧空列表直到惰性加载），本策略为 attic 改进。

### 2.3 VersionJson（Mojang 兼容 + Betacraft 扩展）

- Mojang 兼容段：`mainClass`、`minecraftArguments`（远古单行式）、`arguments`（现代结构化，解析器须容忍两者共存/缺失）、`libraries`、`assets`/`assetIndex`、`downloads.client`/顶层 `jar`、`javaVersion`、`inheritsFrom`。
- Betacraft 扩展段 `betacraft`：字段集取自 v1 `ReleaseJson.java` 实测解析——`proxyArgs`（默认 `-Dhttp.proxyHost=betacraft.uk -Dhttp.proxyPort=11702`；v1 默认值缺端口为已知缺陷，custom 版未配置 proxy-args 时由本默认值兜底）、`launchMethod`、`launchMethodLink`、`protocolVersion`、`baseVersion`、`custom`、`fileVer`，外加本契约新增的 `agentMount`。
- 除 `id` 外全部可选：远古 JSON 缺字段是常态，"缺什么补什么"是 Phase 2 解析器职责，契约只声明形状。

### 2.4 AgentMount（legacyfix 挂载决策表）

```ts
{ form: 'javaagent' | 'coremod' | 'mod', path, appliesFrom, appliesTo?, quirk? }
```

- 形态判定事实（legacyfix README）：Vanilla/Risugami ModLoader/Forge ≤1.3 → `javaagent`；Forge 1.4 → `coremod`（落位 `<gameDir>/coremods/`）；Forge ≥1.5 / Fabric 系 → `mod`（落位 `<gameDir>/mods/`）。
- `javaagent` 展开规则（与 Betacraft v1 `Launcher.java` 一致）：`-javaagent:<dataDir>/<path>=<gameDir>`。
- `appliesFrom`/`appliesTo` 是版本 id 字符串，**区间判定属运行时**（需要清单顺序/编译日期知识），契约不做比较语义。
- 获取通道：`path` 相对启动器数据目录；jar 本体来自 legacyfix GitHub Release（端点可配置，风险 #1/#8），下载与 sha1 校验走统一下载事件（§3）。

### 2.5 JavaInstall / JavaDetectionReport（[java.ts](../packages/core-spec/src/java.ts)）

移植 MCANextGen `java/model.ts`，去掉 Node 类型（`platform: string`）。四级候选（`manual/env/registry/directory/path`）+ `-XshowSettings:properties -version` 真实验证 + 64 位 Java 8 优先、32 位兜底（`usedFallback`）。失败面板需要全量候选与原因，故报告含 `installs/failures/diagnostics/selection.reason`（风险 #7）。

### 2.6 LaunchConfig（[launch.ts](../packages/core-spec/src/launch.ts)）

可执行的最小完备描述：`javaPath/gameDir/assetsDir/mainClass/classpath/jvmArgs/gameArgs/agentMount/maxMemoryMb/minMemoryMb?`。
不变量（由夹具固化，见 §4）：

1. `agentMount` 中 `javaagent` 条数 == `jvmArgs` 中 `-javaagent:` 条数，且逐条展开为 `-javaagent:<dataDir>/<path>=<gameDir>`；
2. `coremod`/`mod` 形态不产生任何 `-javaagent:` 参数（文件落位在 spawn 前由运行时完成）；
3. `jvmArgs` 含 `-Xmx<maxMemoryMb>m`；
4. `classpath[0]` 是版本 jar（`<dataDir>/versions/<id>.jar`，v1 平铺布局）；其余条目为 `bin/` 库池（整目录上 classpath，v1 `Wrapper.loadJars` 语义，清单由运行时注入）；
5. `gameArgs[0]` 是用户名；
6. `betacraft.proxyArgs` 全量进 `jvmArgs`。

`jvmArgs` 固定组（顺序即拼装顺序）：intelFix `-XX:HeapDumpPath=java.exe_minecraft.exe.heapdump`（仅 `context.intelFix=true`，即 win32 门控 + 实例键非 false——v1 Launcher.java L576-578 紧跟 javapath 的首位语义）→ `-Xmx`（+可选 `-Xms`）→ 全局 `jvmArgs`（`AppSettings.jvmArgs` 空白分隔逐 token）→ 实例 `launchArgs` 空白分隔逐 token 注入（v1 语义：重复 `-Xmx` JVM 取后者，实例覆盖全局，全局居中）→ 实例 addons `-Dlf.*` 目录映射 →（一次性 `LaunchRequest.visualizer`：补注 `-Dlf.visualizer`，档案已含 visualizer 时不重复）→ `-Djava.util.Arrays.useLegacyMergeSort=true` → `-Dhttp.nonProxyHosts=api.betacraft.uk|files.betacraft.uk|checkip.amazonaws.com|textures.minecraft.net` → LWJGL2 natives 两参（`org.lwjgl.librarypath`/`net.java.games.input.librarypath` = `<dataDir>/bin/natives`）→ `proxyArgs` → `-Dlf.proxy.levelServer=<AppSettings.levelServer>`（仅设置里有值时注入，覆盖 `gameDir/legacyfix/level-server.txt`）→ `-Dlf.version=<versionJson.id>`（全版本无条件注入；legacyfix 的版本等值补丁如 `Classic15aServerPortPatch.shouldApply` 判 `lf.version=="c0.0.15a"`，决策在 `Agent.premain` 的 Patcher.apply——早于 `--version` 解析与窗口标题探测两条晚到通道，`-D` 系统属性经 Agent 静态块收集是唯一赶得上决策点的通道，c0.0.15a 端口补丁不中事故根因）→ `javaagent` 展开 → 请求侧 `extraJvmArgs`。（曾有的 `-Dsun.java2d.dpiaware=false` 已证伪摘除——该 Oracle JDK8 扩展属性只影响 Java2D 渲染缩放，对 LWJGL 原生窗坐标无作用。）

Applet 容器（主类 `AppletLauncher`）的 `gameArgs` 末尾追加 `--width <w> --height <h>`（实例值，v1 缺省 854×480；`AppletFrame.java` 读取，缺省兜底 640×480）。非 Applet 版本窗口由 LWJGL/DeAwt 自管，不注入。

legacyfix jar 原位补丁（窗口偏右下最小修复，不属启动命令行）：`ensureLegacyfix` 落位后对 `<root>/legacyfix/*.jar` 幂等应用 DeAwtPatch 常量池补丁——把 DeAwtPatch.class 折叠 javassist 源串（Display.setParent 替换体）中的 `setDisplayMode(new DisplayMode(w, h));` 改写为追加 `Display.setLocation(frame.getX(), frame.getY());`（本机 LWJGL 2.9.0 jar javap 实锤：`setLocation` 无条件写静态 x/y，`getWindowX/Y` 仅在 x==−1 才走 `(initial_mode − current_mode)/2` 混源居中；DeAWT 替换体从不设 parent Canvas，故建窗时坐标取我们写入的值）。安全门：DeAwtPatch.class 明文 SHA256 必须在钉版表内、锚点全文唯一，否则原 jar 保留不动（applet 容器维持原偏移）；补丁失败永不阻断启动，仅 `[attic-runtime]` 诊断。jar 必须无签名（实测 legacyfix Release 构件无 .SF 条目）。

`CrashCategory`（v0 分类器枚举）：`none/java-missing/out-of-memory/gl-init/lwjgl-native/unsatisfied-link/unknown`。

`LaunchRequest.testLaunch`（≡ 菜单"测试启动"）：宿主在 `attic:launch` 成功后把启动前后日志逐行落盘 `<root>/launcher/logs/test-launch-<ISO>.log`（启动器侧头行：时间戳/版本/java/gameDir/命令行——**accessToken 已脱敏**：命令行与游戏输出行里的 token 一律替换为 `[censored sessionid]` 再写盘，v1 Launcher.java L659/L685 同款；离线短 token `'0'` 不替换，避免误伤通用子串；随后游戏 stdout/stderr 全量；进程退出追加退出行并退订）。日志落盘归 runtime（不触窗）；独立控制台窗由 UI 侧随后调用 `attic:window:console` 唤起（普通启动受 `consoleOnLaunch` 开关约束，testLaunch 恒弹）。普通启动缺省不写；`AppSettings.diagnosticLog=true` 时普通启动同样落盘（文件名前缀 `launch-`）。

`LaunchRequest.visualizer`（≡ 菜单"启动无限地图可视化器"，探针驱动的**动作项**）：true = 本次启动在 addons 目录映射同位补注 `-Dlf.visualizer`，**不写实例档案**、一次性生效；UI 侧可点前置 = `attic:version:probe-class` 命中选中版本 jar 的 `probeClass` 条目 + 常规可启动。档案 addons 仍可携带 `visualizer` id（常开语义，装配器去重不双注）。legacyfix 侧已生效——Release 26.10 含 `VisualizerPatch`/`VisualizerLauncher`（2026-10-22 钉版升级；nightly 供给路线随之废除，实机验收见 plan.md Phase 6 条目）。

### 2.7 AppSettings / InstanceView（[settings.ts](../packages/core-spec/src/settings.ts)，Phase 3）

渲染侧只通过契约读写设置/实例，绝不直接碰 `launcher.settings` / `instances/*.txt`（戒律 #1：设置是数据）。

- `AppSettings`：`javaPath?`、`maxMemoryMb?`、`memoryMode?`（`auto|manual`，缺省 manual）、`theme?`（`dark|light|system`）、`language?`（i18n locale 键，渲染侧热切换，单一真相；localStorage 仅 bootstrap 缓存）、`jvmArgs?`（全局 JVM 参数，组序见 §2.6）、`checkIntegrity?`/`fixMissing?`/`minimizeOnLaunch?`/`diagnosticLog?`/`consoleOnLaunch?`（布尔三态：落盘 `'true'/'false'`，缺键 = undefined = 消费端缺省——`checkIntegrity`/`fixMissing`/`consoleOnLaunch` 缺省 true，`minimizeOnLaunch`/`diagnosticLog` 缺省 false；`consoleOnLaunch` = 启动成功后自动唤起独立控制台窗（v1「Game log」开关的全局化转置，testLaunch 不受约束恒弹））、`rootOverride?`（数据根更换：下次启动应用后由宿主从平台默认根 peek，portable/env 优先）、`levelServer?`（LegacyFix 关卡存档模式：`local`/URL；有值时直通 `-Dlf.proxy.levelServer`，抑制一次性对话框并覆盖陈旧 txt）、`endpoints?`。落盘键同名 + `endpoint.*`；`setSettings` 合并写回、未知键保留（v1 遗留键不丢）。~~`username?`~~（2026-10-22 拍板删除：账户体系落地后零消费方的孤儿设置，启动玩家名恒取 `account.name`；文件里既有的 v1 `username` 键退出 managed 集后按未知键纪律原样保留、不读写不清除）。
- 派生语义（无独立契约键）：Java 模式 = `javaPath` 有值为手动、空为自动（自动 → 手动由 UI 固化当前选中项）；堆内存三级优先 = `LaunchRequest.maxMemoryMb` > `memoryMode=auto` 宿主估算（`round(总×0.4)` 取 128 步长夹 `[512,2048]`，取不到回落 1024）> `maxMemoryMb` 定值 > 1024；UI 展示拷贝与宿主估算公式改动须双侧同步。
- `EndpointOverrides`：全为可序列化的纯字符串（`versionList`/`filesBase`/`legacyfixRelease`/`zuluMetadata`/`mojangManifest`/`modsList`）。函数形态的 `versionJson(id)`/`assetIndex(id)` 由 `filesBase` 在 runtime 侧派生（`endpointsFromOverrides`），契约层不携带可调用形状；`modsList` 缺省 = `http://api.betacraft.uk/getmods.jsp`（v1 `ModsRepository.java` 同源端点）。端点属构造级配置——改动在下次启动应用后生效。
- `InstanceView`：对齐 v1 Instance Settings 可编辑集 `{ name, version, gameDir?, launchArgs?, width?, height?, javaPath?, addons?, intelFix?, forceUpdate? }`。`gameDir` 缺省 = 宿主派生 `root/<实例名>`（v1 `Instance.newInstance`；已存在实例保留其落位）；`launchArgs`/`width`/`height` 缺省 = v1 `newInstance` 值（`-Xmx1G`、854×480，`loadInstance` 以缺省为底、属性覆盖）。版本是实例属性——launch 时选中版本写回实例（v1 `InstanceSettings` 语义：同实例切版本存档共享）；回写落在宿主 `launch()` 首个 await 前的同步段——UI 发起 launch 后立即重拉清单（IPC FIFO），新实例/切版本点击即见，启动失败也已落盘（幂等：同版本不重写）。`LaunchRequest.instanceId?` 缺省 = `default instance`（v1 首启自动建档）。
- `addons`（v1 同名档案键 = 逗号分隔；视图数组、宿主序列化）：目录 `INSTANCE_ADDONS` 数据驱动，`prop/mode` 映射 legacyfix `-Dlf.*`（enable=勾选注入 / disable=取消注入）。三态：无键（老档案）= 零注入（legacyfix 自身缺省）；空串 = 显式全关；数组 = 勾选集。`uiSection` 仅决定渲染归属（`basic`=实例页基本设置 card：vsync/proxy/skins/server-auth；缺省 `addons`=Addons card；`launchmenu`=启动页「≡」菜单：visualizer——**动作项**，点击 = `LaunchRequest.visualizer` 一次性启动、不读写档案），注入顺序按目录序。`probeClass`（launchmenu 项）= 可点前置：`attic:version:probe-class` 探测选中版本本地 jar 条目。visualizer 的 legacyfix 侧生效待 nightly（用户拍板：注入链保留、功能暂缓）。`demo`（v1 wrapper jar 族首个转正项）：legacyfix 原生 `-Dlf.demo` 即等价开关（`GameArgs.isDemo`；applet 参数注 `demo=true`、1.6 快照转 `--demo`、配套 BetaAntiPiracyHandler 回 400），v1 官方生效区间 12w16a–1.5.2，区间外属性无感。
- `intelFix`（v1 同名键，缺键 = true）：Windows 启动注入 `-XX:HeapDumpPath=java.exe_minecraft.exe.heapdump`（v1 首位语义，§2.6）；非 win32 恒不注入（门控在宿主 buildContext，拼装器保持平台中性）。`forceUpdate`（Attic 扩展键，v1 为全局 static 不落档案；缺键 = false）：启动下载编排旁路 jar/库/资产的「已存在即复用」检查重下（`.info` 的 custom 豁免不动）。两键均只在偏离缺省时落档案键。

### 2.8 Mods 仓库（一期 = Betacraft 单源）（[mods.ts](../packages/core-spec/src/mods.ts)）

事实来源：v1 `ModsRepository.java`（`getmods.jsp` 返回 JSON `ModCategory[]`，条目 5 字段 `full_name/version/info_file_url/website/autoupdate`）+ `Launcher.java` L409-429（autoupdate 消费）/ L793-876（mod jar → 基座合成）。类型面：`ModEntryRaw/ModCategoryRaw`（宿主解析产物，上游坏条目/坏分类剔除——`mods=null` 整类剔除修 v1 NPE，顶层非数组显式抛错不静默出半截列表）；`ModEntryView/ModCategoryView`（宿主附加 `installed` = `versions/jsons/<full_name>.info` 实存，不安全 id 恒 false 不触文件系统）；`ModInstallRequest`（UI 从列表项原样回传，宿主不复用渲染侧未校验字段）。

**安装语义（v1 Load 按钮 = saveVersions 的转写）**：只下载 `.info` 落 `versions/jsons/<id>.info`（tmp+rename 原子写 + 内容样貌校验，失败旧文件不动——替代 v1 backup.tmp 固定名互踩），并登记 `launcher/mods.json` `{infoUrl, autoupdate, installedAt}`；jar 与合成延迟到启动期（见下方「启动期语义」）。门禁：id 安全规则（同 CUSTOM 通道）、下载 URL 仅 http(s)、与官方版本清单同名拒绝安装（先联网刷清单缓存再判，v1 同名踩踏修复）；不写实例选中版本（v1 顺带改 `currentInstance.version` 的行为不照抄——只安装不动实例，用户拍板）。Mods 页无卸载钮（用户拍板），唯一删除途径 = 自定义版本页：mod 的 `.info`（含 `base-version`）落入 `listCustomVersions`（打 `mod` 标、右栏只读），该页删除联动清 `launcher/mods.json` 登记（防幽灵条目按登记 URL 复活），UI 删除 mod 项成功后联动重拉 Mods 列表（installed 徽标即时恢复「下载」）。`base-version` 为托管判型键：`saveCustomVersionInfo` 拒绝经编辑器写入（防普通自定义版本被误打标永久只读），UI 表单不提供该字段。

**启动期语义**：`refreshVersionInfo` 见登记 → 只按登记 `infoUrl` 刷新（autoupdate=false 且本地在位不联网；失败留旧文件离线启动；本地缺失且刷新失败 = 显式报错，修 v1 离线误路由官方 URL + 静默假可用）→ `ensureModJar`（`versions/mods/<id>.jar` 缓存，sha1 强制：`.info` 缺 sha1 且校验开启 = 拒绝无锚点下载；命中复用/不符重下/force 恒重下）→ 基座 `.info`/jar/libraries/assets 全按基座 → 每次启动重合成 `versions/<id>.jar`（基座条目在前、mod 同名覆盖；剥 `META-INF` 直接子级 `*.SF/*.DSA/*.RSA/*.EC`，保留 MANIFEST 与嵌套资源——修 v1 陈旧合成 jar 失配与过宽剥离）。mod 缺失字段继承基座（mainClass/launchMethod/assets/libraries 等；agentMount 区间判定用 baseVersion）。明示不修：依赖 `launch-method-link` 外部 wrapper 的 mod 属二期；`.info` 走 http 明文且无哈希锚点为上游继承性残余（jar 侧已由 sha1 强制缓解）。

## 3. IPC 通道与事件

### 请求通道（渲染 → 宿主，invoke/handle 或 command）

| 通道 | 请求 | 响应 |
| --- | --- | --- |
| `attic:ping` | — | `IpcResult<string>` |
| `attic:versions:list` | — | `IpcResult<VersionRef[]>` |
| `attic:versions:json` | `versionId: string` | `IpcResult<VersionJson>` |
| `attic:version:probe-class` | `versionId: string, className: string` | `IpcResult<boolean>`（本地 client jar zip 条目探测（如 `net/minecraft/isom/IsomPreviewApplet.class`）：启动页「≡」菜单 launchmenu 项启用判定。jar 未下载/损坏/无条目=false；宿主按 jar 路径+mtime 缓存条目清单。Rust 侧镜像：`versions/<id>.jar` 中央目录读条目名，同一语义） |
| `attic:launch:dry-run` | `LaunchRequest` | `IpcResult<LaunchConfig>` |
| `attic:launch` | `LaunchRequest` | `IpcResult<GameSession>` |
| `attic:kill` | — | `IpcResult<GameExit>` |
| `attic:status` | — | `IpcResult<GameStatus>` |
| `attic:java:detect` | — | `IpcResult<JavaDetectionReport>` |
| `attic:accounts:list` | — | `IpcResult<AccountView[]>`（可为空：无默认账户回落，空列表时 UI 禁用启动） |
| `attic:accounts:add` | `name: string` | `IpcResult<AccountView>`（离线账户；MC 规则 3-16 位字母/数字/下划线校验，同名幂等返回既有。微软账户无此通道=占位） |
| `attic:accounts:remove` | `id: string` | `IpcResult<void>`（可移除至空，无默认账户回落） |
| `attic:accounts:rename` | `id: string, name: string` | `IpcResult<AccountView>`（仅离线账户；MC 规则校验，同名幂等、与他名冲突报错；离线 UUID 随新名重生成，返回视图含新 id） |
| `attic:settings:get` | — | `IpcResult<AppSettings>` |
| `attic:settings:set` | `AppSettings` | `IpcResult<AppSettings>`（保存后的视图） |
| `attic:instances:list` | — | `IpcResult<InstanceView[]>` |
| `attic:instances:save` | `InstanceView` | `IpcResult<InstanceView>` |
| `attic:window:control` | `WindowAction`（`minimize` \| `toggle-maximize` \| `close`） | `IpcResult<void>`（无边距窗顶栏三键；`toggle-maximize` 由宿主在最大化/还原间切换） |
| `attic:window:console` | — | `IpcResult<void>`（独立控制台窗口；v1 语义：MC 日志独立窗，与主页解耦。每次调用新建窗口并绑定当前会话 pid（`?window=console&pid=`），旧控制台不复用；ConsolePanel 按 pid 过滤本会话输出。唤起时机归 UI 侧：普通启动受全局开关 `consoleOnLaunch`（缺省开）约束，testLaunch 恒弹） |
| `attic:game:backlog` | `pid: number` | `IpcResult<GameBacklog{lines,exit,truncated}>`（控制台 backlog 补拉——丢首批日志的竞态根因修复：独立控制台窗挂载订阅前，spawn 瞬间的早期输出（LegacyFix premain 等）已广播完毕，实时事件面永远收不到。宿主按 pid 缓存会话输出（盖 seq 戳，环形封顶 1MB、最多 4 个会话）+ 退出事件；新窗**先订阅后补拉**，按 seq 去重有序插回；游戏秒退时顺带恢复已错过的 exit（崩溃摘要卡不空窗）。宿主未实现=错误返回，UI 静默降级为纯实时流） |
| `attic:custom:list` | — | `IpcResult<CustomVersionView[]>`（custom 项 + Mods 托管项：`.info` custom=true=已配置 / 裸 jar=未配置 / `.info` 含 base-version=模组版本（`mod:true`，已配置态但右栏只读）；Betacraft 官方版本不落入——**官方清单缓存 id 命中即官方，优先于本地 custom=true 残留声明**（inf-20100227-1433 实案，裸 jar 与已配置两分支同源排除），`importCustomJar` 同源拒绝官方 id） |
| `attic:custom:info` | `id: string` | `IpcResult<CustomInfoView>`（官方清单 id 直接拒绝；mod 的 `.info`（base-version）可读并打 `mod:true`（右栏只读）；已配置回 `.info` 原始 props；未配置裸 jar 附 `detectLaunchMethod` 建议——v1 检测名经 `canonicalLaunchMethod` 归一为官方值，必属 `launchMethods` 键集，表内无合法值（custom/1.6）不给建议；`launchMethods` 为合法键集，UI 下拉零硬编码） |
| `attic:custom:info:save` | `id: string, props: Record<string,string>` | `IpcResult<CustomVersionView>`（官方清单 id 直接拒绝；Mods 托管的模组版本（`.info` 含 base-version）拒绝编辑——autoupdate 会整文件重写，编辑必丢；props 携带非空 `base-version` 同样拒绝（托管判型键禁用户写入）；`launch-method` 必填；其余字段选填，留空落盘为 `key=` 空值段；强制 `custom=true`；launch-method 不在主类表内时必须显式给 main-class，否则报错） |
| `attic:custom:import-jar` | — | `IpcResult<CustomVersionView \| null>`（宿主弹原生文件对话框；取消=`null`；选中复制为 `versions/<id>.jar`，id=文件名去扩展名，同名报错不覆盖，落裸 jar=未配置态） |
| `attic:custom:remove` | `id: string` | `IpcResult<void>`（jar 与 `.info` 一并移除，mod 项联动清 `launcher/mods.json` 登记；门禁=listCustomVersions 成员判定，官方版本/不存在显式报错；UI 删除须经确认弹窗，本通道不做二次确认） |
| `attic:mods:list` | — | `IpcResult<ModCategoryView[]>`（Betacraft 单源仓库现拉现发，无进程内缓存——v1「追加不清空/永不刷新」修复；`installed` = `.info` 实存；解析防御见 §2.8） |
| `attic:mods:install` | `ModInstallRequest` | `IpcResult<void>`（只下 `.info`：id 安全 + http(s) 白名单 + 官方同名拒绝三道门禁；tmp+rename 原子写 + 登记 `launcher/mods.json`；jar 与基座合成延迟到启动期，见 §2.8） |
| `attic:sys:info` | — | `IpcResult<SystemInfo>`（宿主快照单通道：`launcherVersion/platform/dataRoot/logsDir/totalMemMb/freeMemMb`；版本=壳注入（runtime 构造参数，缺省 0.0.0），内存=os 总量/空闲 MB 取整） |
| `attic:shell:open-dir` | `SpecialDir`（`data-root` \| `logs-dir`） | `IpcResult<void>`（宿主白名单枚举解析目录后 `shell.openPath`；logs 目录不存在时先建；不接受任意路径，防注入） |
| `attic:logs:clear` | — | `IpcResult<number>`（只删 `<root>/launcher/logs` 下 `*.log`，被占用文件跳过不报错；目录不存在返 0；返回删除数） |
| `attic:dialog:pick` | `PickTarget`（`java-executable` \| `directory`） | `IpcResult<string \| null>`（原生打开对话框；取消=`null`；java 过滤可执行文件，directory 允许新建目录） |
| `attic:shell:open-url` | `url: string` | `IpcResult<void>`（宿主 `new URL` 校验协议仅 http/https 后 `shell.openExternal`；渲染侧外链唯一出口） |

统一 `IpcResult<T>` 封装：错误以 `{ ok:false, error }` 返回，不跨进程抛异常。未实现通道返回 `error: 'not-implemented'`（Phase 1 桥面占位即此值）。

### 事件通道（宿主 → 渲染，推送）

| 事件 | payload | 说明 |
| --- | --- | --- |
| `attic:game:output` | `GameOutputEvent{stream,chunk,pid,seq?}` | stdout/stderr 流，UI 控制台面板消费；`seq` = electron 宿主广播时盖的会话内单调序号（backlog 补拉与实时事件去重用，见 `attic:game:backlog`；宿主不实现 backlog 时缺省） |
| `attic:game:exit` | `GameExitEvent{code,signal,crash,stoppedByUser?,pid,versionId}` | 退出 + 崩溃分类摘要；`stoppedByUser:true` = 用户主动停止（点停止按钮/关游戏窗触发看门狗），`crash` 恒为 null，控制台以中性条显示最后一行日志；外部 taskkill/自身异常退出仍照常报崩溃条 |
| `attic:download:progress` | `DownloadProgressEvent{item,id,phase,bytesDone,bytesTotal?,bytesPerSec?,error?}` | jar/资产/Java/legacyfix 统一形状；`phase`: `queued/transferring/verifying/done/failed` |
| `attic:custom:info-changed` | `CustomInfoChangedEvent{id}` | 宿主监视 `versions/jsons/` 目录：外部编辑/新建/删除 `.info`，按 id 去抖 250ms 合并后发射；自定义版本配置页实时刷新（未编辑自动重载，有未保存编辑则提示不覆盖；本方保存/删除的回声由 UI selfWrite 窗口吸收） |

## 4. 契约测试夹具

目录：[packages/core-spec/fixtures/](../packages/core-spec/fixtures)。每个夹具：

```jsonc
{ "name", "description",
  "context":     { "javaPath","gameDir","assetsDir","dataDir","username","uuid","accessToken","maxMemoryMb",
                    "binPool" /* 注入的 bin/ 库池绝对路径清单 */, "versionOrder" /* 年代序（编译日期升序）的版本 id 数组，agentMount 区间判定用；上游清单本身乱序，不可直接用其行序 */ },
  "versionJson": { /* VersionJson 输入 */ },
  "expected":    { /* LaunchConfig 期望输出 */ } }
```

现有 4 个夹具覆盖三形态：`c2.0-javaagent`、`b1.7.3-javaagent`（占位符展开 + 代理参数）、`1.4.7-forge-coremod`、`1.5.2-forge-mod`。

- **TS 侧**：[tests/contract.test.js](../packages/core-spec/tests/contract.test.js)（`node --test`）断言形状 + §2.6 不变量。Phase 2 起，runtime 的 LaunchConfig 拼装器必须对同一组夹具产出 `expected`（行为断言替换形状断言）。
- **Rust 侧**（2026-10-22 口径修订）：拼装器不再有 Rust 第二实现（启动核心单一承载 = Node sidecar，见 §5 双壳接入模型），本组夹具的跨实现同绿闸门**收窄为契约镜像闸门**：`cargo test` 读 `tests/fixtures/ipc-channels.json` 比对 `src-tauri` 通道镜像；TS 侧 `fixtures:check` 保证 fixture 与 sidecar 导出表不漂移。
- 夹具路径为中性 POSIX 风格字符串；两实现都不得对路径做平台假设（拼装时原样透传即可）。

## 5. Rust 镜像规则（Phase 4 约束）

- 类型名一一对应（`LaunchConfig` → `struct LaunchConfig`），字段名保持 camelCase：serde 统一 `#[serde(rename_all = "camelCase")]`。
- 判别联合用 `#[serde(tag = "type", rename_all = "camelCase")]`（`Account`）；`AccountType`/`form`/`phase` 等字符串枚举用 `#[serde(rename_all = "camelCase")]`。
- 通道/事件常量镜像为 `src-tauri` 内同名 `pub const`，值必须与 `ipc.ts` 逐字节一致（契约测试含常量比对）。
- 可选字段用 `Option<T>` + `#[serde(skip_serializing_if = "Option::is_none")]`，缺省语义与 TS `?` 对齐。

### 双壳接入模型（Phase 4/5 脚手架落地）

三壳并立，UI 面（RendererBridge）唯一：

| 壳 | 核心承载 | 桥注入 | 定位 |
| --- | --- | --- | --- |
| `apps/electron` | 同进程直连 `AtticRuntime` | preload → `window.attic` | 开发参考实现 |
| `apps/electron-legacy` | 同上（esbuild 打包 = fetch 桥 + **同一份** `main.ts` 源码） | 同上 | Win7/8/8.1 兜底发布线（Electron 22 = Chromium 108 / Node 16.17，无自动更新） |
| `apps/tauri` | **Node sidecar 子进程**（`@attic/runtime` 门面） | UI `bridge/tauri.ts` 适配 `window.__TAURI__`（withGlobalTauri）→ Rust 命令 | 主发布线（Windows NSIS + updater 分轨） |

Tauri 线 Rust↔sidecar 线协议（stdio NDJSON，一行一帧；sidecar `src/server.ts`）：

- 请求 `{id:number, method:string, params:unknown[]}`；响应 `{id, result}` | `{id, error}`；事件推送 `{event, payload}`（无 id）。
- **错误以数据返回不跨进程抛**（IpcResult 语义的线协议形态）；`IpcResult` 封装由 Rust 壳完成（`{result|error}` → `{ok,value|error}`）。
- 通道切分：35 契约通道 = **28 sidecar 承接** + **7 宿主面**（`window:control / window:console / instances:open-dir / shell:open-dir / shell:open-url / dialog:pick / custom:import-jar`，Rust 直处理；sidecar 收到即防御拒绝）。宿主面拆步走 `attic:internal:*` 私有方法（`instance-game-dir / special-dir / import-jar / shutdown`：Rust「先拿路径/入参，再做宿主动作」）。
- 控制台 backlog（seq 盖戳 + 1MB 环形 + 4 会话）归属**壳层**：Electron 线在主进程、Tauri 线在 sidecar。
- 环境面：`ATTIC_LAUNCHER_VERSION`（Rust 注入包版本）；`ATTIC_SIDECAR_NODE / ATTIC_SIDECAR_ENTRY`（开发/调试逃生舱）；sidecar 解析次序 = env 覆盖 → 安装态（resource 目录 `sidecar/server.cjs` + 随行/PATH node）→ 开发态仓内 dist。

跨语言镜像闸门（戒律 #2 执行面）：`scripts/emit-contract-fixtures.mjs` 从 sidecar 导出表生成
`packages/core-spec/tests/fixtures/ipc-channels.json`；Rust `contract_tests`（cargo test）与
`fixtures:check`（CI）双向比对；Node16 API 锁 = `scripts/node16-api-gate.mjs`。

NSIS 定制结论（Phase 5 拍板）：**无需编译级定制**（官方预编译 makensis + 自带插件足够），
定制面 = 脚本层双钩：Tauri `nsis.installerHooks` → `src-tauri/windows/attic-checks.nsh`
（`NSIS_HOOK_PREINSTALL`：OS<Win10 拒装指路兜底构件 + 架构 guard；WebView2≥110 交
`minimumWebview2Version` + `embedBootstrapper`），electron-builder `nsis.include` →
`build/installer.nsh`（`customInit`：下限 Win7 SP1）。

## 6. 端点与版本数据流（Phase 2 预告）

`version_list → .info/VersionJson → jar/资产/库下载（事件 3）→ LaunchConfig 拼装（不变量 6 条）→ spawn`。所有上游 URL 经端点配置层重写（风险 #1），契约中的 URL 字段只是上游原值。

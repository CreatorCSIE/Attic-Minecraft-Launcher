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

清单条目轻量形状。事实来源：Betacraft v1 `version_list.txt`（反引号分隔行，字段 0 为 id）+ `.info` 属性文件（`release-date`/`compile-date`/`other-name`）。`era` 供 Phase 3 年代分层 UI；`installed` 由本地扫描填充。

### 2.3 VersionJson（Mojang 兼容 + Betacraft 扩展）

- Mojang 兼容段：`mainClass`、`minecraftArguments`（远古单行式）、`arguments`（现代结构化，解析器须容忍两者共存/缺失）、`libraries`、`assets`/`assetIndex`、`downloads.client`/顶层 `jar`、`javaVersion`、`inheritsFrom`。
- Betacraft 扩展段 `betacraft`：字段集取自 v1 `ReleaseJson.java` 实测解析——`proxyArgs`（默认 `-Dhttp.proxyHost=betacraft.uk`）、`launchMethod`、`launchMethodLink`、`protocolVersion`、`baseVersion`、`custom`、`fileVer`，外加本契约新增的 `agentMount`。
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

`jvmArgs` 固定组（顺序即拼装顺序）：`-Xmx`（+可选 `-Xms`）→ 实例 `launchArgs` 空白分隔逐 token 注入（v1 语义：重复 `-Xmx` JVM 取后者，实例覆盖全局）→ `-Djava.util.Arrays.useLegacyMergeSort=true` → `-Dhttp.nonProxyHosts=api.betacraft.uk|files.betacraft.uk|checkip.amazonaws.com` → LWJGL2 natives 两参（`org.lwjgl.librarypath`/`net.java.games.input.librarypath` = `<dataDir>/bin/natives`）→ `proxyArgs` → `-Dlf.proxy.levelServer=<AppSettings.levelServer>`（仅设置里有值时注入，覆盖 `gameDir/legacyfix/level-server.txt`）→ `javaagent` 展开 → 请求侧 `extraJvmArgs`。

Applet 容器（主类 `AppletLauncher`）的 `gameArgs` 末尾追加 `--width <w> --height <h>`（实例值，v1 缺省 854×480；`AppletFrame.java` 读取，缺省兜底 640×480）。非 Applet 版本窗口由 LWJGL/DeAwt 自管，不注入。

`CrashCategory`（v0 分类器枚举）：`none/java-missing/out-of-memory/gl-init/lwjgl-native/unsatisfied-link/unknown`。

`LaunchRequest.testLaunch`（≡ 菜单"测试启动"）：宿主在 `attic:launch` 成功后把启动前后日志逐行落盘 `<root>/launcher/logs/test-launch-<ISO>.log`（启动器侧头行：时间戳/版本/java/gameDir/完整命令行；随后游戏 stdout/stderr 全量；进程退出追加退出行并退订）。日志落盘归 runtime（不触窗）；独立控制台窗由 UI 侧随后调用 `attic:window:console` 唤起。普通启动不写此文件。

### 2.7 AppSettings / InstanceView（[settings.ts](../packages/core-spec/src/settings.ts)，Phase 3）

渲染侧只通过契约读写设置/实例，绝不直接碰 `launcher.settings` / `instances/*.txt`（戒律 #1：设置是数据）。

- `AppSettings`：`javaPath?`、`maxMemoryMb?`、`username?`、`theme?`（`dark|light|system`）、`levelServer?`（LegacyFix 关卡存档模式：`local`/URL；有值时直通 `-Dlf.proxy.levelServer`，抑制一次性对话框并覆盖陈旧 txt）、`endpoints?`。落盘键：`javaPath`/`maxMemoryMb`/`username`/`theme`/`levelServer` + `endpoint.*`；`setSettings` 合并写回、未知键保留（v1 遗留键不丢）。
- `EndpointOverrides`：全为可序列化的纯字符串（`versionList`/`filesBase`/`legacyfixRelease`/`zuluMetadata`/`mojangManifest`）。函数形态的 `versionJson(id)`/`assetIndex(id)` 由 `filesBase` 在 runtime 侧派生（`endpointsFromOverrides`），契约层不携带可调用形状。端点属构造级配置——改动在下次启动应用后生效。
- `InstanceView`：对齐 v1 Instance Settings 可编辑集 `{ name, version, gameDir?, launchArgs?, width?, height?, javaPath? }`。`gameDir` 缺省 = 宿主派生 `root/<实例名>`（v1 `Instance.newInstance`；已存在实例保留其落位）；`launchArgs`/`width`/`height` 缺省 = v1 `newInstance` 值（`-Xmx1G`、854×480，`loadInstance` 以缺省为底、属性覆盖）。版本是实例属性——launch 时选中版本写回实例（v1 `InstanceSettings` 语义：同实例切版本存档共享）。`LaunchRequest.instanceId?` 缺省 = `default instance`（v1 首启自动建档）。

## 3. IPC 通道与事件

### 请求通道（渲染 → 宿主，invoke/handle 或 command）

| 通道 | 请求 | 响应 |
| --- | --- | --- |
| `attic:ping` | — | `IpcResult<string>` |
| `attic:versions:list` | — | `IpcResult<VersionRef[]>` |
| `attic:versions:json` | `versionId: string` | `IpcResult<VersionJson>` |
| `attic:launch:dry-run` | `LaunchRequest` | `IpcResult<LaunchConfig>` |
| `attic:launch` | `LaunchRequest` | `IpcResult<GameSession>` |
| `attic:kill` | — | `IpcResult<GameExit>` |
| `attic:status` | — | `IpcResult<GameStatus>` |
| `attic:java:detect` | — | `IpcResult<JavaDetectionReport>` |
| `attic:accounts:list` | — | `IpcResult<AccountView[]>` |
| `attic:accounts:add` | `name: string` | `IpcResult<AccountView>`（离线账户；MC 规则 3-16 位字母/数字/下划线校验，同名幂等返回既有。微软账户无此通道=占位） |
| `attic:accounts:remove` | `id: string` | `IpcResult<void>`（移除至空时 `listAccounts` 回落默认离线 Player） |
| `attic:settings:get` | — | `IpcResult<AppSettings>` |
| `attic:settings:set` | `AppSettings` | `IpcResult<AppSettings>`（保存后的视图） |
| `attic:instances:list` | — | `IpcResult<InstanceView[]>` |
| `attic:instances:save` | `InstanceView` | `IpcResult<InstanceView>` |
| `attic:window:control` | `WindowAction`（`minimize` \| `toggle-maximize` \| `close`） | `IpcResult<void>`（无边距窗顶栏三键；`toggle-maximize` 由宿主在最大化/还原间切换） |
| `attic:window:console` | — | `IpcResult<void>`（打开/聚焦独立控制台窗口；v1 语义：MC 日志独立窗，与主页解耦。已存在则聚焦复用） |

统一 `IpcResult<T>` 封装：错误以 `{ ok:false, error }` 返回，不跨进程抛异常。未实现通道返回 `error: 'not-implemented'`（Phase 1 桥面占位即此值）。

### 事件通道（宿主 → 渲染，推送）

| 事件 | payload | 说明 |
| --- | --- | --- |
| `attic:game:output` | `GameOutputEvent{stream,chunk,pid}` | stdout/stderr 流，UI 控制台面板消费 |
| `attic:game:exit` | `GameExitEvent{code,signal,crash,pid,versionId}` | 退出 + 崩溃分类摘要 |
| `attic:download:progress` | `DownloadProgressEvent{item,id,phase,bytesDone,bytesTotal?,bytesPerSec?,error?}` | jar/资产/Java/legacyfix 统一形状；`phase`: `queued/transferring/verifying/done/failed` |

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
- **Rust 侧**：Phase 4 的 `cargo test` 读**同一目录**，serde 反序列化 `versionJson`/`context`，用 Rust 拼装器断言输出 == `expected`。双实现同绿进 CI 闸门（风险 #2）。
- 夹具路径为中性 POSIX 风格字符串；两实现都不得对路径做平台假设（拼装时原样透传即可）。

## 5. Rust 镜像规则（Phase 4 约束）

- 类型名一一对应（`LaunchConfig` → `struct LaunchConfig`），字段名保持 camelCase：serde 统一 `#[serde(rename_all = "camelCase")]`。
- 判别联合用 `#[serde(tag = "type", rename_all = "camelCase")]`（`Account`）；`AccountType`/`form`/`phase` 等字符串枚举用 `#[serde(rename_all = "camelCase")]`。
- 通道/事件常量镜像为 `src-tauri` 内同名 `pub const`，值必须与 `ipc.ts` 逐字节一致（契约测试含常量比对）。
- 可选字段用 `Option<T>` + `#[serde(skip_serializing_if = "Option::is_none")]`，缺省语义与 TS `?` 对齐。

## 6. 端点与版本数据流（Phase 2 预告）

`version_list → .info/VersionJson → jar/资产/库下载（事件 3）→ LaunchConfig 拼装（不变量 6 条）→ spawn`。所有上游 URL 经端点配置层重写（风险 #1），契约中的 URL 字段只是上游原值。

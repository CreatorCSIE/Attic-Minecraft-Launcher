//! Attic Tauri 壳（Phase 4 脚手架）。
//!
//! 接入模型（docs/contract.md「双壳接入模型」）：
//!   渲染层 --invoke--> Rust 命令 --(sidecar 通道)--> stdio NDJSON RPC --> Node sidecar(@attic/runtime)
//!                                                    --(宿主通道)--> Rust 直处理（窗控/对话框/外链/openPath）
//! 事件：sidecar 推送帧 {event,payload} --> Rust `app.emit` 原名转发 --> 渲染 `listen`。
//! IpcResult 封装在本壳完成（sidecar 的 {result|error} 是线协议形状，不是契约形状）。

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command as StdCommand, Stdio};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::oneshot;

/// 通道镜像（值域源头 = packages/core-spec ipc.ts；与 fixture 的等式由 contract_tests 把关，戒律 #2）。
pub mod channels {
    pub const ALL_CHANNELS: &[&str] = &[
        "attic:ping",
        "attic:versions:list",
        "attic:versions:json",
        "attic:version:probe-class",
        "attic:launch:dry-run",
        "attic:launch",
        "attic:kill",
        "attic:status",
        "attic:java:detect",
        "attic:accounts:list",
        "attic:accounts:add",
        "attic:accounts:remove",
        "attic:accounts:rename",
        "attic:settings:get",
        "attic:settings:set",
        "attic:instances:list",
        "attic:instances:save",
        "attic:instances:delete",
        "attic:instances:rename",
        "attic:instances:open-dir",
        "attic:window:control",
        "attic:window:console",
        "attic:game:backlog",
        "attic:custom:list",
        "attic:custom:info",
        "attic:custom:info:save",
        "attic:custom:import-jar",
        "attic:custom:remove",
        "attic:mods:list",
        "attic:mods:install",
        "attic:sys:info",
        "attic:shell:open-dir",
        "attic:logs:clear",
        "attic:dialog:pick",
        "attic:shell:open-url",
    ];
    /// 宿主面（Rust 直处理，sidecar 拒收）：镜像 sidecar HOST_ONLY_CHANNELS。
    pub const HOST_CHANNELS: &[&str] = &[
        "attic:window:control",
        "attic:window:console",
        "attic:instances:open-dir",
        "attic:shell:open-dir",
        "attic:shell:open-url",
        "attic:dialog:pick",
        "attic:custom:import-jar",
    ];
    /// sidecar 承接面 = ALL - HOST（ipc_forward 白名单）。
    pub const SIDECAR_CHANNELS: &[&str] = &[
        "attic:ping",
        "attic:versions:list",
        "attic:versions:json",
        "attic:version:probe-class",
        "attic:launch:dry-run",
        "attic:launch",
        "attic:kill",
        "attic:status",
        "attic:java:detect",
        "attic:accounts:list",
        "attic:accounts:add",
        "attic:accounts:remove",
        "attic:accounts:rename",
        "attic:settings:get",
        "attic:settings:set",
        "attic:instances:list",
        "attic:instances:save",
        "attic:instances:delete",
        "attic:instances:rename",
        "attic:game:backlog",
        "attic:custom:list",
        "attic:custom:info",
        "attic:custom:info:save",
        "attic:custom:remove",
        "attic:mods:list",
        "attic:mods:install",
        "attic:sys:info",
        "attic:logs:clear",
    ];
    /// Rust↔sidecar 私有延伸方法（非契约通道）。
    pub const INTERNAL_METHODS: &[&str] = &[
        "attic:internal:instance-game-dir",
        "attic:internal:special-dir",
        "attic:internal:import-jar",
        "attic:internal:shutdown",
    ];
    /// 推送事件（sidecar 帧 → app.emit 原名）。
    pub const EVENT_CHANNELS: &[&str] = &[
        "attic:game:output",
        "attic:game:exit",
        "attic:download:progress",
        "attic:custom:info-changed",
    ];

    pub const LAUNCH: &str = "attic:launch";
    pub const STATUS: &str = "attic:status";
    pub const SETTINGS_GET: &str = "attic:settings:get";
    pub const INTERNAL_INSTANCE_GAME_DIR: &str = "attic:internal:instance-game-dir";
    pub const INTERNAL_SPECIAL_DIR: &str = "attic:internal:special-dir";
    pub const INTERNAL_IMPORT_JAR: &str = "attic:internal:import-jar";
    pub const INTERNAL_SHUTDOWN: &str = "attic:internal:shutdown";
}

fn ok_json(value: Value) -> Value {
    json!({ "ok": true, "value": value })
}
fn err_json(error: impl Into<String>) -> Value {
    json!({ "ok": false, "error": error.into() })
}

// ————————————————————————— sidecar 进程与 RPC —————————————————————————

struct Sidecar {
    stdin: Mutex<ChildStdin>,
    child: Mutex<Child>,
    next_id: AtomicU64,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>,
}

/// 解析 sidecar 启动命令：env 覆盖（开发/调试逃生舱）→ 安装态（资源目录 server.cjs + 随行 node）→ 开发态回退。
/// TODO(Phase 5 发布 SOP)：CI 产物里在 exe 同目录放置便携 node.exe（bundle 面「sidecar 运行时打包」条目）。
fn resolve_sidecar_launch(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let node = std::env::var_os("ATTIC_SIDECAR_NODE")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let exe_dir = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.to_path_buf()))
                .unwrap_or_default();
            let companion = exe_dir.join("node.exe");
            if companion.exists() {
                companion
            } else {
                PathBuf::from("node") // PATH 兜底（开发机常态）
            }
        });
    let entry = std::env::var_os("ATTIC_SIDECAR_ENTRY").map(PathBuf::from).unwrap_or_else(|| {
        app.path()
            .resolve("sidecar/server.cjs", tauri::path::BaseDirectory::Resource)
            .unwrap_or_else(|_| {
                // 开发态回退：src-tauri/../sidecar/dist/server.cjs（`pnpm --filter @attic/sidecar build` 产物）
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("../sidecar/dist/server.cjs")
            })
    });
    if !entry.exists() {
        return Err(format!("sidecar entry not found: {}", entry.display()));
    }
    Ok((node, entry))
}

impl Sidecar {
    fn spawn(app: &AppHandle) -> Result<Self, String> {
        let (node, entry) = resolve_sidecar_launch(app)?;
        let version = app.package_info().version.to_string();
        let mut child = StdCommand::new(&node)
            .arg(&entry)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .env("ATTIC_LAUNCHER_VERSION", &version)
            .spawn()
            .map_err(|e| format!("spawn {} {}: {e}", node.display(), entry.display()))?;
        let stdin = child.stdin.take().ok_or("no stdin")?;
        let stdout = child.stdout.take().ok_or("no stdout")?;
        let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        Self::spawn_reader(app.clone(), stdout, pending.clone());
        Ok(Self {
            stdin: Mutex::new(stdin),
            child: Mutex::new(child),
            next_id: AtomicU64::new(1),
            pending,
        })
    }

    /// stdout 读线程：响应帧按 id 投递 oneshot；事件帧原名 emit；EOF 时唤醒全部在途请求。
    fn spawn_reader(
        app: AppHandle,
        stdout: std::process::ChildStdout,
        pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>,
    ) {
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                let Ok(line) = line else { break };
                if line.trim().is_empty() {
                    continue;
                }
                let Ok(frame) = serde_json::from_str::<Value>(&line) else {
                    eprintln!("[sidecar-stdout] bad frame: {line}");
                    continue;
                };
                if let Some(name) = frame.get("event").and_then(Value::as_str) {
                    let payload = frame.get("payload").cloned().unwrap_or(Value::Null);
                    let _ = app.emit(name, payload);
                    continue;
                }
                if let Some(id) = frame.get("id").and_then(Value::as_u64) {
                    let result = match frame.get("error") {
                        Some(e) => Err(e.as_str().unwrap_or("unknown-sidecar-error").to_string()),
                        None => Ok(frame.get("result").cloned().unwrap_or(Value::Null)),
                    };
                    if let Some(tx) = pending.lock().unwrap().remove(&id) {
                        let _ = tx.send(result);
                    }
                }
            }
            let mut map = pending.lock().unwrap();
            for (_, tx) in map.drain() {
                let _ = tx.send(Err("sidecar-exited".into()));
            }
        });
    }

    /// 请求-响应往返（线协议：{id,method,params} → {id,result|error}）。
    async fn rpc(&self, method: &str, params: Vec<Value>) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        let line = serde_json::to_string(&json!({ "id": id, "method": method, "params": params }))
            .map_err(|e| e.to_string())?;
        {
            let mut stdin = self.stdin.lock().map_err(|e| e.to_string())?;
            writeln!(stdin, "{line}").map_err(|e| format!("sidecar-stdin: {e}"))?;
            stdin.flush().map_err(|e| format!("sidecar-stdin: {e}"))?;
        }
        match tokio::time::timeout(Duration::from_secs(120), rx).await {
            Ok(Ok(res)) => res,
            Ok(Err(_)) => Err("sidecar-response-dropped".into()),
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                Err(format!("sidecar-timeout: {method}"))
            }
        }
    }

    /// 退出收敛：shutdown 帧（sidecar 侧先 kill 游戏进程）→ 宽限 → 强杀兜底。
    async fn shutdown(&self) {
        let _ = tokio::time::timeout(Duration::from_secs(2), self.rpc(channels::INTERNAL_SHUTDOWN, vec![])).await;
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

// ————————————————————————— Tauri 命令（渲染 invoke 面） —————————————————————————

/// async 命令的借用规避范式：不拿 `State<'_>`（引用入参会把 message 生命周期拽进 await），
/// 从 AppHandle 取 inner Arc 的所有权拷贝。
fn sidecar_of(app: &AppHandle) -> Arc<Sidecar> {
    app.state::<Arc<Sidecar>>().inner().clone()
}

/// sidecar 通道转发（白名单制；LAUNCH 成功后消费「启动后最小化」窗行为）。
#[tauri::command]
async fn ipc_forward(app: AppHandle, channel: String, args: Vec<Value>) -> Value {
    if !channels::SIDECAR_CHANNELS.contains(&channel.as_str()) {
        return err_json(format!("host-or-unknown-channel: {channel}"));
    }
    let sidecar = sidecar_of(&app);
    match sidecar.rpc(&channel, args).await {
        Ok(value) => {
            if channel == channels::LAUNCH {
                minimize_if_enabled(&app, &sidecar).await;
            }
            ok_json(value)
        }
        Err(error) => err_json(error),
    }
}

/// 「启动后最小化启动器」：开关数据在 runtime，窗动作在壳层（Electron 壳同款分工）。
async fn minimize_if_enabled(app: &AppHandle, sidecar: &Arc<Sidecar>) {
    if let Ok(settings) = sidecar.rpc(channels::SETTINGS_GET, vec![]).await {
        if settings.get("minimizeOnLaunch").and_then(Value::as_bool) == Some(true) {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.minimize();
            }
        }
    }
}

fn tauri_result_json(result: Result<(), tauri::Error>) -> Value {
    match result {
        Ok(()) => ok_json(Value::Null),
        Err(e) => err_json(e.to_string()),
    }
}

#[tauri::command]
fn window_control(window: tauri::Window, action: String) -> Value {
    match action.as_str() {
        "minimize" => tauri_result_json(window.minimize()),
        "close" => tauri_result_json(window.close()),
        "toggle-maximize" => tauri_result_json(match window.is_maximized() {
            Ok(true) => window.unmaximize(),
            _ => window.maximize(),
        }),
        other => err_json(format!("bad-window-action: {other}")),
    }
}

static CONSOLE_SEQ: AtomicU32 = AtomicU32::new(0);

/// 独立控制台窗（每次新建、不复用；pid 取当前会话，秒退场景由 ?window=console 无 pid + backlog 兜）。
#[tauri::command]
async fn open_console(app: AppHandle) -> Value {
    let sidecar = sidecar_of(&app);
    let pid = sidecar
        .rpc(channels::STATUS, vec![])
        .await
        .ok()
        .and_then(|v| v.pointer("/session/pid").and_then(Value::as_u64));
    let label = format!("console-{}", CONSOLE_SEQ.fetch_add(1, Ordering::Relaxed));
    let (url, title) = match pid {
        Some(p) => (format!("index.html?window=console&pid={p}"), format!("Attic Console — pid {p}")),
        None => (
            "index.html?window=console".to_string(),
            "Attic Minecraft Launcher — Console".to_string(),
        ),
    };
    match WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title(&title)
        .inner_size(860.0, 600.0)
        .min_inner_size(520.0, 360.0)
        .decorations(false)
        .build()
    {
        Ok(_) => ok_json(Value::Null),
        Err(e) => err_json(e.to_string()),
    }
}

fn file_path_to_string(fp: FilePath) -> String {
    match fp {
        FilePath::Path(p) => p.to_string_lossy().into_owned(),
        other => format!("{other:?}"),
    }
}

/// 原生对话框选择（kind = PickTarget；取消 = ok(null)，与 Electron 壳同语义）。
#[tauri::command]
async fn pick_path(app: AppHandle, kind: String) -> Value {
    let blocking = tauri::async_runtime::spawn_blocking(move || {
        let picker = app.dialog().file();
        if kind == "java-executable" {
            picker
                .set_title("选择 Java 可执行文件")
                .add_filter("java 可执行文件", &["exe"])
                .blocking_pick_file()
        } else {
            picker.set_title("选择文件夹").blocking_pick_folder()
        }
    })
    .await;
    match blocking {
        Ok(Some(fp)) => ok_json(json!(file_path_to_string(fp))),
        Ok(None) => ok_json(Value::Null),
        Err(e) => err_json(e.to_string()),
    }
}

fn open_dir_json(app: &AppHandle, dir: &str) -> Value {
    let _ = std::fs::create_dir_all(dir); // 首启未落盘场景不失败（Electron 壳同款）
    match app.opener().open_path(dir, None::<&str>) {
        Ok(()) => ok_json(Value::Null),
        Err(e) => err_json(e.to_string()),
    }
}

/// 打开特殊目录（路径解析在 sidecar runtime 根，动作在壳层）。
#[tauri::command]
async fn open_special_dir(app: AppHandle, target: String) -> Value {
    let sidecar = sidecar_of(&app);
    match sidecar.rpc(channels::INTERNAL_SPECIAL_DIR, vec![json!(target)]).await {
        Ok(v) => match v.as_str() {
            Some(dir) => open_dir_json(&app, dir),
            None => err_json("special-dir-not-string"),
        },
        Err(e) => err_json(e),
    }
}

#[tauri::command]
async fn open_instance_dir(app: AppHandle, name: String) -> Value {
    let sidecar = sidecar_of(&app);
    match sidecar.rpc(channels::INTERNAL_INSTANCE_GAME_DIR, vec![json!(name)]).await {
        Ok(v) => match v.as_str() {
            Some(dir) => open_dir_json(&app, dir),
            None => err_json("game-dir-not-string"),
        },
        Err(e) => err_json(e),
    }
}

/// 外链出门：协议白名单 http/https（渲染侧无 shell，唯一出门口收紧校验）。
#[tauri::command]
fn open_external_url(app: AppHandle, url: String) -> Value {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return err_json(format!("仅允许 http/https 协议：{url}"));
    }
    match app.opener().open_url(&url, None::<&str>) {
        Ok(()) => ok_json(Value::Null),
        Err(e) => err_json(e.to_string()),
    }
}

/// 导入自定义版本 jar：Rust 弹框取路径 → sidecar runtime.importCustomJar（取消 = ok(null)）。
#[tauri::command]
async fn import_custom_jar(app: AppHandle) -> Value {
    let sidecar = sidecar_of(&app);
    let blocking = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("导入自定义版本 jar")
            .add_filter("Minecraft jar", &["jar", "zip"])
            .blocking_pick_file()
    })
    .await;
    let file = match blocking {
        Ok(Some(fp)) => file_path_to_string(fp),
        Ok(None) => return ok_json(Value::Null),
        Err(e) => return err_json(e.to_string()),
    };
    match sidecar.rpc(channels::INTERNAL_IMPORT_JAR, vec![json!(file)]).await {
        Ok(v) => ok_json(v),
        Err(e) => err_json(e),
    }
}

// ————————————————————————— 装配 —————————————————————————

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();
            let sidecar = Sidecar::spawn(&handle).map_err(|e| e)?;
            app.manage(Arc::new(sidecar));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc_forward,
            window_control,
            open_console,
            pick_path,
            open_special_dir,
            open_instance_dir,
            open_external_url,
            import_custom_jar
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                let state = app_handle.state::<Arc<Sidecar>>();
                tauri::async_runtime::block_on(state.shutdown());
            }
        });
}

// ————————————————————————— 契约镜像闸门（戒律 #2 的跨语言半边） —————————————————————————

#[cfg(test)]
mod contract_tests {
    use super::channels::*;
    use serde_json::Value;
    use std::path::PathBuf;

    fn fixture() -> Value {
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/core-spec/tests/fixtures/ipc-channels.json");
        let raw = std::fs::read_to_string(&p)
            .expect("fixture 缺失：先跑 `node scripts/emit-contract-fixtures.mjs`");
        serde_json::from_str(&raw).expect("fixture 非法 JSON")
    }

    fn sorted(list: &[&str]) -> Vec<String> {
        let mut v: Vec<String> = list.iter().map(|s| s.to_string()).collect();
        v.sort();
        v
    }

    fn fixture_list(f: &Value, key: &str) -> Vec<String> {
        f[key]
            .as_array()
            .expect("fixture 键缺数组")
            .iter()
            .map(|x| x.as_str().expect("fixture 项非字符串").to_string())
            .collect()
    }

    #[test]
    fn rust_mirror_equals_ts_fixture() {
        let f = fixture();
        assert_eq!(sorted(ALL_CHANNELS), fixture_list(&f, "allChannels"), "allChannels");
        assert_eq!(sorted(HOST_CHANNELS), fixture_list(&f, "hostOnlyChannels"), "hostOnlyChannels");
        assert_eq!(sorted(SIDECAR_CHANNELS), fixture_list(&f, "sidecarChannels"), "sidecarChannels");
        assert_eq!(sorted(INTERNAL_METHODS), fixture_list(&f, "internalMethods"), "internalMethods");
        assert_eq!(sorted(EVENT_CHANNELS), fixture_list(&f, "eventChannels"), "eventChannels");
    }

    #[test]
    fn host_and_sidecar_partition_all() {
        for ch in SIDECAR_CHANNELS.iter().chain(HOST_CHANNELS.iter()) {
            assert!(ALL_CHANNELS.contains(ch), "非契约通道混入: {ch}");
        }
        assert_eq!(
            SIDECAR_CHANNELS.len() + HOST_CHANNELS.len(),
            ALL_CHANNELS.len(),
            "划分不是不交并集"
        );
    }
}

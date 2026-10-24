; ============================================================================
; Attic Launcher —— Inno Setup 6 共享安装脚本（双壳一个 .iss，flavor 参数化）。
;
; 路线拍板（2026-10-24）：双壳安装器由 NSIS 切 Inno —— NSIS 默认观感老旧、宏/插件
; 层晦涩（builder 模板 customInstallMode×UAC 插件 0xc0000005 崩溃史见 plan.md），
; Inno 的 Pascal [Code] 可维护性优先。两壳的 nsis target 均退场：
;   * 主壳（tauri）    ：tauri build --no-bundle → stage 目录（exe + sidecar/，bundler
;                        的 resources 拷贝不随 --no-bundle 发生，CI 显式组包）
;   * 兜底壳（legacy） ：electron-builder --dir → release\win-unpacked\
;   注意：Inno Setup 6 的 ISCC 仅有 32-bit 构建，产物安装器天然兼容 32/64-bit 全部
;   Windows —— 双 flavor 都用同一个 ISCC；"64-bit 构件装 32-bit 系统"的拦截因此
;   必须由 [Code] 的 IsWin64 闸门完成（对应原 NSIS ${RunningX64}）。
;
; CI/本地调用（ISCC 命令行 /D 一律带引号；VERSION 传去 v 前缀的 tag）：
;   ISCC /DATTIC_FLAVOR="legacy" /DATTIC_PAYLOAD="<win-unpacked>" \
;        /DATTIC_VERSION="0.0.0" /DATTIC_ARCH="x64" /DATTIC_OUTDIR="installer\dist" attic.iss
;   → attic-launcher-<flavor>-<version>-<arch>-setup.exe
;   主壳另传 /DATTIC_ICON="...\icons\icon.ico"（兜底壳不传 = Inno 默认安装器图标，
;   用户拍板：向导维持 Inno 原生观感，品牌位图/自定义皮肤全部不上）。
;
; 形态约定（本文件内不再改动）：
;   * 纯用户级（PrivilegesRequired=lowest，装 %LOCALAPPDATA%）——替代原 NSIS
;     customInstallMode 跳范围页的全部职能；无范围选择页（Inno 天然干净）
;   * 双闸 guard 移植自 windows/attic-checks.nsh：主壳判 Win10+（WebView2 110 钉
;     由 OS 闸门代管；Evergreen 自更；embedBootstrapper 随 nsis target 退场，
;     残余差异记 plan.md）；兜底壳判 Win7 SP1+（Electron 22 = Chromium 108 一代，Win7 SP1 为其地板）
;   * attic:// 协议注册归运行时插件面，安装器不写协议表（与迁移前一致）
;
; 更新通道衔接（latest.json platforms.windows-x86_64）：
;   * 旧 NSIS 时代：url = bundler 产 *-setup.exe（bundler 自动签名）
;   * Inno 时代    ：url = ISCC 产 setup.exe，签名由 CI 用 `tauri signer sign`
;     手动产出 .sig（签名对象=任意字节流，不受安装器格式限制）；
;     tauri-plugin-updater 下载后以默认方式打开 exe → Inno 向导出现，用户点两下
;     （升级体验从"静默直装"变"可见向导"，拍板接受）
; ============================================================================

#ifdef ATTIC_FLAVOR
#else
  #define ATTIC_FLAVOR "main"
#endif
#define Is(S, X) (Pos(X, S) > 0)
#define LEGACY Is(ATTIC_FLAVOR, "legacy")

#ifdef ATTIC_VERSION
#else
  #define ATTIC_VERSION "0.0.0"
#endif
#ifdef ATTIC_ARCH
#else
  #define ATTIC_ARCH "x64"
#endif
#ifdef ATTIC_OUTDIR
#else
  #define ATTIC_OUTDIR "installer\dist"
#endif

#if LEGACY
  #define ATTIC_APPID  "uk.attic.launcher.legacy"
  #define ATTIC_NAME   "Attic Launcher Legacy"
  #define ATTIC_EXE    "Attic Launcher Legacy.exe"
#else
  #define ATTIC_APPID  "uk.attic.launcher"
  #define ATTIC_NAME   "Attic Launcher"
  #define ATTIC_EXE    "attic-launcher.exe"
#endif

#if ATTIC_ARCH == "x64"
  #define ATTIC_64MODE "x64"
  #define NEED64 True
#else
  #define ATTIC_64MODE ""
  #define NEED64 False
#endif

#ifdef ATTIC_PAYLOAD
#else
  #error ATTIC_PAYLOAD 必传：/DATTIC_PAYLOAD="<构件目录>"（win-unpacked 或 tauri release）
#endif
#ifdef ATTIC_ICON
  #define ATTIC_ICON_LINE ATTIC_ICON
#else
  #define ATTIC_ICON_LINE ""
#endif

[Setup]
AppId={#ATTIC_APPID}
AppName={#ATTIC_NAME}
AppVersion={#ATTIC_VERSION}
AppVerName={#ATTIC_NAME} {#ATTIC_VERSION}
AppPublisher=huang423
; {autopf} 在 lowest 特权安装 = %LOCALAPPDATA%\Programs（VS Code/Blockbench 同轨；
; 勿用 {localappdata} = %LOCALAPPDATA% 根，实测已踩）
DefaultDirName={autopf}\{#ATTIC_NAME}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesInstallIn64BitMode={#ATTIC_64MODE}
OutputDir={#ATTIC_OUTDIR}
OutputBaseFilename=attic-launcher-{#ATTIC_FLAVOR}-{#ATTIC_VERSION}-{#ATTIC_ARCH}-setup
SetupIconFile={#ATTIC_ICON_LINE}
UninstallDisplayName={#ATTIC_NAME}
UninstallDisplayIcon={app}\{#ATTIC_EXE}
Compression=lzma2/max
SolidCompression=yes
UsePreviousAppDir=yes
CloseApplications=yes

[Languages]
; 简体中文为非官方翻译，不随 Inno 安装包分发 —— 已 vendor 进 installer\lang\（6.7.3 版）
Name: "zh"; MessagesFile: "{#SourcePath}lang\ChineseSimplified.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#ATTIC_PAYLOAD}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\{#ATTIC_NAME}"; Filename: "{app}\{#ATTIC_EXE}"
Name: "{userdesktop}\{#ATTIC_NAME}"; Filename: "{app}\{#ATTIC_EXE}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#ATTIC_EXE}"; Description: "{cm:LaunchProgram,{#ATTIC_NAME}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
// 双闸 guard（移植自 windows/attic-checks.nsh）：
//   主壳   = Win10+（WebView2 110 由 OS 面代管；Evergreen 自更）
//   兜底壳 = Win7 SP1+（Electron 22 = Chromium 108 一代，Win7 SP1 为其地板）
// 32-bit 主机装 x64 构件的拦截 = [Code] 的 IsWin64 闸门（NEED64=ARCH=="x64" 时启用）：
// 安装器本体是 32-bit、在 32-bit 主机能启动，不会"自然挡"，必须自己拦
// （等价原 ${RunningX64}）。
// 版本源 = HKLM\...\Windows NT\CurrentVersion（6.3+ 的 CurrentMajorVersionNumber
// 为权威；老系统回退 '6.1 SP1' 式 Version+CSDVersion 解析）。Inno 6 脚本 API 没有
// GetWindowsVersion —— 别照抄 Inno 7 文档。
const
  LegacyDownloadUrl = 'https://github.com/REPLACE_OWNER/REPLACE_REPO/releases';

function GetWinMajorSP(out Major, SP: Integer): Boolean;
var
  Maj, Min: Cardinal;
  S: String;
  P: Integer;
begin
  Result := False;
  SP := 0;
  if RegQueryDWordValue(HKLM, 'SOFTWARE\Microsoft\Windows NT\CurrentVersion',
      'CurrentMajorVersionNumber', Maj) and
     RegQueryDWordValue(HKLM, 'SOFTWARE\Microsoft\Windows NT\CurrentVersion',
      'CurrentMinorVersionNumber', Min) then
  begin
    Major := Maj; // Win8+ 路径（10/11 均报 Major=10）
    if Major >= 8 then SP := 1; // SP 概念对 Win8+ 无意义，置 1 表示"够新"
    Result := True;
    Exit;
  end;
  // Win7 等老系统：无上述 DWORD，退回字符串解析 '6.1' + CSDVersion 'SP1'
  if not RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\Windows NT\CurrentVersion', 'Version', S) then Exit;
  P := Pos('.', S);
  if P = 0 then Exit;
  Major := StrToInt(Copy(S, 1, P - 1));
  if RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\Windows NT\CurrentVersion', 'CSDVersion', S) then
  begin
    if Pos('SP2', S) > 0 then SP := 2
    else if Pos('SP1', S) > 0 then SP := 1;
  end;
  Result := True;
end;

function InitializeSetup: Boolean;
var
  Major, SP: Integer;
  Msg: String;
  VS: String;
begin
  Result := True;
  if not GetWinMajorSP(Major, SP) then Exit;

#if LEGACY
  // Win7 = 6.1 且必须 SP1+；更低（Vista 6.0 / XP 5.x）拒装
  if (Major < 6) or ((Major = 6) and (SP < 1)) then
  begin
    RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\Windows NT\CurrentVersion', 'ProductName', VS);
    Msg := 'Attic Launcher Legacy 需要 Windows 7 SP1 或更新系统（当前：' + VS + '）。';
    MsgBox(Msg, mbCriticalError, MB_OK);
    Result := False;
    Exit;
  end;
#else
  // 主壳地板 = Win10（Major 10；Win11 同报 10）。戒律：[Code] 内禁用 #13#10 字符码
  // ——续行以 # 开头会被 ISPP 当预处理指令（Unknown preprocessor directive，实测两踩），
  // 换行一律 Chr(13)+Chr(10)。
  if Major < 10 then
  begin
    RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\Windows NT\CurrentVersion', 'ProductName', VS);
    Msg := 'Attic Launcher requires Windows 10 or later (WebView2 110+). Current system: ' + VS + '. ' +
           'Windows 7/8/8.1 users please install the Electron-compatible build from:' +
           Chr(13) + Chr(10) + LegacyDownloadUrl + Chr(13) + Chr(13) + Chr(10) +
           '安装已中止：本程序需要 Windows 10 或更新系统。';
    MsgBox(Msg, mbCriticalError, MB_OK);
    Result := False;
    Exit;
  end;
  #if NEED64
  // x64 构件装不进 32-bit 主机（安装器本体是 32-bit 可启动，闸门必须自己拦——
  // 等价原 NSIS ${RunningX64}；arm64 Windows 过此项 = x64 仿真可运行）
  if not IsWin64 then
  begin
    Msg := 'This installer carries the 64-bit build. 本机是 32-bit Windows，' +
           '请改用 Electron 兼容构件（ia32）：' + Chr(13) + Chr(10) + LegacyDownloadUrl;
    MsgBox(Msg, mbCriticalError, MB_OK);
    Result := False;
    Exit;
  end;
  #endif
#endif
end;

; ============================================================================
; Attic NSIS 定制层 —— 仅脚本层（回答「需要定制 NSIS 吗」：不需要编译定制）。
; 官方预编译 makensis + 自带插件（LogicLib/WinVer/x64.nsh）即满足全部需求；
; 自定义「插件 DLL」才要编译 NSIS 源码，我们不造。本文件由 Tauri bundler 的
; bundle.windows.nsis.installerHooks 通道 include（模板以 !ifmacrodef 守钩子
; 宏，版本无关；钩子名见 Tauri「Windows Installer → Extending the Installer」）。
;
; 职责切分（Phase 4/5 拍板）：
;   * 本文件：防错装 guards —— OS 下限（Win10）+ 架构（x64 前置）
;   * bundler：minimumWebview2Version=110.0.1531.0 + embedBootstrapper
;     负责 WebView2 版本面（旧则触发在线更新，无需本文件介入）
; ============================================================================

!include LogicLib.nsh
!include WinVer.nsh
!include x64.nsh

; electron 兼容构件（Win7/8/8.1 承接壳）下载地址。
; TODO(发版 SOP)：替换为真实 GitHub Releases 页面 URL 后去掉 ifndef 默认值。
!ifndef ATTIC_LEGACY_DOWNLOAD_URL
  !define ATTIC_LEGACY_DOWNLOAD_URL "https://github.com/REPLACE_OWNER/REPLACE_REPO/releases"
!endif

!macro NSIS_HOOK_PREINSTALL
  ; 判① OS：WebView2 Evergreen 在 Win7/8/8.1 止步 109（升不过 110 钉）→ 拒装并指路兜底壳。
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "Attic Launcher requires Windows 10 or later (WebView2 110+).$\r$\nWindows 7/8/8.1 请改用 Electron 兼容构件：$\r$\n${ATTIC_LEGACY_DOWNLOAD_URL}$\r$\n$\r$\n安装已中止（Abort）。"
    Abort
  ${EndIf}

  ; 判② 架构：x64 构件不可装进纯 32-bit 主机。
  ; （arm64 Windows 过此项 = x64 仿真可运行；原生 arm64 请选 aarch64 构件——
  ;  NSIS 安装器本体在 arm64 上本就跑在仿真层，Tauri 官方文档同此语义。）
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "This installer is the 64-bit build. 本机是 32-bit Windows，请改用 Electron 兼容构件（x64/ia32）：$\r$\n${ATTIC_LEGACY_DOWNLOAD_URL}$\r$\n$\r$\n安装已中止（Abort）。"
    Abort
  ${EndIf}
!macroend

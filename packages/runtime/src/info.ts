/**
 * 版本元数据解析：`.info`（Java properties，v1 ReleaseJson.java 实测字段集）→ VersionJson。
 * 缺什么补什么：真实 `.info` 不含 mainClass/minecraftArguments——主类由 launch-method 数据表推导
 * （表按启动方法键控，非版本 id 判断，戒律 #1 允许的数据形态）。
 */

import type { BetacraftExtension, VersionJson } from '@attic/core-spec';

/** v1 默认代理参数（ReleaseJson.java L15 原样保留）。 */
const DEFAULT_PROXY_ARGS = ['-Dhttp.proxyHost=betacraft.uk'];

/**
 * launch-method → 主类映射（数据表）。
 * 键集为 2026-10 实测 betacraft.uk 全清单 290 个 `.info` 的 launch-method 全集：
 * pre-classic/classic 容器走 legacyfix AppletLauncher（<a1.0.6，见 legacyfix docs/Prism Launcher.md）；
 * `indev` 一个值覆盖 2.0-preview→1.5.2 全部 253 个版本，表值取 Minecraft（beta+ 形态）；
 * 早期 indev/infdev jar 仅含 MinecraftApplet（无 main），由 runtime 按本地 jar 探测改走
 * AppletLauncher 容器（probeIndevEntry，v1 兜底探测同构）。
 * 未映射值（`DL_12w18a_19a`）主类为空——DL_ 超出 v0 范围（1.2+ 快照），
 * 拼装器显式报错而非静默兜底（数据缺口可见）。
 * 表按启动方法键控，非版本 id 判断（戒律 #1 允许的数据形态）。
 */
export const LAUNCH_METHOD_MAIN_CLASS: Record<string, string> = {
  preclassic: 'uk.betacraft.legacyfix.applet.AppletLauncher',
  classic12a: 'uk.betacraft.legacyfix.applet.AppletLauncher',
  classic: 'uk.betacraft.legacyfix.applet.AppletLauncher',
  ClassicWithSaving: 'uk.betacraft.legacyfix.applet.AppletLauncher',
  Classic15aWithSaving: 'uk.betacraft.legacyfix.applet.AppletLauncher',
  ClassicMpWithSaving: 'uk.betacraft.legacyfix.applet.AppletLauncher',
  // 4k-*：jar 仅含 M.class（纯 Applet）。legacyfix AppletLauncher.java L56 读 --appletClass
  // 参数可指定任意 Applet 子类（launchEntry 查直接父类 = java.applet.Applet → AppletFrame 嵌入），
  // 与 v1 FkWrapper 同构；类名注入见 launch.ts APPLET_CLASS_BY_METHOD（用户拍板：不纳入检测表）。
  '4k': 'uk.betacraft.legacyfix.applet.AppletLauncher',
  indev: 'net.minecraft.client.Minecraft',
  // 官方 .info 未现、自定义 .info 可用的容器方法（v1 Wrapper.java 主类 + launchwrapper 时代容器）。
  infdev: 'net.minecraft.client.Minecraft',
  alpha: 'net.minecraft.client.Minecraft',
  beta: 'net.minecraft.client.Minecraft',
  start: 'net.minecraft.client.Minecraft',
  launchwrapper: 'net.minecraft.launchwrapper.Launch',
};

function toEpochMs(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function infoToVersionJson(id: string, props: Record<string, string>): VersionJson {
  const json: VersionJson = { id };

  const url = props['url'];
  const sha1 = props['sha1'];
  if (url) json.jar = sha1 ? { url, sha1 } : { url };

  const release = toEpochMs(props['release-date']);
  if (release !== undefined) json.releaseTime = new Date(release).toISOString();
  const compile = toEpochMs(props['compile-date']);
  if (compile !== undefined) json.time = new Date(compile).toISOString();

  const ext: BetacraftExtension = {};
  const proxyRaw = props['proxy-args']?.trim();
  ext.proxyArgs = proxyRaw ? proxyRaw.split(/\s+/) : [...DEFAULT_PROXY_ARGS];
  if (props['launch-method']) ext.launchMethod = props['launch-method'];
  if (props['launch-method-link']) ext.launchMethodLink = props['launch-method-link'];
  if (props['protocolVersion']) ext.protocolVersion = props['protocolVersion'];
  if (props['base-version']) ext.baseVersion = props['base-version'];
  if (props['custom'] !== undefined) ext.custom = props['custom'].toLowerCase() === 'true';
  const fileVer = toEpochMs(props['file-ver']);
  if (fileVer !== undefined) ext.fileVer = Math.trunc(fileVer);
  json.betacraft = ext;

  // 可选透传（自定义 .info 可携带；官方 .info 缺失时按启动方法表推导）
  if (props['main-class']) json.mainClass = props['main-class'];
  else if (ext.launchMethod) {
    const derived = LAUNCH_METHOD_MAIN_CLASS[ext.launchMethod];
    if (derived) json.mainClass = derived;
  }
  if (props['minecraft-arguments']) json.minecraftArguments = props['minecraft-arguments'];
  if (props['assets']) json.assets = props['assets'];
  if (props['type']) json.type = props['type'] as VersionJson['type'];
  return json;
}

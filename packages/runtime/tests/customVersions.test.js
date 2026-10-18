'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { AtticRuntime, parseProperties } = require('../dist/index.js');
const { buildJarBuffer } = require('./zipFixture.js');

function tempRuntime(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attic-cv-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { rt: new AtticRuntime({ rootDir: dir, fetchImpl: () => Promise.reject(new Error('no-net')) }), dir };
}

const versionsDir = (dir) => path.join(dir, 'versions');
const jsonsDir = (dir) => path.join(versionsDir(dir), 'jsons');
function putJar(dir, id, classNames) {
  fs.mkdirSync(versionsDir(dir), { recursive: true });
  fs.writeFileSync(path.join(versionsDir(dir), `${id}.jar`), buildJarBuffer(classNames));
}
function putInfo(dir, id, props) {
  fs.mkdirSync(jsonsDir(dir), { recursive: true });
  const body = Object.entries(props)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  fs.writeFileSync(path.join(jsonsDir(dir), `${id}.info`), `${body}\n`);
}
/** 版本清单缓存（=fetchVersionList 成功落盘的 BC 官方全集）：裸 jar custom 判定的排除源。 */
function putListCache(dir, ids) {
  const launcher = path.join(dir, 'launcher');
  fs.mkdirSync(launcher, { recursive: true });
  fs.writeFileSync(
    path.join(launcher, 'version_list.json'),
    JSON.stringify({
      generatedAt: Date.now(),
      versions: ids.map((id) => ({ id, repository: 'betacraft', installed: false })),
    }),
  );
}

test('官方清单 id 的裸 jar 不落入 custom（inf-20100227-1433 实案修复）', (t) => {
  const { rt, dir } = tempRuntime(t);
  putJar(dir, 'inf-20100227-1433', ['net.minecraft.client.MinecraftApplet']); // BC 提供，本地 .info 缺失
  putJar(dir, 'bare', ['net.minecraft.client.MinecraftApplet']); // 真用户导入（不在官方清单）
  putListCache(dir, ['inf-20100227-1433', 'b1.7.3']);
  assert.deepEqual(rt.listCustomVersions().map((v) => v.id), ['bare']);
  // 导入侧同源封堵：官方清单 id（本地尚无 jar）拒绝导入为自定义版本
  const src = path.join(dir, 'b1.7.3.jar');
  fs.writeFileSync(src, buildJarBuffer(['com.mojang.minecraft.MinecraftApplet']));
  assert.throws(() => rt.importCustomJar(src), /Betacraft 官方版本 id/);
});

test('官方清单 id + 本地 custom=true 残留声明：官方命中 > 本地声明（1433 完整实案）', (t) => {
  const { rt, dir } = tempRuntime(t);
  putJar(dir, 'inf-20100227-1433', ['net.minecraft.client.MinecraftApplet']);
  putInfo(dir, 'inf-20100227-1433', { 'launch-method': 'indev', custom: 'true' }); // 陈旧误写
  putListCache(dir, ['inf-20100227-1433']);
  assert.deepEqual(rt.listCustomVersions(), [], '已配置分支同样被官方门禁排除');
  assert.throws(() => rt.getCustomVersionInfo('inf-20100227-1433'), /不落入自定义版本配置/);
  assert.throws(() => rt.saveCustomVersionInfo('inf-20100227-1433', { 'launch-method': 'indev' }), /不落入自定义版本配置/);
  assert.throws(() => rt.removeCustomVersion('inf-20100227-1433'), /不是自定义版本/);
  // 官方 .info 文件不被本链删除（门禁只拒操作）
  assert.ok(fs.existsSync(path.join(jsonsDir(dir), 'inf-20100227-1433.info')));
});

test('listCustomVersions：官方版本不落入；裸 jar=未配置；.info custom=true=已配置', (t) => {
  const { rt, dir } = tempRuntime(t);
  putJar(dir, 'bare', ['net.minecraft.client.MinecraftApplet']); // 裸 jar → 未配置
  putInfo(dir, 'cfg', { 'custom': 'true', 'launch-method': 'indev' }); // 已配置
  putJar(dir, 'cfg', ['net.minecraft.client.MinecraftApplet']); // 已配置项也有 jar
  putInfo(dir, 'official', { 'launch-method': 'indev' }); // 官方 .info（无 custom）→ 排除
  putJar(dir, 'official', ['net.minecraft.client.Minecraft']); // 官方 jar 同 id → 仍排除

  const list = rt.listCustomVersions();
  const ids = list.map((v) => v.id);
  assert.ok(ids.includes('bare'), '裸 jar 应列出');
  assert.ok(ids.includes('cfg'), '已配置应列出');
  assert.ok(!ids.includes('official'), '官方版本不得落入');

  const bare = list.find((v) => v.id === 'bare');
  assert.equal(bare.configured, false);
  assert.equal(bare.installed, true);
  const cfg = list.find((v) => v.id === 'cfg');
  assert.equal(cfg.configured, true);
  assert.equal(cfg.launchMethod, 'indev');
  assert.equal(cfg.mainClass, 'net.minecraft.client.Minecraft'); // 数据表推导
});

test('getCustomVersionInfo：已配置回 props+键集；未配置裸 jar 附检测建议；官方/缺失报错', (t) => {
  const { rt, dir } = tempRuntime(t);
  putInfo(dir, 'cfg', { 'custom': 'true', 'launch-method': 'classic', 'assets': 'classic' });
  const got = rt.getCustomVersionInfo('cfg');
  assert.equal(got.configured, true);
  assert.equal(got.props['assets'], 'classic');
  assert.ok(got.launchMethods.includes('indev'), '应下发合法键集');

  putJar(dir, 'det', ['net.minecraft.client.MinecraftApplet']); // indev 形态
  const det = rt.getCustomVersionInfo('det');
  assert.equal(det.configured, false);
  assert.equal(det.detectedMethod, 'indev');

  putJar(dir, 'nodet', ['com.example.Nothing']); // 检测不出
  const nodet = rt.getCustomVersionInfo('nodet');
  assert.equal(nodet.detectedMethod, undefined);

  // v1 检测名归一（用户拍板补洞）：classic15a 形态 → 官方值 Classic15aWithSaving，必命中下拉
  putJar(dir, 'c15a', ['com.mojang.minecraft.MinecraftApplet', 'com.mojang.minecraft.net.NetworkPlayer']);
  const c15a = rt.getCustomVersionInfo('c15a');
  assert.equal(c15a.detectedMethod, 'Classic15aWithSaving');
  assert.ok(c15a.launchMethods.includes(c15a.detectedMethod), '归一建议必须在合法键集内');

  // '1.6' 形态（net.minecraft.client.main.Main，超 BC 清单）：表内无合法值 → 不给建议
  putJar(dir, 'modern', ['net.minecraft.client.main.Main']);
  assert.equal(rt.getCustomVersionInfo('modern').detectedMethod, undefined);

  putInfo(dir, 'official', { 'launch-method': 'indev' });
  assert.throws(() => rt.getCustomVersionInfo('official'), /不是自定义版本/);
  assert.throws(() => rt.getCustomVersionInfo('ghost'), /不存在/);
});

test('removeCustomVersion：jar+.info 一并移除；官方版本拒绝；不存在拒绝；官方文件不动', (t) => {
  const { rt, dir } = tempRuntime(t);
  putJar(dir, 'bare', ['net.minecraft.client.MinecraftApplet']);
  putJar(dir, 'cfg', ['net.minecraft.client.MinecraftApplet']);
  putInfo(dir, 'cfg', { custom: 'true', 'launch-method': 'indev' });
  putJar(dir, 'official', ['net.minecraft.client.Minecraft']);
  putInfo(dir, 'official', { 'launch-method': 'indev' }); // 无 custom=true → 官方

  rt.removeCustomVersion('bare'); // 裸 jar：只删 jar，缺 info 跳过
  assert.ok(!fs.existsSync(path.join(versionsDir(dir), 'bare.jar')));
  rt.removeCustomVersion('cfg'); // 已配置：jar+info 同删
  assert.ok(!fs.existsSync(path.join(versionsDir(dir), 'cfg.jar')));
  assert.ok(!fs.existsSync(path.join(jsonsDir(dir), 'cfg.info')));

  assert.throws(() => rt.removeCustomVersion('official'), /不是自定义版本/);
  assert.throws(() => rt.removeCustomVersion('ghost'), /不是自定义版本/);
  // 官方文件在拒绝路径后完好
  assert.ok(fs.existsSync(path.join(versionsDir(dir), 'official.jar')));
  assert.ok(fs.existsSync(path.join(jsonsDir(dir), 'official.info')));
  assert.deepEqual(rt.listCustomVersions(), [], 'official 不落入 custom 列表；其余已删空');
});

test('saveCustomVersionInfo：launch-method 必填、强制 custom=true、留空落 `key=`、非法 launch-method 报错、回环读回', (t) => {
  const { rt, dir } = tempRuntime(t);
  putJar(dir, 'mine', ['net.minecraft.client.MinecraftApplet']);

  // launch-method 缺失/空白 → 必填报错
  assert.throws(() => rt.saveCustomVersionInfo('mine', { 'main-class': 'x' }), /必填/);
  assert.throws(() => rt.saveCustomVersionInfo('mine', { 'launch-method': '  ' }), /必填/);

  const view = rt.saveCustomVersionInfo('mine', {
    'launch-method': 'indev',
    'assets': '20100212',
    'type': '',            // 选填留空 → 落盘 `type=`（不删键）
    'custom': 'false',     // 用户给的 custom 被忽略，强制 true
  });
  assert.equal(view.configured, true);
  assert.equal(view.launchMethod, 'indev');
  assert.equal(view.mainClass, 'net.minecraft.client.Minecraft');

  const props = parseProperties(fs.readFileSync(path.join(jsonsDir(dir), 'mine.info'), 'utf8'));
  assert.equal(props['custom'], 'true');
  assert.equal(props['assets'], '20100212');
  assert.ok('type' in props && props['type'] === '', '留空字段应落盘为 `key=` 空值');

  // 非法 launch-method 且无 main-class → 报错
  assert.throws(
    () => rt.saveCustomVersionInfo('mine', { 'launch-method': 'DL_12w18a_19a' }),
    /未知 launch-method/,
  );
  // 非法 launch-method 但显式给 main-class → 放行
  const ok = rt.saveCustomVersionInfo('mine', {
    'launch-method': 'DL_12w18a_19a',
    'main-class': 'net.minecraft.client.main.Main',
  });
  assert.equal(ok.mainClass, 'net.minecraft.client.main.Main');
  const back = rt.getCustomVersionInfo('mine');
  assert.equal(back.props['launch-method'], 'DL_12w18a_19a');
});

test('importCustomJar：复制为 versions/<id>.jar；同名报错不覆盖；非 jar 扩展名报错', (t) => {
  const { rt, dir } = tempRuntime(t);
  const src = path.join(dir, 'mygame.jar');
  fs.writeFileSync(src, buildJarBuffer(['net.minecraft.client.MinecraftApplet']));
  const view = rt.importCustomJar(src);
  assert.equal(view.id, 'mygame');
  assert.equal(view.installed, true);
  assert.equal(view.configured, false);
  assert.ok(fs.existsSync(path.join(versionsDir(dir), 'mygame.jar')));

  // 同名再导入 → 报错不覆盖
  assert.throws(() => rt.importCustomJar(src), /已存在同名版本 jar/);

  const bad = path.join(dir, 'notes.txt');
  fs.writeFileSync(bad, 'hello');
  assert.throws(() => rt.importCustomJar(bad), /仅支持/);
});

test('CUSTOM 通道 id 文件名安全：路径穿越/非法字符拒绝', (t) => {
  const { rt } = tempRuntime(t);
  assert.throws(() => rt.getCustomVersionInfo('../evil'), /非法版本 id/);
  assert.throws(() => rt.saveCustomVersionInfo('a/b', {}), /非法版本 id/);
});

test('CUSTOM_INFO_CHANGED 事件：外部写 .info → 按 id 去抖发射', async (t) => {
  const { rt, dir } = tempRuntime(t);
  const seen = [];
  const off = rt.on('attic:custom:info-changed', (payload) => seen.push(payload.id));
  t.after(off);
  try {
    putInfo(dir, 'watched', { custom: 'true', 'launch-method': 'indev' });
    // fs.watch 时序不保证：轮询至 3s 上限
    const deadline = Date.now() + 3000;
    while (!seen.includes('watched') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(seen.includes('watched'), '外部编辑应触发 CUSTOM_INFO_CHANGED（监视不可用环境可调整本用例）');
  } finally {
    off();
  }
});

/**
 * 兜底壳入口（Electron 22 / Win7-8.1 线）：
 *  - ESM import 顺序 = 执行顺序：先安装 electron.net fetch 桥，再引导共用主入口；
 *  - 主入口复用 apps/electron/src/main.ts（同一份主进程源码，双壳同源；
 *    Node16 API 面由 scripts/node16-api-gate.mjs 在 CI 把关）。
 * runtime 的 fetch 消费点全部在 whenReady 之后的网络期，polyfill 安装时机天然安全
 * （fetchImpl 默认闭包是惰性解引用全局 fetch）。
 */
import './fetch-polyfill';
import '../../electron/src/main';

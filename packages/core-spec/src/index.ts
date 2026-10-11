/**
 * @attic/core-spec — IPC 契约唯一真相（戒律 #2）。
 * Phase 0：仅骨架（ping 通道 + 结果封装 + 渲染桥类型）。
 * Phase 1：Account / VersionRef / VersionJson / JavaInstall / LaunchConfig（含 agentMount）与契约测试夹具。
 */

/** IPC 通道名常量：双壳（TS/Rust）只允许引用此处定义，禁止散落字符串。 */
export const IPC_CHANNELS = {
  /** 骨架连通性探测（Phase 0 占位，Phase 1 起被真实通道取代或保留为健康检查）。 */
  PING: 'attic:ping',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

/** 统一的 invoke 结果封装：错误不跨进程抛异常，以数据返回。 */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** preload 暴露给渲染进程的桥面（window.attic）。 */
export interface RendererBridge {
  ping(): Promise<IpcResult<string>>;
}

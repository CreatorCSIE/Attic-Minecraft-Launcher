/**
 * 账户契约：Microsoft 正版与离线账户两种形态。
 * 令牌是宿主侧机密——渲染进程只允许看 AccountView，永不接触 token。
 */

export type AccountType = 'microsoft' | 'offline';

interface AccountBase {
  /** 本地稳定标识（离线账户为生成的 UUID；微软账户取 Minecraft profile id）。 */
  id: string;
  /** 游戏内显示名。 */
  name: string;
  type: AccountType;
}

/** 宿主侧完整账户（含机密，仅存在于主进程/Rust core）。 */
export interface MicrosoftAccount extends AccountBase {
  type: 'microsoft';
  /** Betacraft 代理验证所需的访问令牌。 */
  accessToken: string;
  /** 刷新令牌（缺失表示需重新走设备码流程）。 */
  refreshToken?: string;
  /** accessToken 过期时刻（epoch 毫秒）。 */
  tokenExpiresAt?: number;
  /** Minecraft profile id（sessionid 第三段）。 */
  profileId?: string;
}

export interface OfflineAccount extends AccountBase {
  type: 'offline';
}

export type Account = MicrosoftAccount | OfflineAccount;

/** 渲染进程可见的脱敏视图。 */
export interface AccountView {
  id: string;
  name: string;
  type: AccountType;
  /** 微软账户：令牌是否仍有效。 */
  tokenValid?: boolean;
}

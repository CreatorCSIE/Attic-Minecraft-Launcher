/**
 * 自定义版本配置页契约视图（CUSTOM_* 通道）。
 * custom 语义与 runtime listVersions 一致：裸 jar（有 jar 无 .info）= 未配置；
 * `.info` 含 custom=true = 已配置。Betacraft 官方版本（.info 无 custom=true）不落入本页。
 */

/** 左栏列表项。 */
export interface CustomVersionView {
  id: string;
  /** versions/<id>.jar 是否实存。 */
  installed: boolean;
  /** versions/jsons/<id>.info 实存且 custom=true（已配置）。 */
  configured: boolean;
  /** .info 中的 launch-method（已配置时）。 */
  launchMethod?: string;
  /** 生效主类：显式 main-class 优先，否则按 launch-method 数据表推导（已配置时）。 */
  mainClass?: string;
}

/** 右栏编辑器视图：原始属性 + 检测建议 + launch-method 合法键集（数据驱动下发，UI 零硬编码）。 */
export interface CustomInfoView {
  id: string;
  configured: boolean;
  /** .info 原始键值（未配置 = 空对象）。 */
  props: Record<string, string>;
  /** 未配置裸 jar：detectLaunchMethod 的建议值（检测不出时缺省）。 */
  detectedMethod?: string;
  /** launch-method 合法键集（runtime 主类数据表的键；下拉选项来源）。 */
  launchMethods: string[];
}

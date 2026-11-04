/**
 * EdgeOne 的 Node 运行时通过 `process.env` 提供环境变量 / 平台注入的 Blob 凭据。
 * 项目只装了 Workers 类型，这里补一个最小声明，避免引入整套 @types/node。
 */
declare const process: {
  env: Record<string, string | undefined>;
};

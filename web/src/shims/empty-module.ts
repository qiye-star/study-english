// @bugsnag/electron、electron-log/renderer 在浏览器里的空实现。
const noop = (): undefined => undefined;
const stub: Record<string, unknown> = new Proxy({}, { get: () => noop });
export default stub;
export const log = noop;

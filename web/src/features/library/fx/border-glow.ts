/**
 * 当前句的流动描边(BorderGlow):`.lib-glow::after` 是 conic-gradient 旋转描边(只描 1.5px;`@property --lib-a`,
 * 不支持的浏览器退化为静态描边,R-L29)。每屏只有当前一句在动。
 */
export function borderGlowClass(active: boolean): string {
  return active ? "lib-glow" : "";
}

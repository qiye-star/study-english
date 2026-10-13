/** 页面背景(SoftAurora):三团模糊色块缓慢漂移,纯 CSS(不用 WebGL)。让玻璃「后面有东西」;样式在 library.css 的 `.lib-aurora`(R-L30)。 */
export function SoftAurora() {
  return (
    <div aria-hidden className="lib-aurora">
      <i />
      <i />
      <i />
    </div>
  );
}

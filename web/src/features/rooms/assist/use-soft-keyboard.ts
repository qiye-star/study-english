/**
 * 软键盘是否弹出(spec §5.1):visualViewport.height 比本页记录的最大值小 25% 以上;
 * 不支持 visualViewport 时以「触屏设备且输入框聚焦」代替。车道 WA,任务 WA1 替换实现,签名不变。
 *
 * F5 桩:false。
 */
export function useSoftKeyboard(): boolean {
  return false;
}

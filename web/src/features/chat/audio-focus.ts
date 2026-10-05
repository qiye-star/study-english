/** 全应用同一时刻只播放一段音频(录音回放与 TTS 共用):新的播放者声明时,先让上一个停下。 */
let current: (() => void) | null = null;

export function claimAudio(stop: () => void): void {
  const previous = current;
  current = stop;
  if (previous && previous !== stop) previous();
}

/** 播放者结束/卸载时释放(仅当它仍是当前持有者)。 */
export function releaseAudio(stop: () => void): void {
  if (current === stop) current = null;
}

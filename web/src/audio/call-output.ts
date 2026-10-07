/**
 * 通话下行音频的输出端(calls v2 Task 3)。
 * 回声消除(AEC)需要"正在播放的声音"作参考信号;部分浏览器只拿媒体元素/WebRTC 的输出作参考,
 * 直接连 `ctx.destination` 的 WebAudio 声音不在参考里,机器人的声音就会被麦克风录回去。
 * 支持时:播放器 → MediaStreamAudioDestinationNode → `<audio>` 元素;元素拒绝播放时退回 `ctx.destination`。
 * WebKit(iOS 上所有浏览器、桌面 Safari)不用这条路:系统级语音处理本来就以全部输出为参考,
 * 而 MediaStream 经 `<audio>` 播放在 WebKit 上有过整段无声的问题,风险大于收益。
 */
export interface OutputEnv {
  elementAllowed: boolean;
  createAudioElement?: () => HTMLAudioElement;
}

export interface CallOutput {
  /** 播放器连到这里 */
  readonly node: AudioNode;
  readonly via: "element" | "destination";
  /** 元素播放失败、退回 ctx.destination 时调用(参数为新的输出节点) */
  onFallback(cb: (node: AudioNode) => void): void;
  release(): void;
}

export function elementOutputAllowed(userAgent: string, maxTouchPoints: number): boolean {
  const ios = /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  const safari = /AppleWebKit/.test(userAgent) && /Safari/.test(userAgent) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS|Android/.test(userAgent);
  return !ios && !safari;
}

export function browserOutputEnv(): OutputEnv {
  if (typeof navigator === "undefined" || typeof document === "undefined") return { elementAllowed: false };
  return {
    elementAllowed: elementOutputAllowed(navigator.userAgent, navigator.maxTouchPoints ?? 0),
    createAudioElement: () => document.createElement("audio"),
  };
}

export function createCallOutput(ctx: AudioContext, env: OutputEnv = browserOutputEnv()): CallOutput {
  const direct = (): CallOutput => ({ node: ctx.destination, via: "destination", onFallback: () => undefined, release: () => undefined });
  if (!env.elementAllowed || !env.createAudioElement || typeof ctx.createMediaStreamDestination !== "function") return direct();
  let dest: MediaStreamAudioDestinationNode;
  let el: HTMLAudioElement;
  try {
    dest = ctx.createMediaStreamDestination();
    el = env.createAudioElement();
    el.autoplay = true;
    el.setAttribute?.("playsinline", "");
    el.srcObject = dest.stream;
  } catch {
    return direct();
  }
  let via: CallOutput["via"] = "element";
  let released = false;
  const listeners = new Set<(node: AudioNode) => void>();
  const detachElement = () => {
    try {
      el.pause();
    } catch {
      /* 已停 */
    }
    el.srcObject = null;
  };
  let playing: Promise<void>;
  try {
    playing = Promise.resolve(el.play()); // 同步调用:仍在用户手势/激活的上下文里
  } catch (err) {
    playing = Promise.reject(err);
  }
  void playing.catch(() => {
      if (released || via !== "element") return;
      via = "destination";
      detachElement();
      listeners.forEach((cb) => cb(ctx.destination));
    });
  return {
    node: dest,
    get via() {
      return via;
    },
    onFallback: (cb) => void listeners.add(cb),
    release() {
      if (released) return;
      released = true;
      listeners.clear();
      detachElement();
      try {
        dest.disconnect();
      } catch {
        /* 已断开 */
      }
    },
  };
}

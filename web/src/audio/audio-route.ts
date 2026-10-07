/**
 * 通话的输出方式(calls v2 Task 3):免提 / 听筒。
 * 网页无法真正切换 iOS 的听筒/扬声器路由:这里的"免提"= 更大的增益 + 机器人说话时半双工(不录回外放的声音);
 * "听筒"= 正常增益 + 可以直接开口打断(戴耳机或贴耳时用)。选择保存在 localStorage。
 */
export const SPEAKER_KEY = "enjoy.realtime.speaker";
export const SPEAKER_VOLUME = 2.2;
export const EARPIECE_VOLUME = 1.0;

type PrefStorage = Pick<Storage, "getItem" | "setItem">;
export interface RoutePrefEnv {
  storage?: PrefStorage;
  /** 触屏设备(手机/平板):默认免提 */
  touch: boolean;
}

export function browserRoutePrefEnv(): RoutePrefEnv {
  let storage: PrefStorage | undefined;
  try {
    storage = typeof window !== "undefined" ? window.localStorage : undefined;
  } catch {
    storage = undefined; // 访问 localStorage 本身就可能抛错(禁用站点数据)
  }
  const touch = (typeof navigator !== "undefined" && (navigator.maxTouchPoints ?? 0) > 0)
    || (typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches);
  return { storage, touch };
}

export function loadSpeakerPreference(env: RoutePrefEnv = browserRoutePrefEnv()): boolean {
  try {
    const v = env.storage?.getItem(SPEAKER_KEY);
    if (v === "speaker") return true;
    if (v === "earpiece") return false;
  } catch {
    /* 读不到:用默认 */
  }
  return env.touch;
}

export function saveSpeakerPreference(on: boolean, env: RoutePrefEnv = browserRoutePrefEnv()): void {
  try {
    env.storage?.setItem(SPEAKER_KEY, on ? "speaker" : "earpiece");
  } catch {
    /* 存不了:只影响下次的默认值 */
  }
}

export const speakerVolume = (on: boolean) => (on ? SPEAKER_VOLUME : EARPIECE_VOLUME);

interface AudioSessionNavigator {
  audioSession?: { type: string };
}

/**
 * 通话开始时把 `navigator.audioSession.type` 设为 "play-and-record"(Safari 16.4+;其他浏览器没有这个 API),
 * 返回恢复函数(恢复为进入前的类型,通常是 "auto")。真机上的路由与音量效果未验证。
 */
export function enterCallAudioSession(nav: AudioSessionNavigator = (typeof navigator === "undefined" ? {} : navigator) as AudioSessionNavigator): () => void {
  const session = nav.audioSession;
  if (!session) return () => undefined;
  let previous: string;
  try {
    previous = session.type;
    session.type = "play-and-record";
  } catch {
    return () => undefined;
  }
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    try {
      session.type = previous;
    } catch {
      /* 页面正在卸载等 */
    }
  };
}

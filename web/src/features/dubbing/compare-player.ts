/**
 * 结果页「原声 / 我的」对比回放(计划 L5 R18/W10):两者互斥,快速连点不叠音。纯 TS,播放器由调用方注入。
 * 音频焦点只在「从空闲开始播放」时申请一次,切换时不重新申请;别的声音抢走焦点就停下。
 */

export interface ComparePlayerDeps {
  claim(stop: () => void): void;
  release(stop: () => void): void;
  /** 播放原声这一句(不静音),播完调用 onEnded */
  playOriginal(idx: number, onEnded: () => void): void;
  stopOriginal(): void;
  /** 播放本次或旧记录的录音,播完调用 onEnded */
  playMine(url: string, onEnded: () => void): void;
  stopMine(): void;
}

export type ComparePlaying = "idle" | "original" | "mine";

export interface ComparePlayer {
  original(idx: number): void;
  mine(url: string): void;
  stop(): void;
  playing(): ComparePlaying;
}

export function createComparePlayer(d: ComparePlayerDeps): ComparePlayer {
  let now: ComparePlaying = "idle";
  let claimed = false;

  const stopCurrent = () => {
    if (now === "original") d.stopOriginal();
    if (now === "mine") d.stopMine();
  };
  const goIdle = () => {
    now = "idle";
    if (claimed) {
      claimed = false;
      d.release(onAudioStolen);
    }
  };
  const onAudioStolen = () => {
    stopCurrent();
    goIdle();
  };
  const begin = (kind: "original" | "mine") => {
    if (!claimed) {
      claimed = true;
      d.claim(onAudioStolen);
    }
    now = kind;
  };

  return {
    original(idx) {
      stopCurrent();
      begin("original");
      d.playOriginal(idx, () => {
        if (now === "original") goIdle();
      });
    },
    mine(url) {
      stopCurrent();
      begin("mine");
      d.playMine(url, () => {
        if (now === "mine") goIdle();
      });
    },
    stop() {
      stopCurrent();
      goIdle();
    },
    playing: () => now,
  };
}

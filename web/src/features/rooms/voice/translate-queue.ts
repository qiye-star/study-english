/**
 * 自动翻译的发送队列(review M3;spec 2026-10-10 §4.5「在消息进入视野时自动发」)。
 * 服务端每人 20 次/分钟:自动请求每分钟最多 AUTO_TRANSLATE_PER_MINUTE 次(给手动点按留余量),同时在途最多
 * AUTO_TRANSLATE_INFLIGHT 条;在途的一条收到 voice_update(settle)或 TRANSLATE_STALL_MS 内没有回音就让出位置。
 * 还没发出就离开视野的请求可以取消(不为没人看的历史花全站翻译额度)。纯逻辑,计时器可在测试里用假时钟。
 */
export const AUTO_TRANSLATE_PER_MINUTE = 12;
export const AUTO_TRANSLATE_INFLIGHT = 2;
/** 请求发出后这么久没有任何 voice_update:按「没完成」处理(被限流、额度用完、服务端重启) */
export const TRANSLATE_STALL_MS = 15_000;
const WINDOW_MS = 60_000;

interface Waiting { seq: number; done(sent: boolean): void }

export class TranslateQueue {
  private readonly perMinute: number;
  private readonly maxInflight: number;
  private waiting: Waiting[] = [];
  private inflight = new Map<number, ReturnType<typeof setTimeout>>();
  private sentAt: number[] = [];
  private wake: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly send: (seq: number) => boolean, opts: { perMinute?: number; inflight?: number } = {}) {
    this.perMinute = opts.perMinute ?? AUTO_TRANSLATE_PER_MINUTE;
    this.maxInflight = opts.inflight ?? AUTO_TRANSLATE_INFLIGHT;
  }

  /** 排队请求一条语音的翻译;done(true) = 已发出,done(false) = 发不出去(没有连接)。返回取消函数(仅对还没发出的有效)。 */
  request(seq: number, done: (sent: boolean) => void): () => void {
    const item: Waiting = { seq, done };
    this.waiting.push(item);
    this.pump();
    return () => { this.waiting = this.waiting.filter((w) => w !== item); };
  }

  /** 这一条已有结果(voice_update 到了):让出在途位置。 */
  settle(seq: number): void {
    const timer = this.inflight.get(seq);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.inflight.delete(seq);
    this.pump();
  }

  private pump(): void {
    while (this.waiting.length && this.inflight.size < this.maxInflight) {
      const now = Date.now();
      this.sentAt = this.sentAt.filter((t) => now - t < WINDOW_MS);
      if (this.sentAt.length >= this.perMinute) {
        if (this.wake === null) {
          this.wake = setTimeout(() => { this.wake = null; this.pump(); }, WINDOW_MS - (now - this.sentAt[0]) + 1);
        }
        return;
      }
      const item = this.waiting.shift()!;
      const sent = this.send(item.seq);
      if (sent) {
        this.sentAt.push(now);
        this.inflight.set(item.seq, setTimeout(() => { this.inflight.delete(item.seq); this.pump(); }, TRANSLATE_STALL_MS));
      }
      item.done(sent);
    }
  }
}

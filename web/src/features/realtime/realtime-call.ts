import type { ApiClient } from "~/api/client";
import { browserCaptureEnv, startPcmCapture, type CaptureEnv, type PcmCapture } from "~/audio/capture";
import { TARGET_RATE, floatToPcm16, frameRms } from "~/audio/pcm";
import { createPcmPlayer, type PcmPlayer } from "~/audio/pcm-player";
import type { VadSensitivity } from "~/audio/speech-gate";
import { createVad, type VadHandle } from "~/audio/vad";
import { claimAudio, releaseAudio } from "~/features/chat/audio-focus";
import { INITIAL_CALL, callReducer, type CallAction, type CallModel } from "./call-machine";
import { realtimeErrorKey } from "./errors";
import { encodeControl, encodeStart, parseServerEvent, splitAudioFrame, type StartPayload } from "./protocol";
import { createRealtimeTicket, realtimeUrl } from "./realtime-api";

export const PRE_ROLL_MS = 300;
/** 票据剩余寿命不足这么多秒时,开 WebSocket 前重新申请一张(首次下载 VAD 资源、犹豫的权限弹窗都可能超过 60 s)。 */
export const TICKET_MARGIN_S = 10;
/** 采集开始后上下文仍不在 running 时,再 resume() 一次最多等这么久。 */
export const RESUME_TIMEOUT_MS = 1500;
/**
 * 发出 hangup 之后等服务端关闭套接字最多这么久(review F4 I-1)。服务端先收尾(被打断的回复存为 "… …"、
 * 只差保存的一轮最多等 5 s),再发关闭帧;页面等到关闭再重新加载,才看得到这些消息。超时就自己关。
 */
export const HANGUP_CLOSE_WAIT_MS = 3000;

/** 通话结束后的套接字:页面据此决定何时重新加载(`closed`)、是否需要重新加载(`opened`),以及放弃等待(`drop`)。 */
export interface CallEnding {
  /** 套接字已关闭(服务端关闭、等待到上限、`drop()`,或根本没有打开)时兑现;从不拒绝。 */
  closed: Promise<void>;
  /** WebSocket 曾经打开过(服务端可能保存了消息)。 */
  opened: boolean;
  /** 不再等服务端:立即关闭套接字(切换会话、卸载)。 */
  drop(): void;
}

/** 上下文是否真的在跑(iOS 可能在打开麦克风时把它切到 suspended / interrupted)。 */
async function ensureRunning(context: AudioContext): Promise<boolean> {
  if (context.state === "running") return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve(context.resume?.()).catch((): void => undefined),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, RESUME_TIMEOUT_MS); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  return (context.state as string) === "running";
}
const PRE_ROLL_SAMPLES = (TARGET_RATE * PRE_ROLL_MS) / 1000;

export interface RealtimeEnv {
  WebSocket: new (url: string) => WebSocket;
  capture: CaptureEnv;
  createVad: typeof createVad;
  location: { protocol: string; host: string };
  /** 毫秒时钟(默认 Date.now;测试注入)。 */
  now?: () => number;
}

export const browserRealtimeEnv = (): RealtimeEnv => ({
  WebSocket, capture: browserCaptureEnv(), createVad, location: window.location,
});

export interface RealtimeCallOptions {
  api: ApiClient;
  conversationId: string;
  /** 通话使用的 AudioContext:应已在点击的同步阶段解锁(`unlockAudioContext`)。 */
  context: AudioContext;
  /**
   * 是否由本对象负责关闭 `context`。必填,没有默认值:调用方必须明确选择。
   * true:页面在点击里为这次通话新建了上下文并交出所有权;
   * false:传入的是页面级共享上下文(`getPageAudioContext`,R31,`prepareCallAudio()` 的结果),通话结束只断开自己的节点,从不关闭它。
   */
  ownsContext: boolean;
  start: StartPayload;
  sampleRateOut: number;
  env?: RealtimeEnv;
  onChange(model: CallModel): void;
  /** 服务端保存了一句用户话语;context 是这次通话里它之前的最后一条回复(第一句没有)。 */
  onUserMessage?(messageId: string, text: string, context?: string): void;
}

/**
 * 一次实时通话:票据 → 麦克风 → VAD → WebSocket。
 * 释放契约:任何退出路径(挂断、服务端关闭、连接错误、票据/麦克风失败、轨道中断、`end()`、卸载)都恰好一次地
 * 关闭 WebSocket、释放麦克风、销毁 VAD、关闭播放器、归还音频焦点,并在拥有上下文时关闭它。
 */
export class RealtimeCall {
  model: CallModel = INITIAL_CALL;
  private readonly env: RealtimeEnv;
  private readonly abort = new AbortController();
  private ws: WebSocket | null = null;
  private capture: PcmCapture | null = null;
  private vad: VadHandle | null = null;
  private vadUnavailable = false;
  private player: PcmPlayer | null = null;
  private started = false;
  private torn = false;
  private speaking = false;
  private pttHeld = false;
  private preRoll: Float32Array[] = [];
  private preRollSamples = 0;
  private micLevel = 0;
  private sensitivity: VadSensitivity = "normal";
  private lastTurn = 0;
  private droppedThrough = 0;
  private opened = false;
  /** 已发出 hangup:拆除时套接字留给服务端关闭(有上限) */
  private hungUp = false;
  private lingering: WebSocket | null = null;
  private lingerTimer: ReturnType<typeof setTimeout> | undefined;
  private markClosed!: () => void;
  private readonly closed = new Promise<void>((resolve) => { this.markClosed = resolve; });
  /** 音频焦点:通话期间有别的播放者声明焦点时,先停下通话的播放。 */
  private readonly focus = () => {
    this.player?.stop();
    this.updateSensitivity();
  };

  constructor(private readonly o: RealtimeCallOptions) {
    this.env = o.env ?? browserRealtimeEnv();
  }

  private dispatch(action: CallAction): void {
    this.model = callReducer(this.model, action);
    this.o.onChange(this.model);
  }

  private isOpen(): boolean {
    return !!this.ws && this.ws.readyState === 1;
  }

  private sendText(text: string): void {
    if (this.isOpen()) this.ws!.send(text);
  }

  private sendFrame(frame: Float32Array): void {
    if (this.isOpen()) this.ws!.send(floatToPcm16(frame).buffer as ArrayBuffer);
  }

  private now(): number {
    return (this.env.now ?? Date.now)();
  }

  /** 申请一张票据并记下到手时间与寿命。 */
  private async requestTicket(): Promise<{ ticket: string; freshUntil: number }> {
    const { ticket, expiresIn } = await createRealtimeTicket(this.o.api, this.o.conversationId, this.abort.signal);
    const life = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 60;
    return { ticket, freshUntil: this.now() + Math.max(0, life - TICKET_MARGIN_S) * 1000 };
  }

  /**
   * 顺序:票据 → 麦克风 → VAD → (票据快过期则再申请一张)→ WebSocket。
   * 票据仍然第一个申请:服务端未启用/会话不存在时根本不打开麦克风;iOS 的手势要求只针对 AudioContext 解锁,
   * 那一步已在点击的同步阶段完成(`prepareCallAudio`),这里多一次 await 不影响它。
   * 权限弹窗与首次下载约 16 MB 的 VAD 资源可能超过票据的 60 s 寿命,所以开连接前按 expiresIn 检查一次。
   */
  async start(): Promise<void> {
    if (this.torn || this.started) return;
    this.started = true;
    this.dispatch({ type: "connect" });
    try {
      // 先编码开始消息:服务端注定拒绝的配置(音色不合法)在申请票据、打开麦克风之前就结束
      const startMessage = encodeStart(this.o.start);
      let { ticket, freshUntil } = await this.requestTicket();
      if (this.torn) return;

      this.player = createPcmPlayer(this.o.context, { sampleRate: this.o.sampleRateOut });
      this.player.onDrained(() => this.updateSensitivity());
      claimAudio(this.focus); // 通话期间不得有其他播放

      const capture = await startPcmCapture({ env: this.env.capture, context: this.o.context });
      if (this.torn) return capture.release();
      this.capture = capture;
      capture.onFrame((frame) => this.onFrame(frame));
      capture.onTrackEnded(() => this.end("web.realtime.errors.micLost"));

      // R31:上下文没有在跑时,采集与 VAD 收不到任何帧、播放也停在冻结的时钟上 —— 宁可明确结束,也不给一个"在听"的死通话
      if (!(await ensureRunning(this.o.context))) {
        if (!this.torn) this.finish({ type: "fail", errorKey: "web.realtime.errors.audioSuspended" });
        return;
      }
      if (this.torn) return;

      await this.loadVad(capture.stream);
      if (this.torn) return;

      if (this.now() >= freshUntil) {
        ({ ticket, freshUntil } = await this.requestTicket());
        if (this.torn) return;
      }

      const ws = new this.env.WebSocket(realtimeUrl(ticket, this.env.location));
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      ws.onopen = () => {
        this.opened = true;
        ws.send(startMessage);
      };
      ws.onmessage = (event: MessageEvent | { data: string | ArrayBuffer }) => {
        if (typeof event.data === "string") this.onEvent(event.data);
        else this.onAudio(event.data as ArrayBuffer); // binaryType = "arraybuffer"
      };
      ws.onerror = () => undefined; // 随后一定有 close 事件
      ws.onclose = (event: CloseEvent | { code: number }) => this.finish({ type: "closed", code: event.code });
    } catch (err) {
      this.finish({ type: "fail", errorKey: realtimeErrorKey(err) });
    }
  }

  private async loadVad(stream: MediaStream): Promise<void> {
    let vad: VadHandle;
    try {
      // R32:与采集共用同一个 AudioContext 与同一条麦克风流(库的 pause/resume 不会停掉轨道)
      vad = await this.env.createVad(stream, {
        onSpeechStart: () => { if (!this.model.pushToTalk) this.beginUtterance(); },
        onSpeechEnd: () => { if (!this.model.pushToTalk) this.endUtterance(); },
      }, undefined, this.o.context);
    } catch {
      if (this.torn) return;
      this.vadUnavailable = true;
      this.dispatch({ type: "vad-unavailable" });
      return;
    }
    if (this.torn) {
      void vad.destroy().catch((): void => undefined);
      return;
    }
    this.vad = vad;
    if (!this.model.pushToTalk) vad.start();
  }

  private onEvent(text: string): void {
    const event = parseServerEvent(text);
    if (!event) return;
    if (event.type === "reply_delta") this.lastTurn = Math.max(this.lastTurn, event.turnId);
    this.dispatch({ type: "event", event });
    if (event.type === "state") this.updateSensitivity();
    if (event.type === "transcript_final" && event.text && event.messageId) {
      // 语法检查的上下文:这次通话里这句话之前的最后一条回复(还没有时不传,由页面决定)
      const context = this.model.captions.slice(0, -1).reverse().find((c) => c.role === "assistant")?.text;
      if (context) this.o.onUserMessage?.(event.messageId, event.text, context);
      else this.o.onUserMessage?.(event.messageId, event.text);
    }
  }

  /** 挂断后、服务端关闭前到达的事件:界面已结束,只把服务端保存的用户话语交给页面(语法检查)。 */
  private onLateEvent(text: string): void {
    const event = parseServerEvent(text);
    if (event?.type !== "transcript_final" || !event.text || !event.messageId) return;
    const context = [...this.model.captions].reverse().find((c) => c.role === "assistant")?.text;
    if (context) this.o.onUserMessage?.(event.messageId, event.text, context);
    else this.o.onUserMessage?.(event.messageId, event.text);
  }

  private onAudio(data: ArrayBuffer): void {
    const frame = splitAudioFrame(data);
    if (!frame || frame.turnId <= this.droppedThrough) return; // 被打断那一轮的迟到音频
    this.lastTurn = Math.max(this.lastTurn, frame.turnId);
    this.player?.play(frame.turnId, frame.pcm);
    this.updateSensitivity();
  }

  /** 机器人说话或本地还在播放它的声音时用 `bot-speaking` 预设,降低回声误触发打断。 */
  private updateSensitivity(): void {
    const next: VadSensitivity = this.model.phase === "speaking" || this.player?.playing ? "bot-speaking" : "normal";
    if (next === this.sensitivity || !this.vad) return;
    this.sensitivity = next;
    this.vad.setSensitivity(next);
  }

  private onFrame(frame: Float32Array): void {
    if (this.model.muted) {
      this.micLevel = 0;
      return;
    }
    this.micLevel = frameRms(frame);
    if (this.speaking || this.pttHeld) {
      this.sendFrame(frame);
      return;
    }
    this.preRoll.push(frame);
    this.preRollSamples += frame.length;
    while (this.preRoll.length > 1 && this.preRollSamples - this.preRoll[0].length >= PRE_ROLL_SAMPLES) {
      this.preRollSamples -= this.preRoll.shift()!.length;
    }
  }

  private beginUtterance(): void {
    if (this.torn || this.model.muted || this.speaking) return;
    if (this.player?.playing || this.model.phase === "speaking" || this.model.phase === "thinking") {
      // 打断:立即停止播放,丢弃这一轮之后到达的音频,并通知服务端
      this.player?.stop();
      this.droppedThrough = this.lastTurn;
      this.sendText(encodeControl("interrupt"));
      this.dispatch({ type: "local-interrupt" });
      this.updateSensitivity();
    }
    this.speaking = true;
    for (const frame of this.preRoll) this.sendFrame(frame);
    this.preRoll = [];
    this.preRollSamples = 0;
  }

  private endUtterance(): void {
    if (!this.speaking) return;
    this.speaking = false;
    this.sendText(encodeControl("utterance_end"));
  }

  setMuted(muted: boolean): void {
    if (this.torn) return;
    if (muted) {
      this.endUtterance();
      this.pttHeld = false;
      this.preRoll = [];
      this.preRollSamples = 0;
    }
    this.dispatch({ type: "mute", muted });
  }

  setPushToTalk(on: boolean): void {
    if (this.torn || (!on && this.vadUnavailable)) return; // 没有 VAD 时只能按住说话
    this.pttHeld = false;
    this.endUtterance();
    this.dispatch({ type: "ptt", on });
    if (on) this.vad?.pause();
    else this.vad?.start();
  }

  pttDown(): void {
    if (this.torn || !this.model.pushToTalk || this.pttHeld) return;
    this.beginUtterance();
    this.pttHeld = this.speaking;
  }

  pttUp(): void {
    if (!this.pttHeld) return;
    this.pttHeld = false;
    this.endUtterance();
  }

  /** 0..1 的电平:机器人说话时取播放电平,否则取麦克风电平(用于界面动画)。 */
  level(): number {
    if (this.torn) return 0;
    return Math.max(this.player?.level() ?? 0, this.micLevel);
  }

  hangup(): void {
    if (this.torn) return;
    this.sendHangup();
    this.finish({ type: "closed", code: 1000 });
  }

  /** 页面主动结束(切后台、麦克风中断等):带原因结束并挂断。 */
  end(errorKey: string): void {
    if (this.torn) return;
    this.sendHangup();
    this.finish({ type: "fail", errorKey });
  }

  private sendHangup(): void {
    if (!this.isOpen()) return;
    this.ws!.send(encodeControl("hangup"));
    this.hungUp = true;
  }

  /** 结束后的套接字(随时可取;通话还没结束时 `closed` 要等到它结束并关闭)。 */
  ending(): CallEnding {
    const opened = () => this.opened;
    return { closed: this.closed, get opened() { return opened(); }, drop: () => this.dropSocket() };
  }

  private dropSocket(): void {
    const ws = this.lingering;
    this.lingering = null;
    clearTimeout(this.lingerTimer);
    if (ws) {
      ws.onmessage = ws.onerror = ws.onclose = null;
      try {
        ws.close(1000);
      } catch {
        /* 已关闭 */
      }
    }
    this.markClosed();
  }

  private finish(action: CallAction): void {
    if (this.torn) return;
    this.dispatch(action);
    this.teardown();
  }

  private teardown(): void {
    if (this.torn) return;
    this.torn = true;
    this.speaking = false;
    this.pttHeld = false;
    this.preRoll = [];
    this.abort.abort();
    const ws = this.ws;
    this.ws = null;
    if (ws) ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    if (ws && this.hungUp && ws.readyState === 1) {
      // 麦克风、VAD、播放器照常立即释放;只有套接字留到服务端存完、关闭为止(有上限,可 drop)
      this.lingering = ws;
      ws.onmessage = (event: MessageEvent | { data: string | ArrayBuffer }) => {
        if (typeof event.data === "string") this.onLateEvent(event.data);
      };
      ws.onerror = () => undefined;
      ws.onclose = () => {
        this.lingering = null;
        this.dropSocket();
      };
      this.lingerTimer = setTimeout(() => this.dropSocket(), HANGUP_CLOSE_WAIT_MS);
    } else {
      if (ws && (ws.readyState === 0 || ws.readyState === 1)) {
        try {
          ws.close(1000);
        } catch {
          /* 已关闭 */
        }
      }
      this.markClosed();
    }
    this.capture?.release();
    this.capture = null;
    if (this.vad) void this.vad.destroy().catch((): void => undefined);
    this.vad = null;
    if (this.player) {
      this.player.close();
      releaseAudio(this.focus);
    }
    this.player = null;
    if (this.o.ownsContext) void this.o.context.close?.()?.catch?.((): void => undefined);
  }
}

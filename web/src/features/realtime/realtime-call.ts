import type { ApiClient } from "~/api/client";
import {
  enterCallAudioSession, loadSpeakerPreference, saveSpeakerPreference, speakerVolume, type RoutePrefEnv,
} from "~/audio/audio-route";
import { browserOutputEnv, createCallOutput, type CallOutput, type OutputEnv } from "~/audio/call-output";
import { browserCaptureEnv, startPcmCapture, type CaptureEnv, type PcmCapture } from "~/audio/capture";
import { createEnergyVad, type FrameVad } from "~/audio/energy-vad";
import { TARGET_RATE, floatToPcm16, frameRms } from "~/audio/pcm";
import { createPcmPlayer, type PcmPlayer } from "~/audio/pcm-player";
import type { VadSensitivity } from "~/audio/speech-gate";
import { createVad, type VadCallbacks, type VadHandle } from "~/audio/vad";
import { claimAudio, releaseAudio } from "~/features/chat/audio-focus";
import { INITIAL_CALL, callReducer, type CallAction, type CallModel, type InputMode } from "./call-machine";
import { realtimeErrorKey } from "./errors";
import { encodeControl, encodeStart, parseServerEvent, splitAudioFrame, type StartPayload } from "./protocol";
import { createRealtimeTicket, realtimeUrl } from "./realtime-api";

export const PRE_ROLL_MS = 500;
/** 票据剩余寿命不足这么多秒时,开 WebSocket 前重新申请一张(首次下载 VAD 资源、犹豫的权限弹窗都可能超过 60 s)。 */
export const TICKET_MARGIN_S = 10;
/**
 * 采集开始后上下文仍不在 running 时最多等这么久(期间每次点击/触摸都再 resume() 一次,statechange 到 running 立即继续)。
 * iOS 打开麦克风时会把上下文短暂切到 interrupted/suspended,1.5 s 不够(calls v2 Task 2)。
 */
export const RESUME_TIMEOUT_MS = 4000;
/** Silero 加载(含 ORT 初始化,其上限 ORT_INIT_TIMEOUT_MS = 20 s)的总上限;超时退到基础检测。 */
export const VAD_LOAD_TIMEOUT_MS = 25_000;
/**
 * 看门狗:自动模式下麦克风已送来这么多毫秒的音频,Silero 却一帧都没处理 → 判定它收不到声音
 * (WebKit 上同一条轨道的第二个 MediaStreamAudioSourceNode 可能静音),换成基础检测。只检查一次。
 */
export const VAD_SILENT_FRAMES_MS = 3000;
const VAD_SILENT_SAMPLES = (TARGET_RATE * VAD_SILENT_FRAMES_MS) / 1000;
/** 按住不足这么久就松开 = 误触:什么都不发送(calls v2 Task 4)。 */
export const MIN_HOLD_MS = 300;
/** 免提时机器人的声音停下后,再屏蔽这么久的麦克风(房间里的余响)。 */
export const ECHO_TAIL_MS = 300;
/**
 * 发出 hangup 之后等服务端关闭套接字最多这么久(review F4 I-1)。服务端先收尾(被打断的回复存为 "… …"、
 * 只差保存的一轮最多等 5 s),再发关闭帧;页面等到关闭再重新加载,才看得到这些消息。超时就自己关。
 */
export const HANGUP_CLOSE_WAIT_MS = 3000;

/** 上下文暂停(iOS 打断)时的提示:请用户点一下屏幕,点击里会再 resume()。 */
const TAP_NOTICE = "web.realtime.tapToEnableAudio";

/** 通话结束后的套接字:页面据此决定何时重新加载(`closed`)、是否需要重新加载(`opened`),以及放弃等待(`drop`)。 */
export interface CallEnding {
  /** 套接字已关闭(服务端关闭、等待到上限、`drop()`,或根本没有打开)时兑现;从不拒绝。 */
  closed: Promise<void>;
  /** WebSocket 曾经打开过(服务端可能保存了消息)。 */
  opened: boolean;
  /** 不再等服务端:立即关闭套接字(切换会话、卸载)。 */
  drop(): void;
}

const GESTURES = ["click", "touchend"] as const;

/**
 * 等上下文真的在跑(iOS 可能在打开麦克风时把它切到 suspended / interrupted)。
 * 立即 resume() 一次;之后每次点击/触摸再 resume()(iOS 只认手势里的 resume);statechange 到 running 即返回 true;
 * 到 RESUME_TIMEOUT_MS 或被中止仍不在跑返回 false。
 */
function ensureRunning(context: AudioContext, gestureTarget: EventTarget | undefined, signal: AbortSignal): Promise<boolean> {
  if (context.state === "running") return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let done = false;
    const running = () => (context.state as string) === "running";
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      context.removeEventListener?.("statechange", check);
      GESTURES.forEach((name) => gestureTarget?.removeEventListener(name, kick, true));
      signal.removeEventListener("abort", finish);
      resolve(running());
    };
    function check() {
      if (running()) finish();
    }
    function kick() {
      try {
        void Promise.resolve(context.resume?.()).then(check, (): void => undefined);
      } catch {
        /* 已关闭的上下文 */
      }
    }
    const timer = setTimeout(finish, RESUME_TIMEOUT_MS);
    context.addEventListener?.("statechange", check);
    GESTURES.forEach((name) => gestureTarget?.addEventListener(name, kick, true));
    signal.addEventListener("abort", finish);
    kick();
  });
}

const PRE_ROLL_SAMPLES = (TARGET_RATE * PRE_ROLL_MS) / 1000;

export interface RealtimeEnv {
  WebSocket: new (url: string) => WebSocket;
  capture: CaptureEnv;
  createVad: typeof createVad;
  /** Silero 不可用时的基础检测(默认 createEnergyVad) */
  createEnergyVad?: typeof createEnergyVad;
  location: { protocol: string; host: string };
  /** 毫秒时钟(默认 Date.now;测试注入)。 */
  now?: () => number;
  /** 下行音频的输出端(默认按浏览器判断是否走 `<audio>` 元素)。 */
  output?: OutputEnv;
  /** 免提偏好的存储与触屏判断(默认 localStorage + 浏览器)。 */
  routePrefs?: RoutePrefEnv;
  /** 进入通话音频会话,返回恢复函数(默认 navigator.audioSession)。 */
  enterAudioSession?: () => () => void;
  /** 上下文暂停时在这里监听点击/触摸并 resume()(默认 document)。 */
  gestureTarget?: EventTarget;
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
 * 一次实时通话:票据 → 麦克风 → VAD(失败则基础检测)→ WebSocket。
 * 说话方式(calls v2 Task 4):`auto` 由检测器断句;`ptt` 只在按住时上行,检测器暂停、回调被忽略。
 * 任何模式下按住说话键都是手动的一句(免提时用来打断机器人);按住不足 MIN_HOLD_MS 什么都不发送。
 * 免提(Task 3):机器人的声音可听见时半双工 —— 不上行、不触发检测,只能按住打断。
 * 释放契约:任何退出路径(挂断、服务端关闭、连接错误、票据/麦克风失败、轨道中断、`end()`、卸载)都恰好一次地
 * 关闭 WebSocket、释放麦克风、销毁检测器、关闭播放器与输出端、归还音频焦点与音频会话,并在拥有上下文时关闭它。
 */
export class RealtimeCall {
  model: CallModel;
  private readonly env: RealtimeEnv;
  private readonly abort = new AbortController();
  private ws: WebSocket | null = null;
  private capture: PcmCapture | null = null;
  private vad: VadHandle | null = null;
  private energy: FrameVad | null = null;
  private player: PcmPlayer | null = null;
  private output: CallOutput | null = null;
  private restoreSession: (() => void) | null = null;
  private started = false;
  private torn = false;
  private permissionPrompt = false;
  /** 一句话正在进行(自动检测到的,或按住的) */
  private speaking = false;
  /** 这一句已经发出的帧数(撤回时据此决定要不要告诉服务端) */
  private sentInUtterance = 0;
  private holding = false;
  private holdStartedAt = 0;
  /** 按住未满 MIN_HOLD_MS 时先攒着的帧(含按下前的预录);满了才发出 */
  private holdBuffer: Float32Array[] = [];
  private holdLive = false;
  private preRoll: Float32Array[] = [];
  private preRollSamples = 0;
  private micLevel = 0;
  private sensitivity: VadSensitivity = "normal";
  private suppressed = false;
  private botQuietAt = 0;
  /** 看门狗:Silero 运行期间送出的采集样本数;-1 = 已检查过 */
  private watchedSamples = 0;
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
  /** 检测器(Silero 或基础检测)的回调:只在自动模式、没按住、不在半双工时开始一句。 */
  private readonly detector: VadCallbacks = {
    onSpeechStart: () => { if (this.acceptsDetection()) this.beginUtterance(); },
    onSpeechEnd: () => { if (this.model.inputMode === "auto" && !this.holding) this.endUtterance(); },
  };
  private readonly onContextState = () => this.contextStateChanged();

  constructor(private readonly o: RealtimeCallOptions) {
    this.env = o.env ?? browserRealtimeEnv();
    this.model = { ...INITIAL_CALL, speaker: loadSpeakerPreference(this.env.routePrefs) };
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
    if (!this.isOpen()) return;
    this.ws!.send(floatToPcm16(frame).buffer as ArrayBuffer);
    this.sentInUtterance++;
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
   * 顺序:票据 → 麦克风 → 上下文在跑 → VAD → (票据快过期则再申请一张)→ WebSocket。
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

      this.restoreSession = (this.env.enterAudioSession ?? enterCallAudioSession)();
      this.output = createCallOutput(this.o.context, this.env.output ?? browserOutputEnv());
      this.player = createPcmPlayer(this.o.context, {
        sampleRate: this.o.sampleRateOut, volume: speakerVolume(this.model.speaker), output: this.output.node,
      });
      this.output.onFallback((node) => this.player?.route(node));
      this.player.onDrained(() => {
        this.botQuietAt = this.now();
        this.updateSensitivity();
      });
      claimAudio(this.focus); // 通话期间不得有其他播放

      this.permissionPrompt = true;
      let capture: PcmCapture;
      try {
        capture = await startPcmCapture({ env: this.env.capture, context: this.o.context });
      } finally {
        this.permissionPrompt = false;
      }
      if (this.torn) return capture.release();
      this.capture = capture;
      capture.onFrame((frame) => this.onFrame(frame));
      capture.onTrackEnded(() => this.end("web.realtime.errors.micLost"));

      // R31:上下文没有在跑时,采集与 VAD 收不到任何帧、播放也停在冻结的时钟上 —— 等一会儿(点屏幕可解锁),仍不行就明确结束
      if (this.o.context.state !== "running") {
        this.dispatch({ type: "notice", key: TAP_NOTICE });
        const running = await ensureRunning(this.o.context, this.gestureTarget(), this.abort.signal);
        if (this.torn) return;
        if (!running) {
          this.finish({ type: "fail", errorKey: "web.realtime.errors.audioSuspended" });
          return;
        }
        if (this.model.notice === TAP_NOTICE) this.dispatch({ type: "notice", key: null });
      }
      // 通话中 iOS 仍可能打断上下文(来电、Siri、切换路由):提示并在下次点击时恢复
      this.o.context.addEventListener?.("statechange", this.onContextState);

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

  /** 正在等麦克风权限(iOS 的权限弹窗可能让页面短暂变为 hidden,不能据此挂断)。 */
  get awaitingPermission(): boolean {
    return this.permissionPrompt;
  }

  private gestureTarget(): EventTarget | undefined {
    return this.env.gestureTarget ?? (typeof document === "undefined" ? undefined : document);
  }

  private contextStateChanged(): void {
    if (this.torn) return;
    const state = this.o.context.state as string;
    if (state === "running") {
      if (this.model.notice === TAP_NOTICE) this.dispatch({ type: "notice", key: null });
      return;
    }
    if (state === "closed") return;
    this.dispatch({ type: "notice", key: TAP_NOTICE });
    // 页面级的 installAudioUnlock 会在下一次点击里 resume();这里只做一次非手势的尝试(有些浏览器允许)
    void ensureRunning(this.o.context, this.gestureTarget(), this.abort.signal);
  }

  /**
   * Silero → 失败或超时 → 基础检测(energy-vad)。基础检测不建音频节点,总能用;
   * 两种检测器都只在自动模式下运行,说话方式不再被锁定(calls v2 Task 2)。
   */
  private async loadVad(stream: MediaStream): Promise<void> {
    let vad: VadHandle;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const loading = this.env.createVad(stream, this.detector, undefined, this.o.context);
    try {
      // R32:与采集共用同一个 AudioContext 与同一条麦克风流(库的 pause/resume 不会停掉轨道)
      vad = await Promise.race([
        loading,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            reject(new Error("vad load timeout"));
          }, VAD_LOAD_TIMEOUT_MS);
        }),
      ]);
    } catch {
      if (timedOut) void loading.then((late) => late.destroy(), (): void => undefined).catch((): void => undefined);
      if (this.torn) return;
      this.useEnergyDetector();
      return;
    } finally {
      clearTimeout(timer);
    }
    if (this.torn) {
      void vad.destroy().catch((): void => undefined);
      return;
    }
    this.vad = vad;
    vad.setSensitivity(this.sensitivity);
    if (this.model.inputMode === "auto") vad.start();
  }

  private useEnergyDetector(): void {
    const energy = (this.env.createEnergyVad ?? createEnergyVad)(this.detector);
    this.energy = energy;
    energy.setSensitivity(this.sensitivity);
    if (this.model.inputMode === "auto") energy.start();
    this.dispatch({ type: "vad-unavailable" });
  }

  private detectors(): VadHandle[] {
    return [this.vad, this.energy].filter((d): d is VadHandle => !!d);
  }

  private onEvent(text: string): void {
    const event = parseServerEvent(text);
    if (!event) return;
    if (event.type === "reply_delta") this.lastTurn = Math.max(this.lastTurn, event.turnId);
    const wasSpeaking = this.model.phase === "speaking";
    this.dispatch({ type: "event", event });
    if (event.type === "state") {
      if (wasSpeaking && event.state !== "speaking") this.botQuietAt = Math.max(this.botQuietAt, this.now()); // 余响从这里算起
      this.updateSensitivity();
    }
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

  /** 机器人在说话、本地还在播放它的声音,或(免提时)刚停下不到 ECHO_TAIL_MS。 */
  private botAudible(): boolean {
    if (this.model.phase === "speaking" || this.player?.playing) return true;
    return this.model.speaker && this.botQuietAt > 0 && this.now() - this.botQuietAt < ECHO_TAIL_MS;
  }

  /** 免提半双工:机器人的声音可听见、没有按住 → 不上行、不检测(外放的声音不能被录回去)。 */
  private halfDuplex(): boolean {
    return this.model.speaker && !this.holding && this.botAudible();
  }

  private acceptsDetection(): boolean {
    return !this.torn && this.model.inputMode === "auto" && !this.holding && !this.halfDuplex();
  }

  /** 机器人说话或本地还在播放它的声音时用 `bot-speaking` 预设,降低回声误触发打断。 */
  private updateSensitivity(): void {
    const next: VadSensitivity = this.model.phase === "speaking" || this.player?.playing ? "bot-speaking" : "normal";
    if (next === this.sensitivity) return;
    this.sensitivity = next;
    this.detectors().forEach((d) => d.setSensitivity(next));
  }

  private clearPreRoll(): void {
    this.preRoll = [];
    this.preRollSamples = 0;
  }

  private onFrame(frame: Float32Array): void {
    if (this.model.muted || this.torn) {
      this.micLevel = 0;
      return;
    }
    // 按住说话模式:按住之外不采集(帧直接丢弃,也不留预录)
    if (this.model.inputMode === "ptt" && !this.holding) {
      this.micLevel = 0;
      return;
    }
    if (this.halfDuplex()) {
      this.micLevel = 0;
      if (!this.suppressed) {
        this.suppressed = true;
        this.clearPreRoll(); // 预录里是外放的声音
      }
      return;
    }
    if (this.suppressed) {
      // 半双工结束:检测器在屏蔽期间听到的(回声)作废,从头判断
      this.suppressed = false;
      this.detectors().forEach((d) => d.reset());
    }
    this.micLevel = frameRms(frame);
    if (this.holding) this.onHeldFrame(frame);
    else if (this.speaking) this.sendFrame(frame);
    else this.pushPreRoll(frame);
    this.energy?.push(frame);
    this.watchSilero(frame.length);
  }

  /** 采集有声音、Silero 却从没处理过一帧:换成基础检测(只检查一次)。 */
  private watchSilero(samples: number): void {
    if (!this.vad || this.watchedSamples < 0 || this.model.inputMode !== "auto" || this.holding) return;
    this.watchedSamples += samples;
    if (this.watchedSamples < VAD_SILENT_SAMPLES) return;
    this.watchedSamples = -1;
    if (this.vad.framesProcessed() > 0) return;
    const silent = this.vad;
    this.vad = null;
    void silent.destroy().catch((): void => undefined);
    this.useEnergyDetector();
  }

  private pushPreRoll(frame: Float32Array): void {
    this.preRoll.push(frame);
    this.preRollSamples += frame.length;
    while (this.preRoll.length > 1 && this.preRollSamples - this.preRoll[0].length >= PRE_ROLL_SAMPLES) {
      this.preRollSamples -= this.preRoll.shift()!.length;
    }
  }

  private onHeldFrame(frame: Float32Array): void {
    if (this.holdLive) return this.sendFrame(frame);
    this.holdBuffer.push(frame);
    if (this.now() - this.holdStartedAt >= MIN_HOLD_MS) this.flushHold();
  }

  /** 按住已满 MIN_HOLD_MS:把攒着的帧发出去,之后实时上行。 */
  private flushHold(): void {
    this.holdLive = true;
    const buffered = this.holdBuffer;
    this.holdBuffer = [];
    for (const f of buffered) this.sendFrame(f);
  }

  /** 机器人在说/在想:立即停止播放,丢弃这一轮之后到达的音频,并通知服务端。 */
  private interruptBot(): void {
    if (!(this.player?.playing || this.model.phase === "speaking" || this.model.phase === "thinking")) return;
    this.player?.stop();
    this.droppedThrough = this.lastTurn;
    this.sendText(encodeControl("interrupt"));
    this.dispatch({ type: "local-interrupt" });
    this.updateSensitivity();
  }

  private beginUtterance(): void {
    if (this.torn || this.model.muted || this.speaking) return;
    this.interruptBot();
    this.speaking = true;
    this.sentInUtterance = 0;
    for (const frame of this.preRoll) this.sendFrame(frame);
    this.clearPreRoll();
  }

  private endUtterance(): void {
    if (!this.speaking) return;
    this.speaking = false;
    this.sendText(encodeControl("utterance_end"));
  }

  /** 撤回进行中的一句:不发 utterance_end;已发出过音频时让服务端丢掉它(utterance_cancel)。 */
  private cancelUtterance(): void {
    if (!this.speaking) return;
    this.speaking = false;
    this.holdBuffer = [];
    if (this.sentInUtterance > 0) this.sendText(encodeControl("utterance_cancel"));
    this.sentInUtterance = 0;
  }

  setMuted(muted: boolean): void {
    if (this.torn) return;
    if (muted) {
      if (this.holding) this.releaseHold();
      this.endUtterance();
      this.clearPreRoll();
    }
    this.dispatch({ type: "mute", muted });
  }

  /**
   * 切换说话方式(两者互斥)。进入 `ptt`:暂停检测器、丢弃预录、撤回进行中的自动一句(不发半句);
   * 回到 `auto`:按住中的一句照常结束,检测器从头开始。
   */
  setInputMode(mode: InputMode): void {
    if (this.torn || mode === this.model.inputMode) return;
    if (this.holding) this.releaseHold();
    if (mode === "ptt") {
      this.cancelUtterance();
      this.clearPreRoll();
      this.detectors().forEach((d) => d.pause());
    } else {
      this.detectors().forEach((d) => d.start());
    }
    this.dispatch({ type: "input-mode", mode });
  }

  /** 免提/听筒:换增益预设、保存选择;关掉免提时检测器从头判断。 */
  setSpeaker(on: boolean): void {
    if (this.torn || on === this.model.speaker) return;
    this.player?.setVolume(speakerVolume(on));
    saveSpeakerPreference(on, this.env.routePrefs);
    this.dispatch({ type: "speaker", on });
  }

  /** 按下说话键(任何模式):打断机器人,开始手动的一句;自动检测到的一句进行中时并入这次按住。 */
  pttDown(): void {
    if (this.torn || this.model.muted || this.holding) return;
    this.holding = true;
    this.holdStartedAt = this.now();
    if (this.speaking) {
      this.holdLive = true;
    } else {
      this.interruptBot();
      this.speaking = true;
      this.sentInUtterance = 0;
      this.holdLive = false;
      this.holdBuffer = this.preRoll;
      this.clearPreRoll();
    }
    this.dispatch({ type: "holding", on: true });
  }

  pttUp(): void {
    if (!this.holding || this.torn) return;
    this.releaseHold();
  }

  /** 结束按住:够长就结束这一句,太短(不足 MIN_HOLD_MS,帧还没发出)就整句丢弃、什么都不发。 */
  private releaseHold(): void {
    this.holding = false;
    if (!this.holdLive && this.now() - this.holdStartedAt >= MIN_HOLD_MS) this.flushHold();
    if (this.holdLive) this.endUtterance();
    else this.cancelUtterance();
    this.holdLive = false;
    this.holdBuffer = [];
    this.detectors().forEach((d) => d.reset()); // 按住期间检测器听到的不算
    this.dispatch({ type: "holding", on: false });
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
    this.holding = false;
    this.holdBuffer = [];
    this.preRoll = [];
    this.abort.abort();
    this.o.context.removeEventListener?.("statechange", this.onContextState);
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
    if (this.energy) void this.energy.destroy();
    this.energy = null;
    if (this.player) {
      this.player.close();
      releaseAudio(this.focus);
    }
    this.player = null;
    this.output?.release();
    this.output = null;
    this.restoreSession?.();
    this.restoreSession = null;
    if (this.o.ownsContext) void this.o.context.close?.()?.catch?.((): void => undefined);
  }
}

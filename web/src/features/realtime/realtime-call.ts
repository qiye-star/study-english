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
const PRE_ROLL_SAMPLES = (TARGET_RATE * PRE_ROLL_MS) / 1000;

export interface RealtimeEnv {
  WebSocket: new (url: string) => WebSocket;
  capture: CaptureEnv;
  createVad: typeof createVad;
  location: { protocol: string; host: string };
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
   * 是否由本对象负责关闭 `context`(默认 true:页面在点击里为这次通话新建并交出所有权)。
   * 传入页面级共享上下文(`getPageAudioContext`,R31)时必须为 false:通话结束只断开自己的节点,从不关闭它。
   */
  ownsContext?: boolean;
  start: StartPayload;
  sampleRateOut: number;
  env?: RealtimeEnv;
  onChange(model: CallModel): void;
  onUserMessage?(messageId: string, text: string): void;
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

  async start(): Promise<void> {
    if (this.torn || this.started) return;
    this.started = true;
    this.dispatch({ type: "connect" });
    try {
      const { ticket } = await createRealtimeTicket(this.o.api, this.o.conversationId, this.abort.signal);
      if (this.torn) return;

      this.player = createPcmPlayer(this.o.context, { sampleRate: this.o.sampleRateOut });
      this.player.onDrained(() => this.updateSensitivity());
      claimAudio(this.focus); // 通话期间不得有其他播放

      const capture = await startPcmCapture({ env: this.env.capture, context: this.o.context });
      if (this.torn) return capture.release();
      this.capture = capture;
      capture.onFrame((frame) => this.onFrame(frame));
      capture.onTrackEnded(() => this.end("web.realtime.errors.micLost"));

      await this.loadVad(capture.stream);
      if (this.torn) return;

      const ws = new this.env.WebSocket(realtimeUrl(ticket, this.env.location));
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      ws.onopen = () => ws.send(encodeStart(this.o.start));
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
      this.dispatch({ type: "ptt", on: true });
      this.dispatch({ type: "notice", key: "web.realtime.vadUnavailable" });
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
    if (event.type === "transcript_final" && event.text && event.messageId) this.o.onUserMessage?.(event.messageId, event.text);
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
    this.sendText(encodeControl("hangup"));
    this.finish({ type: "closed", code: 1000 });
  }

  /** 页面主动结束(切后台、麦克风中断等):带原因结束并挂断。 */
  end(errorKey: string): void {
    if (this.torn) return;
    this.sendText(encodeControl("hangup"));
    this.finish({ type: "fail", errorKey });
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
    if (ws) {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      if (ws.readyState === 0 || ws.readyState === 1) {
        try {
          ws.close(1000);
        } catch {
          /* 已关闭 */
        }
      }
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
    if (this.o.ownsContext !== false) void this.o.context.close?.()?.catch?.((): void => undefined);
  }
}

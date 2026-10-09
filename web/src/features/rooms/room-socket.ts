import { encodeHello, encodePing, isTerminalClose, parseRoomEvent, ROOM_CLOSE, type RoomEvent } from "./protocol";

export const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];
export const PING_MS = 25_000;
const CLOSE_REASON: Record<number, string> = {
  [ROOM_CLOSE.DISABLED]: "disabled", [ROOM_CLOSE.NOT_FOUND]: "not_found", [ROOM_CLOSE.KICKED]: "kicked", [ROOM_CLOSE.PROTOCOL]: "protocol",
};

export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: { code: number }) => void) | null;
}

export interface RoomSocketOptions {
  getTicket(): Promise<string>;
  url(ticket: string): string;
  lastSeq(): number;
  onEvent(e: RoomEvent): void;
  onStatus(s: "connecting" | "live" | "reconnecting" | "closed", reason?: string): void;
  createSocket?(url: string): SocketLike;
  backoffMs?: number[];
  pingMs?: number;
  /** 票据错误是否终止重连;返回字符串时作为关闭原因(默认 not_found)。 */
  isTerminalTicketError?(err: unknown): boolean | string;
}

/**
 * 房间连接(spec §5.7):每次连接都取新票据;首帧 hello{last_seq};断线按退避重连;终止码不再重连。
 * 票据只进 URL:不记录、不放进状态或错误里。
 */
export class RoomSocket {
  private ws: SocketLike | null = null;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private everLive = false;
  /** 最近一次收到帧的时间:iOS 挂起后连接可能已被服务端关掉,却还没有 close 事件 */
  private lastFrameAt = 0;

  constructor(private readonly o: RoomSocketOptions) {}

  connect(): void {
    if (this.stopped) return;
    this.o.onStatus(this.everLive || this.attempt > 0 ? "reconnecting" : "connecting");
    void this.open();
  }

  private async open(): Promise<void> {
    let ticket: string;
    try {
      ticket = await this.o.getTicket();
    } catch (err) {
      if (this.stopped) return;
      const terminal = this.o.isTerminalTicketError?.(err);
      if (terminal) return this.finish(typeof terminal === "string" ? terminal : "not_found");
      return this.schedule();
    }
    if (this.stopped) return;
    const ws = (this.o.createSocket ?? ((url: string) => new WebSocket(url) as unknown as SocketLike))(this.o.url(ticket));
    this.ws = ws;
    ws.onopen = () => {
      this.lastFrameAt = Date.now();
      ws.send(encodeHello(this.o.lastSeq()));
      this.clearPing();
      this.ping = setInterval(() => {
        if (this.silent()) this.drop();
        else this.send(encodePing());
      }, this.o.pingMs ?? PING_MS);
    };
    ws.onmessage = (e) => {
      if (this.ws === ws) this.lastFrameAt = Date.now();
      const event = typeof e.data === "string" ? parseRoomEvent(e.data) : null;
      if (!event) return;
      if (event.type === "welcome") {
        this.attempt = 0;
        this.everLive = true;
        this.o.onStatus("live");
      }
      this.o.onEvent(event);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.clearPing();
      this.ws = null;
      if (this.stopped) return;
      if (isTerminalClose(e.code)) return this.finish(CLOSE_REASON[e.code]);
      this.o.onStatus("reconnecting");
      this.schedule();
    };
  }

  private schedule(): void {
    if (this.stopped) return;
    const steps = this.o.backoffMs ?? BACKOFF_MS;
    const delay = steps[Math.min(this.attempt, steps.length - 1)];
    this.attempt += 1;
    this.timer = setTimeout(() => { this.timer = null; this.connect(); }, delay);
  }

  private clearPing(): void {
    if (this.ping) clearInterval(this.ping);
    this.ping = null;
  }

  private finish(reason?: string): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.clearPing();
    this.o.onStatus("closed", reason);
  }

  /** 只在连接打开时发送;返回是否已发出。 */
  send(frame: string): boolean {
    if (!this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(frame);
    return true;
  }

  /** 两个心跳周期都没有任何帧(包括 pong):连接已死 */
  private silent(): boolean {
    return this.ws?.readyState === 1 && Date.now() - this.lastFrameAt > (this.o.pingMs ?? PING_MS) * 2;
  }

  /** 主动丢弃一条死连接,按非终止断线处理(重连并从 lastSeq 补发)。 */
  private drop(): void {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null; // 先解绑:随后的 onclose 不再处理
    this.clearPing();
    ws.close(ROOM_CLOSE.NORMAL);
    this.o.onStatus("reconnecting");
    this.schedule();
  }

  /** 页面重新可见:正在退避等待时立即重连;连接看似打开却早已没有帧时,丢弃并立即重连。 */
  reconnectNow(): void {
    if (this.stopped) return;
    if (this.silent()) this.drop();
    if (this.ws || !this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.connect();
  }

  close(): void {
    if (this.stopped) return;
    const ws = this.ws;
    this.ws = null;
    this.finish();
    ws?.close(ROOM_CLOSE.NORMAL);
  }
}

import { VOICE_MAX_MS } from "./use-voice-turn";

/** 按住说话的手势状态机(计划 R11)。纯函数:时间与坐标都由事件带入。 */
export const SHORT_PRESS_MS = 300;
export const SLIDE_ARM_PX = 80;
export const SLIDE_DISARM_PX = 40;
export const MAX_HOLD_MS = VOICE_MAX_MS - 250;

export type HoldState = "idle" | "pressing" | "recording" | "armed-cancel" | "armed-text" | "keyboard";
export interface HoldModel {
  state: HoldState;
  startY: number;
  downAt: number;
  width: number;
  micReady: boolean;
}
export type HoldEvent =
  | { type: "down"; x: number; y: number; t: number; width: number }
  | { type: "mic-ready" }
  | { type: "mic-failed" }
  | { type: "move"; x: number; y: number }
  | { type: "up"; t: number }
  | { type: "cancel" }
  | { type: "max" }
  | { type: "key" }
  | { type: "escape" }
  | { type: "reset" };
export type DiscardReason = "short" | "not-ready" | "slide" | "cancel";
export type HoldEffect = { type: "start" } | { type: "finish"; deliver: "send" | "fill" } | { type: "discard"; reason: DiscardReason };

export const IDLE: HoldModel = { state: "idle", startY: 0, downAt: 0, width: 0, micReady: false };
const out = (model: HoldModel, ...effects: HoldEffect[]) => ({ model, effects });
const idle = (...effects: HoldEffect[]) => out(IDLE, ...effects);

function zone(model: HoldModel, x: number, y: number): HoldState {
  const dy = y - model.startY;
  const armed = model.state === "armed-cancel" || model.state === "armed-text";
  if (armed ? dy > -SLIDE_DISARM_PX : dy > -SLIDE_ARM_PX) return "recording";
  return x < model.width / 2 ? "armed-cancel" : "armed-text";
}

export function holdReducer(model: HoldModel, event: HoldEvent): { model: HoldModel; effects: HoldEffect[] } {
  const s = model.state;
  if (event.type === "reset") return s === "idle" ? out(model) : idle();
  if (s === "idle") {
    if (event.type === "down") return out({ state: "pressing", startY: event.y, downAt: event.t, width: event.width, micReady: false }, { type: "start" });
    if (event.type === "key") return out({ ...IDLE, state: "keyboard" }, { type: "start" });
    return out(model);
  }
  if (event.type === "mic-failed") return idle();
  if (event.type === "cancel" || event.type === "escape") return idle({ type: "discard", reason: "cancel" });
  if (s === "keyboard") {
    if (event.type === "mic-ready") return out({ ...model, micReady: true });
    if (event.type === "key") return model.micReady ? idle({ type: "finish", deliver: "send" }) : idle({ type: "discard", reason: "not-ready" });
    if (event.type === "max") return idle({ type: "finish", deliver: "send" });
    return out(model);
  }
  if (s === "pressing") {
    if (event.type === "mic-ready") return out({ ...model, state: "recording", micReady: true });
    if (event.type === "up") return idle({ type: "discard", reason: event.t - model.downAt < SHORT_PRESS_MS ? "short" : "not-ready" });
    return out(model);
  }
  // recording / armed-cancel / armed-text
  if (event.type === "move") {
    const next = zone(model, event.x, event.y);
    return next === s ? out(model) : out({ ...model, state: next });
  }
  if (event.type === "up" || event.type === "max") {
    if (s === "armed-cancel") return idle({ type: "discard", reason: "slide" });
    if (s === "armed-text") return idle({ type: "finish", deliver: "fill" });
    if (event.type === "up" && event.t - model.downAt < SHORT_PRESS_MS) return idle({ type: "discard", reason: "short" });
    return idle({ type: "finish", deliver: "send" });
  }
  return out(model);
}

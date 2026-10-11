import type { RoomTutorInfo } from "../protocol";

/** 剩余秒数:以服务端发出 agent_tutor 时的 remainingMs 为准,减去本地收到之后过去的时间(不依赖两端时钟一致)。 */
export function secondsLeft(tutor: RoomTutorInfo | null, receivedAt: number, now: number): number | null {
  if (!tutor || tutor.phase !== "await_answer" || tutor.remainingMs === null) return null;
  return Math.max(0, Math.ceil((tutor.remainingMs - Math.max(0, now - receivedAt)) / 1000));
}

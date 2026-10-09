/** 测试用数据(camelCase,即 api.ts 转换后的形状)。放在 *.test.tsx 之外,导入时不会重复执行测试。 */
import type { AdminMessage, Report, RoomDetail, RoomRow, Timeline } from "./api";

export const roomRow = (over: Partial<RoomRow> = {}): RoomRow => ({
  id: "r1", code: "482913", lastCode: "482913", topic: "美食", status: "open", owner: { id: 11111111, name: "alice" },
  memberCount: 2, onlineCount: 1, messageCount: 3, openReports: 0, locked: false, aiPublic: true, aiMuted: false,
  createdAt: "2026-10-09T09:00:00Z", lastActiveAt: "2026-10-09T09:05:00Z", closedAt: null, closeReason: null, ...over,
});

export const roomFixture = (over: Partial<RoomDetail> = {}): RoomDetail => ({
  ...roomRow(),
  reportCount: 1,
  members: [
    { userId: 11111111, name: "alice", role: "owner", joinedAt: "2026-10-09T09:00:00Z", leftAt: null, kicked: false, online: true },
    { userId: 22222222, name: "bob", role: "member", joinedAt: "2026-10-09T09:01:00Z", leftAt: null, kicked: false, online: false },
  ],
  ...over,
});

export const message = (seq: number, over: Partial<AdminMessage> = {}): AdminMessage => ({
  seq, id: `m${seq}`, lane: "public", kind: "text", sender: { kind: "user", id: 22222222, name: "bob" }, audience: null,
  text: `message ${seq}`, meta: null, assisted: false, replyTo: null, aiStatus: null, createdAt: "2026-10-09T09:02:00Z",
  hidden: false, hiddenAt: null, ...over,
});

export const timelineFixture = (over: Partial<Timeline> = {}): Timeline => ({
  messages: [
    message(1, { kind: "system", sender: { kind: "system", id: null, name: null }, text: "joined", meta: { name: "bob" } }),
    message(42, { text: "I like chocolate, especially dark chocolate." }),
    message(43, { text: "buy cheap followers", hidden: true, hiddenAt: "2026-10-09T09:03:00Z" }),
  ],
  nextBeforeSeq: null,
  ...over,
});

export const reportFixture = (over: Partial<Report> = {}): Report => ({
  id: 7, room: { id: "r1", topic: "美食", code: "482913" },
  message: { id: "m43", seq: 43, text: "buy cheap followers", hidden: false, sender: { kind: "user", id: 22222222, name: "bob" } },
  reporter: { id: 11111111, name: "alice" }, reason: "spam", createdAt: "2026-10-09T09:04:00Z",
  resolvedAt: null, resolvedBy: null, resolution: null, ...over,
});

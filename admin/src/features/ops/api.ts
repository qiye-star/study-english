import { request } from "../../api/client";
import type { MaintenanceMode } from "../../api/session";

/** 运维接口(/api/admin/system、logs、announcements、maintenance、backups、housekeeping)。snake_case → camelCase。 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export type TaskName = "watcher" | "metering" | "rooms_sweeper" | "backups";

export interface SystemStatus {
  version: string;
  buildSha: string;
  python: string;
  startedAt: string;
  uptimeSeconds: number;
  workers: number;
  db: { backend: string; sizeBytes: number | null; alembicCurrent: string | null; alembicHead: string | null };
  disk: { path: string; total: number | null; used: number | null; free: number | null };
  recordingsBytes: number;
  realtimeActive: number;
  roomsConnections: number;
  meter: { depth: number; dropped: number };
  /** true = 运行中,false = 已停止,null = 未启动 */
  tasks: Record<TaskName, boolean | null>;
  settings: { revision: number; safeMode: boolean; pendingRestart: string[]; invalid: Record<string, string>; loadError: string | null };
  findings: { error: number; warn: number };
}

export async function getSystem(): Promise<SystemStatus> {
  const r = await request<any>("/api/admin/system");
  return {
    version: r.version,
    buildSha: r.build_sha ?? "",
    python: r.python,
    startedAt: r.started_at,
    uptimeSeconds: r.uptime_seconds,
    workers: r.workers,
    db: { backend: r.db.backend, sizeBytes: r.db.size_bytes ?? null, alembicCurrent: r.db.alembic_current ?? null, alembicHead: r.db.alembic_head ?? null },
    disk: r.disk,
    recordingsBytes: r.recordings_bytes ?? 0,
    realtimeActive: r.realtime_active ?? 0,
    roomsConnections: r.rooms_connections ?? 0,
    meter: r.meter,
    tasks: r.tasks,
    settings: {
      revision: r.settings.revision,
      safeMode: !!r.settings.safe_mode,
      pendingRestart: r.settings.pending_restart ?? [],
      invalid: r.settings.invalid ?? {},
      loadError: r.settings.load_error ?? null,
    },
    findings: r.findings,
  };
}

export interface LogEntry {
  id: number;
  at: string;
  level: string;
  logger: string;
  message: string;
}

export interface LogQuery {
  level?: string;
  logger?: string;
  q?: string;
  afterId?: number;
}

export async function getLogs({ level, logger, q, afterId }: LogQuery): Promise<LogEntry[]> {
  const r = await request<{ entries: LogEntry[] }>("/api/admin/logs", { query: { level, logger, q, after_id: afterId } });
  return r.entries;
}

export type AnnouncementLevel = "info" | "warning";
export type AnnouncementStatus = "active" | "scheduled" | "ended" | "archived";

export interface Announcement {
  id: number;
  level: AnnouncementLevel;
  textZh: string;
  textEn: string;
  dismissible: boolean;
  startsAt: string;
  endsAt: string | null;
  status: AnnouncementStatus;
  createdBy: string;
}

export interface AnnouncementInput {
  level: AnnouncementLevel;
  textZh: string;
  textEn: string;
  startsAt: string;
  endsAt: string | null;
  dismissible: boolean;
}

const toAnnouncement = (a: any): Announcement => ({
  id: a.id,
  level: a.level,
  textZh: a.text_zh,
  textEn: a.text_en,
  dismissible: a.dismissible,
  startsAt: a.starts_at,
  endsAt: a.ends_at ?? null,
  status: a.status,
  createdBy: a.created_by,
});

const fromInput = (d: AnnouncementInput) => ({
  level: d.level,
  text_zh: d.textZh,
  text_en: d.textEn,
  starts_at: d.startsAt,
  ends_at: d.endsAt,
  dismissible: d.dismissible,
});

export async function listAnnouncements(): Promise<Announcement[]> {
  const r = await request<{ announcements: any[] }>("/api/admin/announcements");
  return r.announcements.map(toAnnouncement);
}

export async function createAnnouncement(data: AnnouncementInput): Promise<Announcement> {
  return toAnnouncement(await request("/api/admin/announcements", { method: "POST", json: fromInput(data) }));
}

export async function updateAnnouncement(id: number, data: AnnouncementInput): Promise<Announcement> {
  return toAnnouncement(await request(`/api/admin/announcements/${id}`, { method: "PATCH", json: fromInput(data) }));
}

export async function archiveAnnouncement(id: number): Promise<void> {
  await request(`/api/admin/announcements/${id}`, { method: "DELETE" });
}

export interface MaintenanceState {
  mode: MaintenanceMode;
  messageZh: string;
  messageEn: string;
}

export async function getMaintenance(): Promise<MaintenanceState> {
  const r = await request<any>("/api/admin/maintenance");
  return { mode: r.mode, messageZh: r.message_zh ?? "", messageEn: r.message_en ?? "" };
}

export interface MaintenanceInput extends MaintenanceState {
  reason: string;
  confirm?: string;
}

/** 超级管理员;打开维护需要二次验证(客户端自动弹框重放)与输入确认短语。 */
export async function setMaintenance(data: MaintenanceInput): Promise<void> {
  await request("/api/admin/maintenance", {
    method: "POST",
    json: { mode: data.mode, message_zh: data.messageZh, message_en: data.messageEn, reason: data.reason, confirm: data.confirm },
  });
}

export interface Backup {
  name: string;
  bytes: number;
  createdAt: string;
}

export interface BackupList {
  supported: boolean;
  hint: string | null;
  keep: number;
  hourUtc: number;
  backups: Backup[];
}

const toBackup = (b: any): Backup => ({ name: b.name, bytes: b.bytes, createdAt: b.created_at });

export async function listBackups(): Promise<BackupList> {
  const r = await request<any>("/api/admin/backups");
  return { supported: !!r.supported, hint: r.hint ?? null, keep: r.keep, hourUtc: r.hour_utc, backups: (r.backups ?? []).map(toBackup) };
}

export async function createBackup(): Promise<Backup> {
  return toBackup(await request("/api/admin/backups", { method: "POST" }));
}

/** 60 秒有效、一次性、绑定当前会话的下载地址(需要二次验证)。 */
export async function backupLink(name: string): Promise<string> {
  const r = await request<{ url: string }>(`/api/admin/backups/${encodeURIComponent(name)}/link`, { method: "POST" });
  return r.url;
}

export async function deleteBackup(name: string): Promise<void> {
  await request(`/api/admin/backups/${encodeURIComponent(name)}`, { method: "DELETE" });
}

export type HousekeepingTool = "orphan_recordings" | "audit" | "room_audio";

export interface OrphanScan {
  token: string;
  count: number;
  bytes: number;
  samples: string[];
}

export interface AuditScan {
  retentionDays: number;
  count: number;
}

/** 房间语音清理的预演:结束超过 N 天的房间音频 + 孤儿文件 + 过期暂存;`confirm` 是执行时要原样输入的短语。 */
export interface RoomAudioScan extends OrphanScan {
  rooms: number;
  olderThanDays: number;
  confirm: string;
}

export async function scanHousekeeping(tool: "orphan_recordings"): Promise<OrphanScan>;
export async function scanHousekeeping(tool: "audit"): Promise<AuditScan>;
export async function scanHousekeeping(tool: "room_audio", olderThanDays: number): Promise<RoomAudioScan>;
export async function scanHousekeeping(tool: HousekeepingTool, olderThanDays?: number): Promise<OrphanScan | AuditScan | RoomAudioScan> {
  const json = tool === "room_audio" ? { older_than_days: olderThanDays } : undefined;
  const r = await request<any>(`/api/admin/housekeeping/${tool}/scan`, { method: "POST", json });
  if (tool === "audit") return { retentionDays: r.retention_days, count: r.count };
  if (tool === "room_audio") {
    return { token: r.token, count: r.count, bytes: r.bytes, samples: r.samples ?? [], rooms: r.rooms, olderThanDays: r.older_than_days, confirm: r.confirm };
  }
  return r;
}

export async function runHousekeeping(
  tool: HousekeepingTool,
  data: { token?: string; olderThanDays?: number; reason: string; confirm?: string },
): Promise<{ deleted: number }> {
  return request(`/api/admin/housekeeping/${tool}/run`, {
    method: "POST",
    json: { token: data.token, older_than_days: data.olderThanDays, reason: data.reason, confirm: data.confirm },
  });
}

export interface StorageSummary {
  roomAudio: { files: number; bytes: number; stagingBytes: number; byMonth: { month: string; files: number; bytes: number }[] };
  recordings: { files: number; bytes: number };
  topVoiceUsers: { userId: number; username: string | null; bytes: number }[];
}

/** 存储用量(viewer):房间语音(永久保存)、暂存 WAV、跟读录音、按月增长、语音存储 Top 10。 */
export async function getStorage(): Promise<StorageSummary> {
  const r = await request<any>("/api/admin/storage");
  return {
    roomAudio: {
      files: r.room_audio.files,
      bytes: r.room_audio.bytes,
      stagingBytes: r.room_audio.staging_bytes,
      byMonth: r.room_audio.by_month ?? [],
    },
    recordings: r.recordings,
    topVoiceUsers: (r.top_voice_users ?? []).map((u: any) => ({ userId: u.user_id, username: u.username ?? null, bytes: u.bytes })),
  };
}

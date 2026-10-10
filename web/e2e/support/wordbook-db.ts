import { execFileSync } from "node:child_process";

/**
 * 背单词 E2E 的数据库夹具(计划 2026-10-11-wordbook-recall Z1):把一个测试用户的若干词改成「已到期」,好让复习出题。
 * 服务端没有(也不该有)让词提前到期的接口,所以直接改 vocabulary_items.due_at:
 * - 本机临时栈:`E2E_SQLITE_PATH=<临时 SQLite 文件>`,用 Node 自带的 node:sqlite;
 * - Docker E2E 栈:`E2E_COMPOSE_PROJECT=enjoy-e2e`(可选 `E2E_COMPOSE_FILES=docker-compose.yml,docker-compose.e2e.yml`),
 *   在 server 容器里用 python 的 sqlite3 改 /data/app.db。
 * 两个都没设时 `available()` 为 false,调用方跳过复习那一段并写注解。只改测试用户自己的行;不读写任何密钥。
 */
export interface DueRow { word: string; box: number; reps: number }

export function available(): boolean {
  return Boolean(process.env.E2E_SQLITE_PATH || process.env.E2E_COMPOSE_PROJECT);
}

const PAST = "2000-01-01 00:00:00.000000"; // SQLAlchemy 在 SQLite 里存的无时区 UTC 文本格式

const PY = `
import json, sqlite3, sys
db = sqlite3.connect("/data/app.db")
user, words = sys.argv[1], json.loads(sys.argv[2])
uid = db.execute("select id from users where username = ?", (user,)).fetchone()[0]
if words:
    db.executemany("update vocabulary_items set due_at = ? where user_id = ? and word = ?", [(sys.argv[3], uid, w) for w in words])
    db.commit()
rows = db.execute("select word, box, reps from vocabulary_items where user_id = ?", (uid,)).fetchall()
print(json.dumps({"uid": uid, "rows": rows}))
`;

function viaDocker(username: string, words: string[]): { uid: number; rows: [string, number, number][] } {
  const files = (process.env.E2E_COMPOSE_FILES ?? "docker-compose.yml,docker-compose.e2e.yml").split(",").flatMap((f) => ["-f", f]);
  const out = execFileSync("docker", ["compose", "-p", process.env.E2E_COMPOSE_PROJECT!, ...files, "exec", "-T", "server",
    "python", "-c", PY, username, JSON.stringify(words), PAST], { cwd: `${__dirname}/../../..`, encoding: "utf8" });
  return JSON.parse(out);
}

async function viaSqlite(username: string, words: string[]): Promise<{ uid: number; rows: [string, number, number][] }> {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(process.env.E2E_SQLITE_PATH!);
  try {
    const uid = (db.prepare("select id from users where username = ?").get(username) as { id: number }).id;
    const update = db.prepare("update vocabulary_items set due_at = ? where user_id = ? and word = ?");
    for (const w of words) update.run(PAST, uid, w);
    const rows = (db.prepare("select word, box, reps from vocabulary_items where user_id = ?").all(uid) as { word: string; box: number; reps: number }[])
      .map((r) => [r.word, r.box, r.reps] as [string, number, number]);
    return { uid, rows };
  } finally {
    db.close();
  }
}

async function run(username: string, words: string[]) {
  return process.env.E2E_SQLITE_PATH ? viaSqlite(username, words) : viaDocker(username, words);
}

/** 该用户的全部词条(词、盒子、reps)与用户 id。 */
export async function rowsOf(username: string): Promise<{ uid: number; rows: DueRow[] }> {
  const { uid, rows } = await run(username, []);
  return { uid, rows: rows.map(([word, box, reps]) => ({ word, box, reps })) };
}

/** 把这些词改成已到期(due_at 设为很久以前)。 */
export async function makeDue(username: string, words: string[]): Promise<void> {
  await run(username, words);
}

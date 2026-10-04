/**
 * Small persistent key/value cache on IndexedDB with an in-memory layer.
 * - Entries expire after TTL_MS and the store is bounded to MAX_ENTRIES (oldest evicted).
 * - Any IndexedDB failure (private mode, quota, blocked) silently degrades to the in-memory layer.
 */
const DB_NAME = "enjoy-web";
const STORE = "kv";
const VERSION = 1;
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;
const MAX_MEMORY = 200;
const PRUNE_EVERY = 25;

interface Envelope {
  v: unknown;
  at: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;
let memory = new Map<string, Envelope>();
let writesSincePrune = 0;
let prunedThisSession = false;
let pruning: Promise<void> = Promise.resolve();

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined" || !indexedDB) return reject(new Error("IndexedDB unavailable"));
      let settled = false;
      const fail = (err: unknown) => {
        settled = true;
        reject(err);
      };
      const request = indexedDB.open(DB_NAME, VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => {
        // A request that already failed (e.g. blocked) must not leak a late-opened connection.
        if (settled) {
          request.result.close();
          return;
        }
        settled = true;
        // let other tabs / deleteDatabase proceed instead of blocking on this connection
        request.result.onversionchange = () => {
          request.result.close();
          dbPromise = null;
        };
        resolve(request.result);
      };
      request.onerror = () => fail(request.error);
      request.onblocked = () => fail(new Error("IndexedDB blocked"));
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = fn(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
      }),
  );
}

function isEnvelope(x: unknown): x is Envelope {
  return !!x && typeof x === "object" && typeof (x as Envelope).at === "number" && "v" in (x as object);
}

function remember(key: string, env: Envelope) {
  memory.delete(key);
  memory.set(key, env);
  if (memory.size > MAX_MEMORY) memory.delete(memory.keys().next().value as string);
}

/** Read all rows (key + value) in ONE transaction so keys and times can never be mispaired. */
function readAll(db: IDBDatabase): Promise<Array<{ key: IDBValidKey; at: number }>> {
  return new Promise((resolve, reject) => {
    const rows: Array<{ key: IDBValidKey; at: number }> = [];
    const request = db.transaction(STORE, "readonly").objectStore(STORE).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve(rows);
      rows.push({ key: cursor.key, at: isEnvelope(cursor.value) ? cursor.value.at : 0 });
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

/** Drop expired entries and evict the oldest beyond MAX_ENTRIES. Best effort. */
async function prune(): Promise<void> {
  const db = await openDb();
  const rows = await readAll(db);
  const now = Date.now();
  const dead = new Set<IDBValidKey>(rows.filter((r) => now - r.at > TTL_MS).map((r) => r.key));
  const live = rows.filter((r) => !dead.has(r.key)).sort((a, b) => a.at - b.at);
  for (const r of live.slice(0, Math.max(0, live.length - MAX_ENTRIES))) dead.add(r.key);
  if (!dead.size) return;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const key of dead) store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Run prune without blocking the caller; failures are ignored. */
function schedulePrune(): void {
  pruning = pruning.then(() => prune()).catch(() => {});
}

/** Resolves when any scheduled prune has finished (tests). */
export function kvIdleForTests(): Promise<void> {
  return pruning;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const now = Date.now();
  const mem = memory.get(key);
  if (mem) {
    if (now - mem.at <= TTL_MS) return mem.v as T;
    memory.delete(key);
  }
  try {
    const env = await run<unknown>("readonly", (store) => store.get(key));
    if (!isEnvelope(env) || now - env.at > TTL_MS) return undefined;
    remember(key, env);
    return env.v as T;
  } catch {
    return undefined;
  }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const env: Envelope = { v: value, at: Date.now() };
  remember(key, env);
  try {
    await run("readwrite", (store) => store.put(env, key));
    // Prune once per page load (the write counter alone resets every load) and then every N writes.
    if (!prunedThisSession || ++writesSincePrune >= PRUNE_EVERY) {
      prunedThisSession = true;
      writesSincePrune = 0;
      schedulePrune();
    }
  } catch {
    /* 隐私模式、配额等:仅保留内存层 */
  }
}

/** Drop every cached entry (memory layer and IndexedDB store). Never throws. */
export async function kvClear(): Promise<void> {
  memory = new Map();
  try {
    await run("readwrite", (store) => store.clear());
  } catch {
    /* IndexedDB 不可用:内存层已清空 */
  }
}

export function resetKvCacheForTests(): void {
  dbPromise?.then((db) => db.close()).catch(() => {});
  dbPromise = null;
  memory = new Map();
  writesSincePrune = 0;
  prunedThisSession = false;
  pruning = Promise.resolve();
}

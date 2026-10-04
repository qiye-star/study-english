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

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined" || !indexedDB) return reject(new Error("IndexedDB unavailable"));
      const request = indexedDB.open(DB_NAME, VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => {
        // let other tabs / deleteDatabase proceed instead of blocking on this connection
        request.result.onversionchange = () => {
          request.result.close();
          dbPromise = null;
        };
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("IndexedDB blocked"));
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

/** Drop expired entries and evict the oldest beyond MAX_ENTRIES. Best effort. */
async function prune(): Promise<void> {
  const entries = await run<Envelope[]>("readonly", (s) => s.getAll());
  const keys = await run<IDBValidKey[]>("readonly", (s) => s.getAllKeys());
  const now = Date.now();
  const rows = keys.map((key, i) => ({ key, at: isEnvelope(entries[i]) ? entries[i].at : 0 }));
  const dead = new Set<IDBValidKey>(rows.filter((r) => now - r.at > TTL_MS).map((r) => r.key));
  const live = rows.filter((r) => !dead.has(r.key)).sort((a, b) => a.at - b.at);
  for (const r of live.slice(0, Math.max(0, live.length - MAX_ENTRIES))) dead.add(r.key);
  for (const key of dead) await run("readwrite", (s) => s.delete(key));
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
    if (++writesSincePrune >= PRUNE_EVERY) {
      writesSincePrune = 0;
      await prune();
    }
  } catch {
    /* 隐私模式、配额等:仅保留内存层 */
  }
}

export function resetKvCacheForTests(): void {
  dbPromise?.then((db) => db.close()).catch(() => {});
  dbPromise = null;
  memory = new Map();
  writesSincePrune = 0;
}

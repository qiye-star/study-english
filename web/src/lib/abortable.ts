export function abortError(): Error {
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}

/** Each caller can abort its own wait; the shared underlying request keeps running for the others. */
export function withSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

/** 同一个键同时只有一次加载;结束(成功或失败)后移除,失败不会被记住。 */
export function inflightDedupe<T>(): (key: string, load: () => Promise<T>) => Promise<T> {
  const inflight = new Map<string, Promise<T>>();
  return (key, load) => {
    let p = inflight.get(key);
    if (!p) {
      p = load().finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    return p;
  };
}

function callLoad<T>(load: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
  try {
    return load(signal);
  } catch (err) {
    return Promise.reject(err);
  }
}

/**
 * 与 inflightDedupe 相同的共享,但底层加载可被中止:每个调用方带自己的 signal 等待;
 * 所有等待者都离开(都已中止)时才中止共享加载并移除,下一个调用方重新开始。没有 signal 的调用方会一直等到结束。
 */
export function abortableDedupe<T>(): (key: string, load: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal) => Promise<T> {
  const inflight = new Map<string, { promise: Promise<T>; controller: AbortController; waiters: number }>();
  return (key, load, signal) => {
    if (signal?.aborted) return Promise.reject(abortError());
    let entry = inflight.get(key);
    if (!entry) {
      const controller = new AbortController();
      const created: { promise: Promise<T>; controller: AbortController; waiters: number } = {
        controller,
        waiters: 0,
        promise: callLoad(load, controller.signal)
          .finally(() => { if (inflight.get(key) === created) inflight.delete(key); }),
      };
      created.promise.catch((): void => undefined); // 全部等待者离开后的拒绝不算未处理
      inflight.set(key, created);
      entry = created;
    }
    const shared = entry;
    shared.waiters += 1;
    if (!signal) return shared.promise; // 永不离开的等待者:不会中止
    const leave = () => {
      shared.waiters -= 1;
      if (shared.waiters === 0) {
        if (inflight.get(key) === shared) inflight.delete(key);
        shared.controller.abort();
      }
    };
    signal.addEventListener("abort", leave, { once: true });
    const settled = () => signal.removeEventListener("abort", leave);
    shared.promise.then(settled, settled);
    return withSignal(shared.promise, signal);
  };
}

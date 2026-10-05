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

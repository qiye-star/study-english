export function registerServiceWorker(
  env: { prod: boolean } = { prod: import.meta.env.PROD },
  nav: Navigator = navigator,
  win: Window = window,
): boolean {
  if (!env.prod || !("serviceWorker" in nav)) return false;
  win.addEventListener("load", () => {
    void nav.serviceWorker.register("/sw.js").catch((): void => undefined);
  });
  return true;
}

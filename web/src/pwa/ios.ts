export function shouldShowIosInstallHint(
  userAgent: string,
  navigatorStandalone: boolean | undefined,
  displayModeStandalone: boolean,
): boolean {
  const isIos = /iPhone|iPad|iPod/.test(userAgent);
  const isSafari = /Safari/.test(userAgent) && !/CriOS|FxiOS|EdgiOS/.test(userAgent);
  return isIos && isSafari && !navigatorStandalone && !displayModeStandalone;
}

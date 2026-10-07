export interface VadVersions {
  vad: string;
  ort: string;
}
export function vadAssetDirName(versions: VadVersions): string;
export function vadAssetBase(versions: VadVersions): string;
export function installedVadVersions(webRoot: string): VadVersions;
export function copyVadAssets(webRoot: string, outRoot?: string): string;

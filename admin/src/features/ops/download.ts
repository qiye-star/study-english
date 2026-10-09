/** 下载备份:先换一个 60 秒一次性链接(需要二次验证),再让浏览器用 Cookie 会话去下载。单独成模块便于测试替换。 */
export function startDownload(url: string): void {
  window.location.assign(url);
}

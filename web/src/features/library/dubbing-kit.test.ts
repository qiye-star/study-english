// @vitest-environment node
import { describe, expect, it } from "vitest";

/** 计划 R18 的清单:dubbing 只能经这个工具包拿到 library 的运行时导出(防止有人往里塞内部实现)。 */
const RUNTIME_EXPORTS = [
  "LIBRARY_SERVER_ERRORS",
  "PlayerController",
  "ScoreCard",
  "getItem",
  "isItemNotFound",
  "listItems",
  "segmentIndexAt",
  "tokenizeSentence",
  "useMediaSource",
  "usePosterUrl",
];

describe("dubbing-kit (R17/R18)", () => {
  it("exposes exactly the reviewed runtime exports", async () => {
    const kit = await import("./dubbing-kit");
    expect(Object.keys(kit).sort()).toEqual([...RUNTIME_EXPORTS].sort());
    // 首次动态导入要拉进整个 library 视觉层;在全目录并行时可能超过默认 5 s,断言本身不变。
  }, 30_000);
});

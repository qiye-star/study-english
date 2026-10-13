import { describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { ERROR_KINDS } from "./error-kinds";
import eagerEn from "./i18n/en.json";
import eagerZh from "./i18n/zh-CN.json";
import { ensureLibraryI18n } from "./locales";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

type Dict = Record<string, unknown>;
const flatten = (d: unknown, prefix = ""): Record<string, string> =>
  d && typeof d === "object"
    ? Object.entries(d as Dict).reduce<Record<string, string>>((acc, [k, v]) => ({ ...acc, ...flatten(v, prefix ? `${prefix}.${k}` : k) }), {})
    : { [prefix]: String(d) };
const placeholders = (s: string) => [...s.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();
const a = flatten(en);
const b = flatten(zh);

describe("library locales (R-L3: lazy, outside the eager i18n glob)", () => {
  it("has the same keys and placeholders in en and zh-CN, all under web.library", () => {
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    expect(Object.keys(a).every((k) => k.startsWith("web.library."))).toBe(true);
    for (const k of Object.keys(a)) expect(placeholders(a[k]), k).toEqual(placeholders(b[k]));
    for (const [k, v] of [...Object.entries(a), ...Object.entries(b)]) {
      expect(v.trim(), k).not.toBe("");
      expect(v, k).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it("covers every error kind, status, stage, subtitle source and loop mode", () => {
    for (const kind of [...ERROR_KINDS, "unknown"]) expect(a, kind).toHaveProperty([`web.library.errors.kind.${kind}`]);
    for (const s of ["uploading", "queued", "processing", "ready", "failed", "canceled"]) expect(a).toHaveProperty([`web.library.status.${s}`]);
    for (const s of ["probe", "fetch", "transcode", "subtitles", "transcribe", "segment"]) expect(a).toHaveProperty([`web.library.stage.${s}`]);
    for (const s of ["uploaded", "platform", "asr"]) expect(a).toHaveProperty([`web.library.sub.${s}`]);
    for (const s of ["off", "infinite", "3", "5"]) expect(a).toHaveProperty([`web.library.player.loop.${s}`]);
  });

  it("keeps the spec §7.4 DRM notice and the §6.2 no-subtitles text word for word in Chinese", () => {
    expect(b["web.library.link.drm"]).toBe(
      "支持 yt-dlp 能直接下载的公开视频页面(如 YouTube 等)。受 DRM 保护的流媒体服务(Netflix、Disney+、爱奇艺、腾讯视频、优酷、Spotify 等)无法导入,请使用你自己拥有的文件上传。",
    );
    expect(b["web.library.errors.kind.no_subtitles"]).toBe("这条没有字幕,管理员也没有开启自动转写;可以上传一份字幕后重新导入");
  });

  it("has the add-sheet polish strings (plan 2026-10-14-library-add-sheet-polish)", () => {
    for (const k of [
      "pickTitle", "pickDrop", "pickDrag", "formats", "replace", "remove", "subtitlesAdd", "subtitlesRemove", "titleAuto", "submitting",
    ]) expect(a).toHaveProperty([`web.library.upload.${k}`]);
    for (const k of ["paste", "submitting"]) expect(a).toHaveProperty([`web.library.link.${k}`]);
    expect(b["web.library.upload.subtitles"]).toBe("字幕(可选,.srt / .vtt)");
    expect(a["web.library.upload.subtitles"]).toBe("Subtitles (optional, .srt / .vtt)");
    expect(placeholders(a["web.library.upload.formats"])).toEqual(["list"]);
  });

  it("pre-seeds the W2 shadowing subtree (R-L4)", () => {
    for (const k of ["record", "stop", "assessing", "listenMine", "listenOriginal", "addToList", "added", "edit", "save", "cancel"]) {
      expect(a).toHaveProperty([`web.library.shadow.${k}`]);
    }
  });

  it("keeps the eager bundle to the single nav label (spec E9, R-L3)", () => {
    expect(flatten(eagerEn)).toEqual({ "web.nav.library": "Library" });
    expect(flatten(eagerZh)).toEqual({ "web.nav.library": "跟读库" });
    // 标签文字 ≤ 8 个英文字符 / ≤ 4 个汉字(E9):360 px 宽 5 列每列约 72 px
    expect([...flatten(eagerEn)["web.nav.library"]].length).toBeLessThanOrEqual(8);
    expect([...flatten(eagerZh)["web.nav.library"]].length).toBeLessThanOrEqual(4);
  });

  it("merges into i18next once loaded and pluralises English counts", () => {
    ensureLibraryI18n();
    expect(i18n.getFixedT("en")("web.library.sentences", { count: 1 })).toBe("1 sentence");
    expect(i18n.getFixedT("en")("web.library.sentences", { count: 3 })).toBe("3 sentences");
    expect(i18n.getFixedT("zh-CN")("web.library.sentences", { count: 3 })).toBe("3 句");
    expect(i18n.getFixedT("zh-CN")("web.nav.library")).toBe("跟读库");
    expect(i18n.getFixedT("en")("web.nav.library")).toBe("Library");
    expect(i18n.getFixedT("en")("web.nav.practice")).toBe("Practice"); // 深合并没有吃掉别处写的 web.nav
  });

  it("has the translation, speed-slider, chip and quota copy (D8, D11)", () => {
    for (const k of [
      "translateShort", "translateOn", "translateOff", "translateLimited", "translateFailed", "translateRetry", "chipLoop", "chipBlind", "rateSlider",
    ]) {
      expect(a).toHaveProperty([`web.library.player.${k}`]);
    }
    expect(a).toHaveProperty(["web.library.errors.aiLimited"]);
    expect(a).toHaveProperty(["web.library.usedLabel"]);
    expect(a).toHaveProperty(["web.library.addShort"]);
    expect(b["web.library.player.translateOn"]).toBe("隐藏译文");
    expect(b["web.library.player.translateOff"]).toBe("显示译文");
    expect(b["web.library.player.chipBlind"]).toBe("盲听");
    expect(b["web.library.player.rateSlider"]).toBe("播放速度");
  });
});

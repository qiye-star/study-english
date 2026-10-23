/** Z1:网页全开 / 全关矩阵(spec 2026-10-11-learning-links §15;服务端对应 server/tests/test_links_matrix.py)。 */
import { afterEach, describe, expect, it } from "vitest";
import { ALL_OFF, LINK_KEYS, POINT_NAMES, contributionsFor, routesFor, setLinkFlags, type LinkFlags } from "~/lib/extension-points";
import "~/plugins";

type Key = (typeof LINK_KEYS)[number];
const flags = (on: (k: Key) => boolean, enabled = true): LinkFlags =>
  ({ enabled, links: Object.fromEntries(LINK_KEYS.map((k) => [k, on(k)])) as LinkFlags["links"] });
const allOn = flags(() => true);
const only = (key: Key) => flags((k) => k === key);
const visibleIds = (f: LinkFlags) => POINT_NAMES.flatMap((p) => contributionsFor(p, f).map((c) => `${p}/${c.id}`)).sort();

afterEach(() => setLinkFlags(ALL_OFF));

// 词汇激活(plugins/activation)不是联动:它的「我的」一行与 /me/activation 页是核心贡献(永远登记,
// 页面与一行自己读服务端 ACTIVATION_ENABLED 决定是否显示),所以这里的核心清单多两项,联动相关的断言不变。
const ACTIVATION_CORE = ["meRows/activation.row"];
const ACTIVATION_ROUTE = "/me/activation";

describe("all-off / all-on matrix", () => {
  it("with every link off only core contributions remain (= today)", () => {
    expect(visibleIds(ALL_OFF)).toEqual(["appEffects/chat.home-open", "appEffects/links.config", "practiceHeaderActions/changelog.entry", "practiceHome/dubbing.entry", "selectionActions/chat.read-aloud", "wordActions/vocabulary.add", ...ACTIVATION_CORE].sort());
    expect(routesFor(ALL_OFF).map((r) => r.path)).toEqual([ACTIVATION_ROUTE]);
  });

  it("the master switch off hides everything even when every link flag is on", () => {
    expect(visibleIds(flags(() => true, false))).toEqual(visibleIds(ALL_OFF));
    expect(routesFor(flags(() => true, false)).map((r) => r.path)).toEqual([ACTIVATION_ROUTE]);
  });

  it("with every link on each point has its contributions", () => {
    const ids = (p: (typeof POINT_NAMES)[number]) => contributionsFor(p, allOn).map((c) => c.id);
    expect(ids("wordActions")).toEqual(["vocabulary.add", "word-actions.more"]);
    expect(ids("wordActionsMenu")).toEqual(["vocabulary.add", "wordbook.adopt", "practice.shadow", "wordbook.card"]);
    expect(ids("dailyTasks")).toEqual(["wordbook.today", "practice.shadow", "chat.talk", "rank.stage", "chat-words.task"]);
    expect(ids("practiceHome")).toEqual(["daily-tasks.card", "dubbing.entry"]);
    expect(ids("learningSources")).toEqual(["pron.weak", "pron.today"]);
    expect(ids("notebookViews")).toEqual(["mistakes.row", "pron.row"]);
    expect(ids("wordDetailSections")).toEqual(["chat-words.badge"]);
    expect(ids("meRows")).toEqual(["activation.row", "links.row"]);
    expect(ids("appEffects")).toEqual(["chat.home-open", "links.config"]);
    expect(ids("selectionActions")).toEqual(["chat.read-aloud"]);
    expect(ids("practiceHeaderActions")).toEqual(["changelog.entry"]);
    expect(routesFor(allOn).map((r) => r.path).sort()).toEqual(["/links/mistakes", "/links/weak-words", ACTIVATION_ROUTE, "/me/links"]);
  });

  it.each(LINK_KEYS)("turning on only %s adds nothing from the other links", (key) => {
    const extra = POINT_NAMES.flatMap((p) => contributionsFor(p, only(key)).filter((c) => c.link && c.link !== key));
    expect(extra).toEqual([]);
    expect(routesFor(only(key)).filter((r) => r.link && r.link !== key)).toEqual([]);
  });

  it.each(LINK_KEYS.filter((k) => k !== "rank_sources"))("turning on only %s shows its own entry points", (key) => {
    const own = POINT_NAMES.flatMap((p) => contributionsFor(p, only(key)).filter((c) => c.link === key));
    expect(own.length).toBeGreaterThan(0);
  });

  it("rank_sources is a server-only switch: it adds no web entry point of its own", () => {
    expect(POINT_NAMES.flatMap((p) => contributionsFor(p, allOn).filter((c) => c.link === "rank_sources"))).toEqual([]);
  });
});

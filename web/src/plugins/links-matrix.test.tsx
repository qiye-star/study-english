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

describe("all-off / all-on matrix", () => {
  it("with every link off only core contributions remain (= today)", () => {
    expect(visibleIds(ALL_OFF)).toEqual(["appEffects/links.config", "selectionActions/chat.read-aloud", "wordActions/vocabulary.add"]);
    expect(routesFor(ALL_OFF)).toEqual([]);
  });

  it("the master switch off hides everything even when every link flag is on", () => {
    expect(visibleIds(flags(() => true, false))).toEqual(visibleIds(ALL_OFF));
    expect(routesFor(flags(() => true, false))).toEqual([]);
  });

  it("with every link on each point has its contributions", () => {
    const ids = (p: (typeof POINT_NAMES)[number]) => contributionsFor(p, allOn).map((c) => c.id);
    expect(ids("wordActions")).toEqual(["vocabulary.add", "word-actions.more"]);
    expect(ids("wordActionsMenu")).toEqual(["vocabulary.add", "wordbook.adopt", "practice.shadow", "wordbook.card"]);
    expect(ids("dailyTasks")).toEqual(["wordbook.today", "practice.shadow", "chat.talk", "rank.stage", "chat-words.task"]);
    expect(ids("practiceHome")).toEqual(["daily-tasks.card"]);
    expect(ids("learningSources")).toEqual(["pron.weak", "pron.today"]);
    expect(ids("notebookViews")).toEqual(["mistakes.row", "pron.row"]);
    expect(ids("wordDetailSections")).toEqual(["chat-words.badge"]);
    expect(ids("meRows")).toEqual(["links.row"]);
    expect(ids("appEffects")).toEqual(["links.config"]);
    expect(ids("selectionActions")).toEqual(["chat.read-aloud"]);
    expect(routesFor(allOn).map((r) => r.path).sort()).toEqual(["/links/mistakes", "/links/weak-words", "/me/links"]);
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

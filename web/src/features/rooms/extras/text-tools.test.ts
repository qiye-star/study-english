import { expect, it } from "vitest";
import { answer, msg } from "../agents/fixtures";
import { speakable, spokenText } from "./text-tools";

it("reads only the message body: meta.noteZh never enters what is spoken (spec addressing §5.3)", () => {
  const m = answer(5, 4, { agent: { personaId: "builtin:coach", name: "Emma" }, noteZh: "abandon 指彻底放弃" }, "Try: I never abandon a project.");
  expect(speakable(m)).toBe("Try: I never abandon a project.");
  expect(spokenText(m)).not.toContain("放弃");
});

it("spokenText strips Chinese for the speak button while speakable keeps it for translation (R-AW9)", () => {
  const mixed = msg({ text: "@ai 我想说 I give up" });
  expect(speakable(mixed)).toBe("我想说 I give up");
  expect(spokenText(mixed)).toBe("I give up");
  expect(spokenText(msg({ text: "全是中文" }))).toBe("");
});

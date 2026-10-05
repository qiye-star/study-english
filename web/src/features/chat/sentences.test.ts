import { describe, expect, it } from "vitest";
import { splitSentences } from "./sentences";

describe("splitSentences", () => {
  it.each<[string, string[]]>([
    ["Hello there. How are you? I'm fine!", ["Hello there.", "How are you?", "I'm fine!"]],
    ["Mr. Smith went to Washington. He liked it.", ["Mr. Smith went to Washington.", "He liked it."]],
    ["Bring tools, e.g. a hammer. Then rest.", ["Bring tools, e.g. a hammer.", "Then rest."]],
    ["It costs $3.50 today. Nice.", ["It costs $3.50 today.", "Nice."]],
    ["Well... I think so. Maybe later.", ["Well... I think so.", "Maybe later."]],
    ["Wait… What happened? Nothing.", ["Wait… What happened?", "Nothing."]],
    ['She said, "Go home." Then she left.', ['She said, "Go home."', "Then she left."]],
    ['"Really?" he asked.', ['"Really?" he asked.']],
    ["Wow!! That is great?! Yes.", ["Wow!!", "That is great?!", "Yes."]],
    ["J. K. Rowling wrote it. I read it.", ["J. K. Rowling wrote it.", "I read it."]],
    ["(Sure.) Let's go.", ["(Sure.)", "Let's go."]],
    ["Done. 42 is the answer.", ["Done.", "42 is the answer."]],
    ["First line\nSecond line", ["First line", "Second line"]],
    ["Ends without a period", ["Ends without a period"]],
    ["We met at 5 p.m. Then we ate.", ["We met at 5 p.m. Then we ate."]], // R17:句末缩写与下一句合并(已知限制)
    ["  \n -- \n", []],
  ])("%s", (input, expected) => {
    expect(splitSentences(input)).toEqual(expected);
  });
});

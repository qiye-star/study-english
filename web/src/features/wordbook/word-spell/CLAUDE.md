# web/src/features/wordbook/word-spell/

拼写入口与单词拼写(plan 2026-10-27 R-W1 / R-W9)。

## What lives here
- `word-spell-page.tsx` — `/wordbook/spell/words` (`WordbookWordSpellPage`, lazy): start card (玩法 radio: 单词听写 / 看中文拼英文; 10 or 20 words) → one question per screen → result + 「下一个」 → `SessionSummary` (`kind: "spell"`). Mode changes mid-question clear that question's input and peek (remount by key); answered questions keep their mode. Read-aloud is called only in click handlers (Start, 下一个, mode radio); with no TTS the dictation radio is `aria-disabled` and the page is forced to meaning.
- `word-spell-question.tsx` — one question. Dictation: only a 44 px replay button, never the word. Meaning: Chinese meaning + speaker button (reads `card.word`, no phonetic), a dashed frame around the input (`word-spell-frame`) where pressing the frame's own border (`e.target === currentTarget`) shows the word, a visible eye button (`word-spell-eye`), and a first-time line (`word-spell-peek-hint`, device flag). The word bubble (`word-spell-peek`) hides on any input change or IME `compositionstart`; the frame's mousedown is `preventDefault`ed so the keyboard stays. Peeking latches `hinted: true` for the submit. After the answer: `OutcomeBadge`, `LetterDiff`, and the expected word with `lookupContext` (the only lookup-marked element; guarded in `src/lookup-marks.wordbook.test.ts`).
- `prefs.ts` — `wordSpellMode` (default `dictation`) and `wordSpellPeekHintSeen` on the shared `WORDBOOK_PREFS_KEY`, merged on write.
- `i18n/{en,zh-CN}.json` — `web.wordSpell.*`.
- `spell-hub-page.tsx` — `/wordbook/spell`: two rows, 例句拼写 (`/wordbook/spell/sentences`, the old `../spell/` page) and 单词拼写 (`/wordbook/spell/words`). Lazy via `../lazy-pages.tsx`.
- `word-spell-api.ts` — `startWordSpell(api, count)`: `POST /api/wordbook/word-spell/start` with `count` (10 default, 20) and `tzOffsetMinutes`. Words never go in the URL. Answers use `wordbook-api.ts`'s `/answers` with `mode: "free"`.

## Status
- W1 (server), W2 (entry page + API), W3 (page + dictation) and W4 (看中文拼英文, frame peek, auto-hide) are in. Not verified on real devices: iOS keyboard behaviour on frame taps, Android IME auto-hide, and dictation autoplay after Start (see `word-spell/` plan R-W5/R-W6).

## Rules
- Words are not graded here; the server response decides right or wrong.
- Word spelling does not change boxes or rank (free-mode answers only).

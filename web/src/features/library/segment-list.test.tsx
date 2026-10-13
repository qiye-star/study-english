import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "~/test/render";
import type { LibrarySegment } from "./library-api";
import { SegmentList } from "./segment-list";
import { setUiLanguage } from "./test-i18n";

const SEGS: LibrarySegment[] = [
  { idx: 0, startMs: 1000, endMs: 3000, text: "Hello there.", zh: "你好。", zhLang: "zh-CN" },
  { idx: 1, startMs: 3200, endMs: 6000, text: "How are you today?", zh: null, zhLang: null },
  { idx: 2, startMs: 9000, endMs: 11000, text: "Old note.", zh: "旧译文", zhLang: "es-ES" },
];
const NONE: ReadonlySet<number> = new Set();
const scrolls = vi.fn();

beforeEach(async () => {
  await setUiLanguage("zh-CN");
  scrolls.mockClear();
  Element.prototype.scrollIntoView = scrolls;
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

type Props = Partial<Parameters<typeof SegmentList>[0]>;
function render(props: Props = {}) {
  const onSelect = vi.fn();
  const view = renderWithProviders(
    <SegmentList itemId="i1" segments={SEGS} current={0} blind={false} durationMs={12_000} player={null} native="zh-CN"
      showTranslation={false} pending={NONE} onSelect={onSelect} onSegmentSaved={vi.fn()} {...props} />,
  );
  return { onSelect, ...view };
}

describe("SegmentList (spec §11.4, R-L17)", () => {
  it("marks the current sentence, gives it the flowing border and scrolls it into view", () => {
    render({ current: 1 });
    expect(screen.getByTestId("segment-1")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("segment-1").className).toMatch(/\blib-glow\b/);
    expect(screen.getByTestId("segment-0")).not.toHaveAttribute("aria-current");
    expect(screen.getByTestId("segment-0").className).not.toMatch(/lib-glow/);
    expect(scrolls).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
  });

  it("scrolls without animation when the system asks for reduced motion", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    render({ current: 1 });
    expect(scrolls).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
  });

  it("owns its scroll container, so the document and <main> never scroll (R-L33)", () => {
    render();
    const scroller = screen.getByTestId("library-segments");
    expect(scroller.className).toMatch(/\blib-segments\b/);
    expect(scroller.querySelector("ol")).not.toBeNull();
  });

  it("plays a sentence from its button or its text, but not while text is selected", () => {
    const { onSelect } = render();
    fireEvent.click(screen.getByRole("button", { name: "播放第 2 句" }));
    expect(onSelect).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByText("Hello there."));
    expect(onSelect).toHaveBeenLastCalledWith(0);
    const spy = vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "Hello" } as Selection);
    fireEvent.click(screen.getByText("Hello there."));
    expect(onSelect).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it("keeps the sentence text selectable for the lookup bar", () => {
    render();
    expect(screen.getByText("Hello there.").closest(".lib-seg-text")).not.toBeNull();
  });

  it("hides the text in blind mode and reveals one sentence on tap", () => {
    render({ blind: true });
    expect(screen.queryByText("Hello there.")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "显示这句" })[0]);
    expect(screen.getByText("Hello there.")).toBeInTheDocument();
    expect(screen.queryByText("How are you today?")).toBeNull();
  });

  it("does not steal the scroll for 3 s after the user scrolls the list", () => {
    let now = 10_000;
    function Harness() {
      const [current, setCurrent] = useState(0);
      return (
        <>
          <button onClick={() => setCurrent((c) => (c === 0 ? 1 : 0))}>toggle</button>
          <SegmentList itemId="i1" segments={SEGS} current={current} blind={false} durationMs={12_000} player={null} native="zh-CN"
            showTranslation={false} pending={NONE} onSelect={vi.fn()} onSegmentSaved={vi.fn()} now={() => now} />
        </>
      );
    }
    renderWithProviders(<Harness />);
    scrolls.mockClear();
    fireEvent.wheel(screen.getByTestId("library-segments"));
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(scrolls).not.toHaveBeenCalled();
    now += 3001;
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(scrolls).toHaveBeenCalled();
  });

  it("renders the W2 placeholder panel as nothing and says so when there are no sentences", () => {
    render({ segments: [] });
    expect(screen.getByText("还没有句子。")).toBeInTheDocument();
  });
});

describe("translation line (D8, E11, E12, R-L32)", () => {
  it("shows nothing when the translate switch is off", () => {
    render();
    expect(screen.queryByTestId("segment-zh-0")).toBeNull();
  });

  it("shows a stored translation under its sentence in the learner's language, as small secondary text", () => {
    render({ showTranslation: true });
    const zh = screen.getByTestId("segment-zh-0");
    expect(zh).toHaveTextContent("你好。");
    expect(zh).toHaveAttribute("lang", "zh-CN");
    expect(zh.className).toMatch(/\blib-zh\b/);
    expect(screen.getByText("Hello there.").compareDocumentPosition(zh) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("treats a translation made for another language as missing (E11)", () => {
    render({ showTranslation: true });
    expect(screen.queryByTestId("segment-zh-2")).toBeNull(); // 旧译文是西语的
    expect(screen.queryByTestId("segment-zh-skeleton-2")).toBeNull(); // 没在取,就什么也不画
  });

  it("shows a skeleton line for sentences being fetched", () => {
    render({ showTranslation: true, pending: new Set([1]) });
    expect(screen.getByTestId("segment-zh-skeleton-1").className).toMatch(/\blib-zh-skeleton\b/);
    expect(screen.queryByTestId("segment-zh-skeleton-0")).toBeNull(); // 已有译文的不画骨架
  });

  it("hides translations and skeletons in blind mode, and shows the translation again when a sentence is revealed", () => {
    render({ showTranslation: true, blind: true, pending: new Set([1]) });
    expect(screen.queryByTestId("segment-zh-0")).toBeNull();
    expect(screen.queryByTestId("segment-zh-skeleton-1")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "显示这句" })[0]);
    expect(screen.getByTestId("segment-zh-0")).toBeInTheDocument();
  });

  it("clicking the translation plays the sentence like clicking its text", () => {
    const { onSelect } = render({ showTranslation: true });
    fireEvent.click(screen.getByTestId("segment-zh-0"));
    expect(onSelect).toHaveBeenLastCalledWith(0);
  });
});

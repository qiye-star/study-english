import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BellIcon } from "lucide-react";
import { useRef, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { Avatar, avatarInitial } from "./avatar";
import { GlassTopBar, ScrollRootProvider, useScrolled, useScrollRoot } from "./glass-top-bar";
import { IconButton } from "./icon-button";
import { IconChip } from "./icon-chip";
import { ListRow, SectionGroup } from "./section-group";
import { SegmentedControl } from "./segmented-control";
import { StatTile } from "./stat-tile";
import { scoreTone, scoreToneClass } from "./score-tone";
import { SurfaceCard } from "./surface-card";
import { ToneBadge } from "./tone-badge";

describe("scoreTone", () => {
  it.each([
    [100, "good"], [85, "good"], [84.9, "fair"], [70, "fair"], [69, "low"], [0, "low"],
  ] as const)("%s -> %s", (score, tone) => expect(scoreTone(score)).toBe(tone));

  it("maps tones to the semantic text colors", () => {
    expect(scoreToneClass(92)).toBe("text-green");
    expect(scoreToneClass(78)).toBe("text-amber");
    expect(scoreToneClass(64)).toBe("text-ink-2");
  });
});

describe("avatarInitial", () => {
  it.each([["emma", "E"], ["  mingzhe", "M"], ["", "?"], ["张三", "张"], ["😀 smile", "😀"]])("%j -> %s", (name, initial) => {
    expect(avatarInitial(name)).toBe(initial);
  });

  it("renders the initial with an accessible name and size", () => {
    render(<Avatar name="Emma" size="lg" />);
    const el = screen.getByRole("img", { name: "Emma" });
    expect(el).toHaveTextContent("E");
    expect(el.className).toMatch(/\bh-24\b/);
  });

  it("shows the image when src is given (decorative, lazy, no referrer) and falls back to the initial on load error", () => {
    const src = "/api/avatars/00000000000000000000000000000000";
    render(<Avatar name="Emma" src={src} />);
    const img = document.querySelector("img");
    expect(img).toHaveAttribute("src", src);
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
    fireEvent.error(img!);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByRole("img", { name: "Emma" })).toHaveTextContent("E");
  });

  it("renders no image when src is null", () => {
    render(<Avatar name="Emma" src={null} />);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByRole("img", { name: "Emma" })).toHaveTextContent("E");
  });
});

function ScrollProbe({ threshold }: { threshold?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const scrolled = useScrolled(ref, threshold);
  return <div ref={ref} data-testid="scroller" data-scrolled={String(scrolled)} />;
}

function scrollTo(el: HTMLElement, top: number) {
  act(() => {
    el.scrollTop = top;
    fireEvent.scroll(el);
  });
}

describe("useScrolled", () => {
  it("turns on once scrollTop passes 4px and off again at the top", () => {
    render(<ScrollProbe />);
    const el = screen.getByTestId("scroller");
    expect(el.dataset.scrolled).toBe("false");
    scrollTo(el, 4);
    expect(el.dataset.scrolled).toBe("false");
    scrollTo(el, 5);
    expect(el.dataset.scrolled).toBe("true");
    scrollTo(el, 0);
    expect(el.dataset.scrolled).toBe("false");
  });

  it("honours a custom threshold", () => {
    render(<ScrollProbe threshold={40} />);
    const el = screen.getByTestId("scroller");
    scrollTo(el, 20);
    expect(el.dataset.scrolled).toBe("false");
    scrollTo(el, 41);
    expect(el.dataset.scrolled).toBe("true");
  });

  it("follows the scroll root provided by the shell", () => {
    function Bar() {
      return <span data-testid="bar" data-scrolled={String(useScrolled(useScrollRoot()))} />;
    }
    function Shell() {
      const [root, setRoot] = useState<HTMLElement | null>(null);
      return (
        <ScrollRootProvider value={root}>
          <main ref={setRoot} data-testid="main"><Bar /></main>
        </ScrollRootProvider>
      );
    }
    render(<Shell />);
    scrollTo(screen.getByTestId("main"), 30);
    expect(screen.getByTestId("bar").dataset.scrolled).toBe("true");
  });
});

describe("GlassTopBar", () => {
  it("is transparent at rest and glass with a hairline once scrolled", () => {
    const { rerender, container } = render(<GlassTopBar title="练习" subtitle="周三" scrolled={false} />);
    const header = container.querySelector("header")!;
    expect(header.className).not.toContain("glass-bar");
    expect(header.className).toContain("bg-transparent");
    expect(header.className).toContain("pt-[env(safe-area-inset-top)]");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("练习");
    expect(screen.getByText("周三")).toBeInTheDocument();
    rerender(<GlassTopBar title="练习" scrolled />);
    expect(header.className).toContain("glass-bar");
    expect(header.dataset.scrolled).toBe("true");
  });
});

describe("IconButton", () => {
  it("is a 44px labelled button with an optional indicator dot", async () => {
    const onClick = vi.fn();
    render(<IconButton label="设置" dot onClick={onClick}><BellIcon /></IconButton>);
    const btn = screen.getByRole("button", { name: "设置" });
    expect(btn.className).toMatch(/\bh-tap\b/);
    expect(btn.className).toMatch(/\bw-tap\b/);
    expect(btn).toHaveAttribute("type", "button");
    expect(btn.querySelector("[data-dot]")).not.toBeNull();
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("IconChip / ToneBadge / StatTile / SurfaceCard", () => {
  it("icon chip is decorative and tinted by tone", () => {
    const { container } = render(<IconChip tone="teal" icon={BellIcon} />);
    const chip = container.firstElementChild!;
    expect(chip).toHaveAttribute("aria-hidden", "true");
    expect(chip.className).toContain("bg-teal-tint");
    expect(chip.className).toContain("text-teal");
  });

  it("badge does not wrap", () => {
    render(<ToneBadge tone="amber">12 天</ToneBadge>);
    expect(screen.getByText("12 天").className).toContain("whitespace-nowrap");
  });

  it("stat tile shows label, tabular value and unit", () => {
    render(<StatTile tone="green" icon={BellIcon} label="平均发音" value="88.4" unit="分" />);
    expect(screen.getByText("平均发音")).toBeInTheDocument();
    const value = screen.getByText("88.4");
    expect(value.className).toContain("num");
    expect(screen.getByText("分")).toBeInTheDocument();
  });

  it("surface card renders as the requested element", () => {
    render(<SurfaceCard as="section" aria-label="卡片">x</SurfaceCard>);
    expect(screen.getByRole("region", { name: "卡片" }).className).toContain("rounded-card");
  });
});

describe("SegmentedControl", () => {
  const options = [
    { value: "auto", label: "自动", testId: "seg-auto" },
    { value: "ptt", label: "按住说话", testId: "seg-ptt" },
  ] as const;

  it("is a radiogroup whose options have 44px hit areas", () => {
    render(<SegmentedControl label="输入方式" value="auto" onChange={() => {}} options={options} />);
    expect(screen.getByRole("radiogroup", { name: "输入方式" })).toBeInTheDocument();
    const auto = screen.getByRole("radio", { name: "自动" });
    expect(auto).toHaveAttribute("aria-checked", "true");
    expect(auto.className).toContain("hit-expand");
    expect(screen.getByTestId("seg-ptt")).toHaveAttribute("aria-checked", "false");
    expect(auto).toHaveAttribute("tabindex", "0");
    expect(screen.getByTestId("seg-ptt")).toHaveAttribute("tabindex", "-1");
  });

  it("selects on click and moves with arrow keys", async () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="输入方式" value="auto" onChange={onChange} options={options} />);
    await userEvent.click(screen.getByRole("radio", { name: "按住说话" }));
    expect(onChange).toHaveBeenLastCalledWith("ptt");
    fireEvent.keyDown(screen.getByRole("radio", { name: "自动" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("ptt");
    fireEvent.keyDown(screen.getByRole("radio", { name: "自动" }), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("ptt"); // wraps
    onChange.mockClear();
    fireEvent.keyDown(screen.getByRole("radio", { name: "自动" }), { key: "Home" });
    expect(onChange).not.toHaveBeenCalled(); // already first
  });

  it("does not fire when disabled", async () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="x" value="auto" onChange={onChange} options={options} disabled />);
    await userEvent.click(screen.getByRole("radio", { name: "按住说话" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("SectionGroup / ListRow", () => {
  it("renders a labelled group of >=56px rows as button, link or static", async () => {
    const onClick = vi.fn();
    render(
      <MemoryRouter>
        <SectionGroup title="学习" action={<a href="#all">全部</a>}>
          <ListRow icon={<IconChip tone="blue" icon={BellIcon} />} title="学习进度" subtitle="近 7 天" to="/progress" testId="row-progress" />
          <ListRow title="外观" value="跟随系统" onClick={onClick} testId="row-theme" />
          <ListRow title="版本" value="1.8.0" chevron={false} />
        </SectionGroup>
      </MemoryRouter>,
    );
    const group = screen.getByRole("group", { name: "学习" });
    expect(group).toBeInTheDocument();
    const link = screen.getByTestId("row-progress");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/progress");
    expect(link.className).toMatch(/\bmin-h-row\b/);
    const button = screen.getByTestId("row-theme");
    expect(button.tagName).toBe("BUTTON");
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByText("1.8.0").closest("div")!.className).toMatch(/\bmin-h-row\b/);
    expect(screen.getByText("全部")).toBeInTheDocument();
  });
});

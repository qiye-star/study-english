import { render, screen } from "@testing-library/react";
import { MessagesSquareIcon } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";
import { setLiquid } from "~/test/glass";
import { EmptyState } from "./empty-state";
import { LQ_PANEL, LQ_PRIMARY, LQ_SECONDARY } from "./liquid";
import { ScoreDot, scoreDotClass } from "./score-dot";
import { TOAST_CLASSNAMES } from "./toast-classes";

afterEach(() => setLiquid(false));

describe("liquid vocabulary (plan 2026-10-15-liquid-glass INDEX §5.4)", () => {
  it("constants carry only liquid tokens or self-gated material classes", () => {
    for (const value of [LQ_PANEL, LQ_PRIMARY, LQ_SECONDARY]) {
      for (const token of value.split(/\s+/)) expect(token, value).toMatch(/^(liquid:|mat-|well$|plate$)/);
    }
  });

  it("ScoreDot: green ≥ 85, amber 70–84, nothing below; hidden unless liquid", () => {
    expect(scoreDotClass(92)).toBe("bg-green");
    expect(scoreDotClass(78)).toBe("bg-amber");
    expect(scoreDotClass(64)).toBeNull();
    const { container, rerender } = render(<ScoreDot score={92} />);
    const dot = container.querySelector("[data-score-dot]")!;
    expect(dot.className).toMatch(/\bhidden\b/);
    expect(dot.className).toMatch(/liquid:inline-block/);
    rerender(<ScoreDot score={50} />);
    expect(container.querySelector("[data-score-dot]")).toBeNull();
  });

  it("EmptyState is an E1 panel with a well icon, title, line and action", () => {
    render(<EmptyState icon={MessagesSquareIcon} title="还没有对话" body="选一个角色" action={<button type="button">新对话</button>} testId="empty" />);
    const box = screen.getByTestId("empty");
    expect(box.className).toContain("mat-surface");
    expect(box.querySelector(".well")).not.toBeNull();
    expect(screen.getByText("还没有对话")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新对话" })).toBeInTheDocument();
  });

  it("toast classes keep the classic look and add a plate pill without blur", () => {
    expect(TOAST_CLASSNAMES.toast).toContain("!rounded-card");
    expect(TOAST_CLASSNAMES.toast).toContain("liquid:!bg-plate");
    expect(TOAST_CLASSNAMES.toast).toContain("liquid:backdrop-filter-none");
  });
});

import { MemoryRouter } from "react-router-dom";
import { ListRow, SectionGroup } from "./section-group";
import { LIST_CARD } from "./list-card";
import { StatTile } from "./stat-tile";
import { SurfaceCard } from "./surface-card";

describe("panels and lists in the liquid skin (L2-2)", () => {
  it("SurfaceCard keeps the classic classes and adds the E1 material (strong for heroes)", () => {
    const { container, rerender } = render(<SurfaceCard className="p-3.5">x</SurfaceCard>);
    const el = container.firstElementChild!;
    expect(el.className).toContain("rounded-card");
    expect(el.className).toContain("mat-surface");
    expect(el.className).toContain("liquid:rounded-panel");
    rerender(<SurfaceCard strong>x</SurfaceCard>);
    expect(container.firstElementChild!.className).toContain("mat-surface-strong");
  });

  it("SectionGroup puts the title inside one E1 panel under liquid, classic otherwise", () => {
    const ui = (
      <MemoryRouter>
        <SectionGroup title="学习"><ListRow title="进度" to="/progress" testId="row" /></SectionGroup>
      </MemoryRouter>
    );
    const classic = render(ui);
    const group = screen.getByRole("group", { name: "学习" });
    expect(group.className).not.toContain("mat-surface");
    classic.unmount();
    setLiquid(true);
    render(ui);
    const panel = screen.getByRole("group", { name: "学习" });
    expect(panel.className).toContain("mat-surface");
    expect(panel.querySelector("h2")).toHaveTextContent("学习");
    expect(screen.getByTestId("row").className).toContain("liquid:active:bg-wash");
  });

  it("LIST_CARD and StatTile gain material classes", () => {
    expect(LIST_CARD).toContain("mat-surface");
    const { container } = render(<StatTile tone="amber" label="连续" value={12} />);
    expect(container.firstElementChild!.className).toContain("bg-amber-tint");
    expect(container.firstElementChild!.className).toContain("well");
  });
});

import { BookIcon } from "lucide-react";
import { Avatar } from "./avatar";
import { IconButton } from "./icon-button";
import { IconChip } from "./icon-chip";
import { SegmentedControl } from "./segmented-control";
import { ToneBadge } from "./tone-badge";

describe("mono chips, badges, avatars (L2-3, R-L2-1)", () => {
  it("IconChip keeps its tone class and adds the round mono well", () => {
    const { container } = render(<IconChip tone="teal" icon={BookIcon} />);
    const chip = container.firstElementChild!;
    expect(chip.className).toContain("bg-teal-tint");
    expect(chip.className).toContain("liquid:bg-wash");
    expect(chip.className).toContain("liquid:rounded-full");
  });

  it("ToneBadge becomes a pill and can carry a score dot", () => {
    const { container } = render(<ToneBadge tone="green" dot="green">92</ToneBadge>);
    const badge = container.firstElementChild!;
    expect(badge.className).toContain("liquid:rounded-full");
    expect(badge.querySelector("i")!.className).toContain("bg-green");
  });

  it("Avatar, IconButton and SegmentedControl add their liquid shapes", () => {
    render(<Avatar name="Lin" tone="blue" />);
    expect(screen.getByRole("img", { name: "Lin" }).className).toContain("liquid:bg-wash");
    render(<IconButton label="返回">x</IconButton>);
    expect(screen.getByRole("button", { name: "返回" }).className).toContain("liquid:rounded-full");
    render(<SegmentedControl label="模式" value="a" onChange={() => {}} options={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} />);
    expect(screen.getByRole("radiogroup", { name: "模式" }).className).toContain("liquid:rounded-full");
    expect(screen.getByRole("radio", { name: "A" }).className).toContain("liquid:text-blue");
    expect(screen.getByRole("radio", { name: "B" }).className).not.toContain("liquid:text-blue");
  });
});

import { act } from "react";
import { GlassTopBar, ScrollRootProvider } from "./glass-top-bar";
import { PageHeader } from "~/layout/page-header";
import { blurLayers, textOutsidePlates } from "~/test/glass";

function scroller(top: number) {
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollTop", { value: top, writable: true });
  return el;
}

describe("capsule and large title (L2-4, R-L2-3/4, Rule 4)", () => {
  it("sub-page capsule: title + icons only, subtitle is screen-reader text, blur only when scrolled", () => {
    setLiquid(true);
    const { container, rerender } = render(<GlassTopBar title="设置" subtitle="次要说明" scrolled={false} actions={<button type="button" aria-label="更多">…</button>} />);
    expect(blurLayers(container)).toHaveLength(0);
    rerender(<GlassTopBar title="设置" subtitle="次要说明" scrolled actions={<button type="button" aria-label="更多">…</button>} />);
    const capsule = container.querySelector(".mat-chrome-bar")!;
    expect(capsule).not.toBeNull();
    expect(textOutsidePlates(capsule)).toEqual(["…"]); // the fake icon text; real icons are <svg>
    expect(screen.getByText("次要说明").className).toContain("sr-only");
  });

  it("classic GlassTopBar is unchanged", () => {
    const { container } = render(<GlassTopBar title="设置" scrolled />);
    expect(container.querySelector("header")!.className).toContain("glass-bar");
    expect(container.querySelector(".mat-chrome-bar")).toBeNull();
  });

  it("large title at rest, capsule after 60px; actions render once", () => {
    setLiquid(true);
    const root = scroller(0);
    const ui = (
      <MemoryRouter>
        <ScrollRootProvider value={root}>
          <PageHeader large title="练习" subtitle="周三" actions={<button type="button" data-testid="act">h</button>} />
        </ScrollRootProvider>
      </MemoryRouter>
    );
    render(ui);
    expect(screen.getByRole("heading", { level: 1, name: "练习" }).className).toContain("text-large");
    expect(screen.getAllByTestId("act")).toHaveLength(1);
    expect(document.querySelector("[data-capsule]")!.getAttribute("data-capsule")).toBe("hidden");
    act(() => { (root as unknown as { scrollTop: number }).scrollTop = 80; root.dispatchEvent(new Event("scroll")); });
    expect(document.querySelector("[data-capsule]")!.getAttribute("data-capsule")).toBe("shown");
    expect(screen.getAllByTestId("act")).toHaveLength(1);
    expect(document.querySelector(".mat-chrome-bar")).not.toBeNull();
  });
});

import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "./bottom-sheet";

describe("T3 sheet (L2-5, R-L2-5)", () => {
  const sheet = (glass?: boolean) => (
    <BottomSheet open>
      <BottomSheetContent glass={glass} data-testid="sheet"><BottomSheetHeader title="对话设置" description="说明" /></BottomSheetContent>
    </BottomSheet>
  );

  it("floats as a bezel + plate card with an unblurred scrim under liquid", () => {
    setLiquid(true);
    render(sheet());
    const content = screen.getByTestId("sheet");
    expect(content.className).toContain("mat-sheet");
    expect(content.className).toContain("rounded-sheet-xl");
    expect(content.className).toContain("inset-x-2");
    expect(content.className).not.toContain("bg-surface");
    expect(screen.getByTestId("sheet-overlay").className).toContain("bg-scrim");
    expect(textOutsidePlates(content)).toEqual([]);
  });

  it("keeps the lookup glass branch byte-identical under liquid", () => {
    setLiquid(true);
    render(sheet(true));
    const content = screen.getByTestId("sheet");
    expect(content.className).toContain("glass-sheet");
    expect(content.className).not.toContain("mat-sheet");
    expect(screen.getByTestId("sheet-overlay").className).toContain("bg-[color:var(--lookup-scrim)]");
  });
});

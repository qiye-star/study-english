import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ZhNoteFold } from "./zh-note-fold";

it("renders nothing without a note", () => {
  const { container } = render(<><ZhNoteFold text={null} showLabel="中文" hideLabel="收起中文" /><ZhNoteFold text="   " showLabel="中文" hideLabel="收起中文" /></>);
  expect(container).toBeEmptyDOMElement();
});

it("is folded by default, toggles with aria-expanded and keeps the note out of the button's name", () => {
  render(<ZhNoteFold text="abandon 指彻底放弃" showLabel="中文" hideLabel="收起中文" testId="n" />);
  const toggle = screen.getByTestId("n-toggle");
  expect(toggle).toHaveAccessibleName("中文");
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByTestId("n-text")).not.toBeVisible();
  expect(screen.getByTestId("n-text")).toHaveAttribute("lang", "zh-CN");
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(toggle).toHaveAccessibleName("收起中文");
  expect(screen.getByTestId("n-text")).toBeVisible();
  expect(toggle.getAttribute("aria-controls")).toBe(screen.getByTestId("n-text").id);
});

it("gives the toggle a 44 px hit target and wraps long notes instead of widening the row", () => {
  render(<ZhNoteFold text={"很长的说明".repeat(10)} showLabel="中文" hideLabel="收起中文" testId="n" />);
  expect(screen.getByTestId("n-toggle").className).toContain("h-tap");
  expect(screen.getByTestId("n-text").className).toContain("break-words");
});

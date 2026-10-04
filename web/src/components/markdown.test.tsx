import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownText } from "./markdown";

describe("MarkdownText", () => {
  it("renders GFM and never raw HTML", () => {
    render(<MarkdownText content={"**bold** and a [link](https://example.com)\n\n| a |\n|---|\n| 1 |\n\n<img src=x onerror=alert(1)>"} />);
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByRole("link")).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("opens links safely and drops javascript: URLs and markdown images", () => {
    render(<MarkdownText content={"[ok](https://example.com) [bad](javascript:alert(1)) ![pic](https://tracker.example/x.png)"} />);
    const ok = screen.getByRole("link", { name: "ok" });
    expect(ok).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(ok).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
    const bad = screen.getByText("bad");
    expect(bad.getAttribute("href") ?? "").not.toMatch(/javascript:/i);
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
  });
});

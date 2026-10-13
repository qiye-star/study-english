import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LibraryRoot } from "./library-root";

describe("LibraryRoot (R-L27)", () => {
  it("scopes the library tokens, lays the page out and puts the aurora behind the content", () => {
    const { container } = render(<LibraryRoot data-testid="root"><p>hello</p></LibraryRoot>);
    const root = screen.getByTestId("root");
    expect(root.className).toMatch(/\blibrary-root\b/);
    expect(root.className).toMatch(/\blib-page\b/);
    expect(container.querySelector(".lib-aurora")).not.toBeNull();
    expect(root.firstElementChild?.className).toBe("lib-aurora");
    expect(root.lastElementChild?.className).toBe("lib-content");
    expect(screen.getByText("hello").parentElement?.className).toBe("lib-content");
  });

  it("can drop the aurora and takes extra classes", () => {
    const { container } = render(<LibraryRoot aurora={false} className="lib-player" data-testid="root">x</LibraryRoot>);
    expect(container.querySelector(".lib-aurora")).toBeNull();
    expect(screen.getByTestId("root").className).toMatch(/\blib-player\b/);
  });
});

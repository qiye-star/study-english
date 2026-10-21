import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const flag = vi.hoisted(() => ({ enabled: false }));
vi.mock("./use-dubbing-enabled", () => ({ useDubbingEnabled: () => flag.enabled }));

import { DubbingEntryCard } from "./entry-card";

describe("dubbing entry card (plan L5 R16)", () => {
  beforeEach(() => {
    flag.enabled = false;
  });

  it("renders nothing while the feature is off", () => {
    const { container } = render(<MemoryRouter><DubbingEntryCard /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });

  it("links to /dub when the feature is on", () => {
    flag.enabled = true;
    render(<MemoryRouter><DubbingEntryCard /></MemoryRouter>);
    const link = screen.getByRole("link", { name: /film dubbing/i });
    expect(link).toHaveAttribute("href", "/dub");
  });
});

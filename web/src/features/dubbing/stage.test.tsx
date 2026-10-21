import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DubbingKit } from "~/features/library";
import { DubKitProvider } from "./kit-context";
import { DubStage } from "./stage";

const ITEM = "11111111-1111-4111-8111-111111111111";

const h = vi.hoisted(() => ({ retry: vi.fn(), useMediaSource: vi.fn() }));

function kitWith(state: { url: string | null; error: unknown }): DubbingKit {
  h.useMediaSource.mockReturnValue({ url: state.url, error: state.error, retry: h.retry });
  return { useMediaSource: h.useMediaSource } as unknown as DubbingKit;
}

function renderStage(kit: DubbingKit, onElement = vi.fn(), overlay: ReactNode = null) {
  return render(
    <DubKitProvider kit={kit}>
      <DubStage itemId={ITEM} onElement={onElement} overlay={overlay} subtitle={<span>Hello there.</span>} />
    </DubKitProvider>,
  );
}

afterEach(cleanup);

describe("DubStage (plan L5 W9)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hands the media ticket URL to the video element only, and reports the element to the session", () => {
    const onElement = vi.fn();
    const { container } = renderStage(kitWith({ url: "blob:ticket-url", error: null }), onElement);
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("src", "blob:ticket-url");
    expect(video).toHaveAttribute("playsinline");
    expect(h.useMediaSource).toHaveBeenCalledWith(ITEM, true, expect.anything());
    expect(onElement).toHaveBeenCalledWith(video);
  });

  it("shows the subtitle and any countdown overlay on the dark stage", () => {
    renderStage(kitWith({ url: "blob:x", error: null }), vi.fn(), <span>3</span>);
    expect(screen.getByText("Hello there.")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("offers a retry when the video fails to load, and retries the source on tap", () => {
    renderStage(kitWith({ url: null, error: new Error("media") }));
    fireEvent.click(screen.getByRole("button", { name: "Video failed to load. Retry" }));
    expect(h.retry).toHaveBeenCalledTimes(1);
  });

  it("does not offer a retry while the source is fine", () => {
    renderStage(kitWith({ url: "blob:x", error: null }));
    expect(screen.queryByRole("button", { name: "Video failed to load. Retry" })).toBeNull();
  });
});

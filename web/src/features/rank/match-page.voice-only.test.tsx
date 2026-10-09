import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import type { HoldToTalkBarProps } from "~/components/hold-to-talk-bar";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { MatchPage } from "./match-page";
import { CONTRACT } from "./test-contract";

const seen: HoldToTalkBarProps[] = [];
vi.mock("~/components/hold-to-talk-bar", async (importOriginal) => {
  const real = await importOriginal<typeof import("~/components/hold-to-talk-bar")>();
  return { ...real, HoldToTalkBar: (props: HoldToTalkBarProps) => { seen.push(props); return real.HoldToTalkBar(props); } };
});

describe("MatchPage voice-only bar", () => {
  it("renders the shared hold-to-talk bar without the to-text zone", async () => {
    Object.assign(HTMLMediaElement.prototype, { pause: vi.fn(), play: vi.fn(() => Promise.resolve()) });
    const id = CONTRACT.match.id;
    const mock = createFetchMock({ [`GET /api/rank/matches/${id}`]: () => json({ match: CONTRACT.match, verdict: null }) });
    renderWithProviders(<MatchPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: `/rank/match/${id}`, path: "/rank/match/:id" });
    fireEvent.click(await screen.findByTestId("match-begin"));
    await screen.findByTestId("match-hold");
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((p) => p.testId === "match-hold" && p.allowToText === false)).toBe(true);
  });
});

import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../api/types";
import { Transcript } from "./transcript";

vi.mock("../api/endpoints", () => ({ fetchAudio: vi.fn() }));

const base = { created_at: "2026-10-08T08:30:00Z", grammar: null, assessment_id: null, assessment: null };
const messages: ChatMessage[] = [
  { ...base, id: "s", role: "system", content: "You are a tutor" },
  { ...base, id: "a1", role: "assistant", content: "Hi! How are you?" },
  {
    ...base,
    id: "u1",
    role: "user",
    content: "I goed home",
    grammar: { hasErrors: true, corrected: "I went home", errors: [{ original: "goed", corrected: "went", category: "tense", explanation: "不规则动词" }] },
    assessment_id: "as1",
    assessment: { id: "as1", scores: { pronunciation_score: 86, accuracy_score: 80, fluency_score: 90, completeness_score: 100 }, duration_ms: 3000 },
  },
  { ...base, id: "u2", role: "user", content: "Fine", grammar: { weird: true } },
];

const renderTranscript = () =>
  render(
    <MemoryRouter>
      <Transcript messages={messages} />
    </MemoryRouter>,
  );

describe("Transcript", () => {
  it("renders bubbles per role with system messages centered", () => {
    renderTranscript();
    const items = screen.getAllByRole("listitem").filter((li) => li.hasAttribute("data-role"));
    expect(items.map((li) => li.getAttribute("data-role"))).toEqual(["system", "assistant", "user", "user"]);
    expect(items[1].className).toContain("items-start");
    expect(items[2].className).toContain("items-end");
  });

  it("shows grammar corrections, the score badge, the assessment link and a lazy audio player on user messages", () => {
    renderTranscript();
    const note = screen.getByTestId("grammar-note");
    expect(within(note).getByText("goed")).toBeInTheDocument();
    expect(within(note).getByText("went")).toBeInTheDocument();
    expect(within(note).getByText("时态")).toBeInTheDocument();
    expect(screen.getByText("发音 86")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /评测详情/ })).toHaveAttribute("href", "/assessments/as1");
    expect(screen.getByRole("button", { name: "播放" })).toBeInTheDocument();
  });

  it("falls back to compact JSON for unknown grammar shapes", () => {
    renderTranscript();
    expect(screen.getByText('{"weird":true}')).toBeInTheDocument();
  });
});

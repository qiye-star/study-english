import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "~/api/client";

const h = vi.hoisted(() => {
  const request = vi.fn();
  return { request, api: { request } as { request: typeof request } };
});
vi.mock("~/auth/auth-context", () => ({ useAuth: () => ({ api: h.api }) }));

import { RoleLabels, SAVE_DEBOUNCE_MS } from "./role-labels";

const ITEM = "11111111-1111-4111-8111-111111111111";

/** 测试替身:每句一个按钮,显示当前角色,点一下循环。 */
function Harness(props: Partial<Parameters<typeof RoleLabels>[0]> & { count?: number }) {
  const count = props.count ?? 3;
  return (
    <RoleLabels
      itemId={ITEM}
      initial={[{ idx: 0, speaker: null }, { idx: 1, speaker: "B" }, { idx: 2, speaker: null }]}
      editable={props.editable ?? true}
      suggest={props.suggest ?? false}
      clip={props.clip ?? null}
    >
      {({ speakerOf, cycle, readOnly }) => (
        <div>
          {Array.from({ length: count }, (_, i) => (
            <button key={i} type="button" onClick={() => cycle(i)} aria-label={`sentence ${i}`}>
              {speakerOf(i) ?? "none"}
            </button>
          ))}
          <span data-testid="ro">{readOnly ? "ro" : "rw"}</span>
        </div>
      )}
    </RoleLabels>
  );
}

describe("role labels (plan L5 W8)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    h.request.mockResolvedValue({ names: [], speakers: [], editable: true, locked: null });
  });
  afterEach(() => vi.useRealTimers());

  it("cycles a sentence through A, B, ... F and back to none", () => {
    render(<Harness />);
    const first = screen.getByRole("button", { name: "sentence 0" });
    expect(first).toHaveTextContent("none");
    fireEvent.click(first);
    expect(first).toHaveTextContent("A");
    fireEvent.click(first);
    expect(first).toHaveTextContent("B");
    for (let i = 0; i < 5; i++) fireEvent.click(first);
    expect(first).toHaveTextContent("none");
  });

  it("saves only the changed sentences, once, after the debounce", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "sentence 0" }));
    fireEvent.click(screen.getByRole("button", { name: "sentence 0" }));
    expect(h.request).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS); });
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(h.request).toHaveBeenCalledWith("PUT", `/api/dubbing/items/${ITEM}/roles`, { json: { speakers: [{ idx: 0, speaker: "B" }] } });
  });

  it("only the letters A..F (or null) go over the wire, never a display name", async () => {
    render(<Harness />);
    const first = screen.getByRole("button", { name: "sentence 0" });
    for (let i = 0; i < 6; i++) fireEvent.click(first);
    await act(async () => { await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS); });
    expect(h.request).toHaveBeenLastCalledWith("PUT", `/api/dubbing/items/${ITEM}/roles`, { json: { speakers: [{ idx: 0, speaker: "F" }] } });
    fireEvent.click(first);
    await act(async () => { await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS); });
    expect(h.request).toHaveBeenLastCalledWith("PUT", `/api/dubbing/items/${ITEM}/roles`, { json: { speakers: [{ idx: 0, speaker: null }] } });
    expect(JSON.stringify(h.request.mock.calls)).not.toMatch(/Alex|Bella|Red|Blue/);
  });

  it("a copy of a catalog item is read-only: no cycling, no suggest button, and a note", () => {
    render(<Harness editable={false} suggest clip={{ segFrom: 0, segTo: 2 }} />);
    expect(screen.getByTestId("ro")).toHaveTextContent("ro");
    fireEvent.click(screen.getByRole("button", { name: "sentence 0" }));
    expect(screen.getByRole("button", { name: "sentence 0" })).toHaveTextContent("none");
    expect(screen.queryByRole("button", { name: "Smart suggest" })).toBeNull();
    expect(screen.getByText("Editors label this material. You can't change the roles.")).toBeInTheDocument();
  });

  it("the suggest button is hidden when the server says suggestions are off", () => {
    render(<Harness suggest={false} clip={{ segFrom: 0, segTo: 2 }} />);
    expect(screen.queryByRole("button", { name: "Smart suggest" })).toBeNull();
  });

  it("suggestions are a draft until accepted; discarding changes nothing", async () => {
    h.request.mockImplementation(async (_m: string, path: string) => {
      if (path.endsWith("/roles/suggest")) return { speakers: [{ idx: 0, speaker: "A" }, { idx: 2, speaker: "B" }] };
      return { names: [], speakers: [], editable: true, locked: null };
    });
    render(<Harness suggest clip={{ segFrom: 0, segTo: 2 }} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Smart suggest" })); });
    expect(screen.getByRole("button", { name: "sentence 0" })).toHaveTextContent("none");
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByRole("button", { name: "sentence 0" })).toHaveTextContent("none");
  });

  it("accepting a suggestion applies it and saves", async () => {
    h.request.mockImplementation(async (_m: string, path: string) => {
      if (path.endsWith("/roles/suggest")) return { speakers: [{ idx: 0, speaker: "A" }] };
      return { names: [], speakers: [], editable: true, locked: null };
    });
    render(<Harness suggest clip={{ segFrom: 0, segTo: 2 }} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Smart suggest" })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Use suggestion" })); });
    expect(screen.getByRole("button", { name: "sentence 0" })).toHaveTextContent("A");
    await act(async () => { await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS); });
    expect(h.request).toHaveBeenCalledWith("PUT", expect.any(String), { json: { speakers: [{ idx: 0, speaker: "A" }] } });
  });

  it("a daily AI limit shows the limit text, not the server text", async () => {
    h.request.mockImplementation(async (_m: string, path: string) => {
      if (path.endsWith("/roles/suggest")) throw new ApiError(429, "Daily AI limit reached");
      return { names: [], speakers: [], editable: true, locked: null };
    });
    render(<Harness suggest clip={{ segFrom: 0, segTo: 2 }} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Smart suggest" })); });
    expect(screen.getByText("You have reached today's AI limit.")).toBeInTheDocument();
  });
});

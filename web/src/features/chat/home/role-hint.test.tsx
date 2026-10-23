import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_HOME_ROLE_HINT_KEY } from "./chat-home-cache";
import { RoleHint, useRoleHint } from "./role-hint";

beforeEach(() => localStorage.removeItem(CHAT_HOME_ROLE_HINT_KEY));
afterEach(() => { vi.restoreAllMocks(); localStorage.removeItem(CHAT_HOME_ROLE_HINT_KEY); });

describe("role hint", () => {
  it("shows the first time, then never again once dismissed", () => {
    const first = renderHook(() => useRoleHint());
    expect(first.result.current.show).toBe(true);
    act(() => first.result.current.dismiss());
    expect(first.result.current.show).toBe(false);
    expect(localStorage.getItem(CHAT_HOME_ROLE_HINT_KEY)).toBe("1");
    expect(renderHook(() => useRoleHint()).result.current.show).toBe(false);
  });

  it("still works when storage throws (shows every time, no error)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    const { result } = renderHook(() => useRoleHint());
    expect(result.current.show).toBe(true);
    act(() => result.current.dismiss());
    expect(result.current.show).toBe(false); // gone for this visit
  });

  it("renders a note with a Got it button", async () => {
    const onDismiss = vi.fn();
    render(<RoleHint onDismiss={onDismiss} />);
    expect(screen.getByRole("note")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("chat-role-hint-dismiss"));
    expect(onDismiss).toHaveBeenCalled();
  });
});

import { describe, expect, it } from "vitest";
import { normalizeUsername, validateCredentials } from "./validation";

describe("credential validation", () => {
  it("normalizes usernames like the server", () => {
    expect(normalizeUsername("  Alice_1 ")).toBe("alice_1");
  });
  it.each([
    ["login", "", "pw", "web.login.required"],
    ["login", "alice", "", "web.login.required"],
    ["login", "Al", "x", null],
    ["register", "ab", "password1", "web.login.usernameInvalid"],
    ["register", "bad-name", "password1", "web.login.usernameInvalid"],
    ["register", "alice", "short", "web.login.passwordLength"],
    ["register", "alice", "x".repeat(129), "web.login.passwordLength"],
    ["register", " Alice ", "password1", null],
  ] as const)("%s %s/%s → %s", (mode, username, password, expected) => {
    expect(validateCredentials(mode, username, password)).toBe(expected);
  });
});

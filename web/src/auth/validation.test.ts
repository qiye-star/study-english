import { describe, expect, it } from "vitest";
import { isEmailShape, normalizeEmail, normalizeLoginName, normalizeUsername, validateCredentials } from "./validation";

describe("credential validation", () => {
  it("normalizes usernames like the server", () => {
    expect(normalizeUsername("  Alice_1 ")).toBe("alice_1");
  });

  it("normalizes emails (trim, lowercase) and keeps them out of username rules", () => {
    expect(normalizeEmail(" A.B+tag@QQ.com ")).toBe("a.b+tag@qq.com");
    expect(normalizeLoginName(" Alice@Example.com ")).toBe("alice@example.com");
    expect(normalizeLoginName("  Alice_1 ")).toBe("alice_1");
  });

  it.each([
    ["a@example.com", true],
    ["a.b+tag@qq.com", true],
    ["no-at-sign.example.com", false],
    ["two@@example.com", false],
    ["a@nodot", false],
    ["a b@example.com", false],
    ["名字@example.com", false],
    [`${"x".repeat(65)}@example.com`, false],
    [`${"x".repeat(250)}@a.co`, false],
  ])("email shape %s → %s", (email, ok) => {
    expect(isEmailShape(email)).toBe(ok);
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

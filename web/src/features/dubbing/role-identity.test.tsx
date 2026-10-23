import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { ROLE_KEYS } from "./dubbing-api";
import { ROLE_COLOR, RoleDot, RoleTag, roleLabel, roleName } from "./role-identity";

const en = i18n.getFixedT("en");
const zh = i18n.getFixedT("zh-CN");

describe("role identity (plan 2026-10-23 R-B1)", () => {
  it("labels a role as colour · name in both languages", () => {
    expect(roleLabel(en, "A")).toBe("Red·Alex");
    expect(roleLabel(zh, "A")).toBe("红·Alex");
    expect(roleLabel(zh, "F")).toBe("橙·Fiona");
  });

  it("every wire key has its own colour", () => {
    expect(new Set(ROLE_KEYS.map((k) => ROLE_COLOR[k])).size).toBe(ROLE_KEYS.length);
  });

  it("a saved custom name wins, the colour still follows the letter, blank names count as none", () => {
    expect(roleLabel(en, "A", "Host")).toBe("Red·Host");
    expect(roleName(en, "A", "  Host  ")).toBe("Host");
    expect(roleName(en, "A", "  ")).toBe("Alex");
    expect(roleName(en, "B", undefined)).toBe("Bella");
  });

  it("RoleTag draws an aria-hidden dot of the role's colour and the label text", () => {
    const { container } = render(<RoleTag role="B" />);
    expect(container.querySelector('[data-role-color="blue"][aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByText("Blue·Bella")).toBeInTheDocument();
  });

  it("RoleTag uses the custom name and RoleDot alone carries no text", () => {
    render(<RoleTag role="A" custom="Narrator" />);
    expect(screen.getByText("Red·Narrator")).toBeInTheDocument();
    const { container } = render(<RoleDot role="C" />);
    expect(container).toHaveTextContent("");
    expect(container.querySelector('[data-role-color="green"]')).not.toBeNull();
  });

  it("the per-sentence role label reads as colour · name, or says there is no role", () => {
    expect(en("web.dubbing.roles.sentenceRole", { n: 3, role: roleLabel(en, "C") })).toBe("Role of sentence 3: Green·Chris");
    expect(zh("web.dubbing.roles.sentenceRole", { n: 3, role: zh("web.dubbing.roles.unassigned") })).toBe("第 3 句的角色：未分配");
  });

  it("never spells 'Role A' / '角色 A' anywhere", () => {
    for (const k of ROLE_KEYS) {
      expect(roleLabel(en, k)).not.toMatch(/Role [A-F]/);
      expect(roleLabel(zh, k)).not.toMatch(/角色 [A-F]/);
    }
  });
});

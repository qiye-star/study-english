import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import type { Scalar, SettingItem } from "./api";
import { SettingRow } from "./setting-row";
import { captchaModeItem, fixtureList, logLevelItem } from "./test-fixtures";

const find = (key: string) => fixtureList().items.find((i) => i.key === key)!;
const renderRow = (key: string, draft?: Scalar, onDraft = vi.fn()) =>
  render(
    <MemoryRouter>
      <SettingRow item={find(key)} draft={draft} onDraft={onDraft} readOnly={false} />
    </MemoryRouter>,
  );

it("renders env-only rows without an input", () => {
  renderRow("database_url");
  expect(screen.getByText("只能在 .env 中修改并重启")).toBeInTheDocument();
  expect(screen.getByText("已设置 · 3c90aa21")).toBeInTheDocument();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByLabelText("新值(留空不修改)")).toBeNull();
});

it("links managed rows to the rank rules page", () => {
  renderRow("rank_daily_rp_cap");
  expect(screen.getByText(/由段位规则管理/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "去段位规则修改" })).toHaveAttribute("href", "/rank/rules");
  expect(screen.queryByRole("spinbutton")).toBeNull();
});

it("clears a secret override through the draft and never shows the value", async () => {
  const onDraft = vi.fn();
  renderRow("upstream_llm_key", undefined, onDraft);
  expect(screen.getByText("env 也已设置(7e5d0c11)")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "清除覆盖" }));
  expect(onDraft).toHaveBeenCalledWith("upstream_llm_key", null);
});

it("marks a dangerous draft and can undo it", async () => {
  const onDraft = vi.fn();
  renderRow("upstream_llm_base_url", "https://other.example/v1", onDraft);
  expect(screen.getByText("改主机会把配对的密钥发送到新地址")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "撤销本次修改" }));
  expect(onDraft).toHaveBeenCalledWith("upstream_llm_base_url", undefined);
});

const CAPTCHA_ALWAYS_HELP = "连登录也每次都要求。桌面端无法解验证码,会因此登不上;只在遭到攻击时临时使用。";
const CAPTCHA_ADAPTIVE_HELP = "注册、发邮箱验证码、找回密码总是要求;登录只有在同一个 IP 或登录名连续输错密码后才要求。";

/** 草稿有状态的外壳:选择后草稿真的变化,说明文字随之更新。 */
function StatefulRow({ item, onDraft }: { item: SettingItem; onDraft: (key: string, value: Scalar | undefined) => void }) {
  const [draft, setDraft] = useState<Scalar | undefined>(undefined);
  return (
    <MemoryRouter>
      <SettingRow
        item={item}
        draft={draft}
        onDraft={(key, value) => {
          setDraft(value);
          onDraft(key, value);
        }}
        readOnly={false}
      />
    </MemoryRouter>
  );
}

it("shows the Chinese name with the raw value for choices that have info", () => {
  render(
    <MemoryRouter>
      <SettingRow item={captchaModeItem()} draft={undefined} onDraft={vi.fn()} readOnly={false} />
    </MemoryRouter>,
  );
  expect(screen.getByRole("option", { name: "自适应(推荐) (adaptive)" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "关闭 (off)" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "总是(应急) (always)" })).toBeInTheDocument();
});

it("keeps raw values for choices without info", () => {
  render(
    <MemoryRouter>
      <SettingRow item={logLevelItem()} draft={undefined} onDraft={vi.fn()} readOnly={false} />
    </MemoryRouter>,
  );
  expect(screen.getByRole("option", { name: "DEBUG" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "INFO" })).toBeInTheDocument();
  expect(screen.queryByText(/\(INFO\)/)).toBeNull();
});

it("drafts the raw value when another option is selected", async () => {
  const onDraft = vi.fn();
  render(
    <MemoryRouter>
      <SettingRow item={captchaModeItem()} draft={undefined} onDraft={onDraft} readOnly={false} />
    </MemoryRouter>,
  );
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "人机验证" }), "always");
  expect(onDraft).toHaveBeenCalledWith("captcha_mode", "always");
});

it("explains the selected value and updates the explanation when the selection changes", async () => {
  const onDraft = vi.fn();
  render(<StatefulRow item={captchaModeItem()} onDraft={onDraft} />);
  expect(screen.getByText(CAPTCHA_ADAPTIVE_HELP)).toBeInTheDocument();
  expect(screen.queryByText(CAPTCHA_ALWAYS_HELP)).toBeNull();
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "人机验证" }), "always");
  expect(screen.getByText(CAPTCHA_ALWAYS_HELP)).toBeInTheDocument();
  expect(screen.queryByText(CAPTCHA_ADAPTIVE_HELP)).toBeNull();
});

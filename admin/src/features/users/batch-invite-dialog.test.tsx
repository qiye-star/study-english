import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import * as api from "./api";
import * as csv from "./csv";
import { BatchInviteDialog } from "./batch-invite-dialog";

vi.mock("./api");
vi.mock("./csv", async (importOriginal) => ({ ...(await importOriginal<typeof import("./csv")>()), downloadCsv: vi.fn() }));

const CODES = ["ABCDE-FGHJK", "KMNPQ-RSTVW", "XYZ23-456AB"];
const batchResult = () => ({
  invites: CODES.map((_, i) => ({
    id: i + 1, label: "春季营", kind: "admin" as const, uses: 0, maxUses: 1, expiresAt: "2026-12-01T00:00:00Z",
    revokedAt: null, createdBy: "ops", createdAt: "2026-10-19T00:00:00Z", state: "active" as const, owner: null,
    redeemers: { total: 0, usernames: [] },
  })),
  codes: CODES,
});

beforeEach(() => {
  vi.clearAllMocks();
});

it("refuses a count outside 1 to 100 without calling the server", async () => {
  render(<BatchInviteDialog open onClose={() => undefined} onCreated={() => undefined} />);
  const count = screen.getByLabelText("数量(1–100)");
  await userEvent.clear(count);
  await userEvent.type(count, "101");
  await userEvent.click(screen.getByRole("button", { name: "生成" }));
  expect(screen.getByRole("alert")).toHaveTextContent("数量为 1–100 的整数");
  expect(api.createInviteBatch).not.toHaveBeenCalled();
});

it("creates the batch, shows the codes once and offers a CSV download built in the browser", async () => {
  vi.mocked(api.createInviteBatch).mockResolvedValue(batchResult());
  render(<BatchInviteDialog open onClose={() => undefined} onCreated={() => undefined} />);
  const dialog = screen.getByRole("dialog");
  await userEvent.clear(within(dialog).getByLabelText("数量(1–100)"));
  await userEvent.type(within(dialog).getByLabelText("数量(1–100)"), "3");
  await userEvent.type(within(dialog).getByLabelText("标签"), "春季营");
  await userEvent.click(within(dialog).getByRole("button", { name: "生成" }));

  expect(api.createInviteBatch).toHaveBeenCalledWith({ count: 3, label: "春季营", expiresAt: null });
  for (const code of CODES) expect(await screen.findByText(code)).toBeInTheDocument();
  expect(screen.getByText("仅显示这一次。下载的 CSV 同样包含明文码,请妥善保管;关闭后无法再次查看。")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "下载 CSV" }));
  const [filename, text] = vi.mocked(csv.downloadCsv).mock.calls[0];
  expect(filename).toMatch(/^invite-codes-\d{8}\.csv$/);
  expect(text).toContain("code,label,expires_at");
  for (const code of CODES) expect(text).toContain(`${code},春季营,2026-12-01T00:00:00Z`);
});

it("clears the codes from memory when closed, so reopening shows the form again", async () => {
  vi.mocked(api.createInviteBatch).mockResolvedValue(batchResult());
  const onClose = vi.fn();
  const { rerender } = render(<BatchInviteDialog open onClose={onClose} onCreated={() => undefined} />);
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "生成" }));
  expect(await screen.findByText(CODES[0])).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "我已保存,关闭" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  rerender(<BatchInviteDialog open={false} onClose={onClose} onCreated={() => undefined} />);
  rerender(<BatchInviteDialog open onClose={onClose} onCreated={() => undefined} />);
  expect(screen.queryByText(CODES[0])).toBeNull();
  expect(screen.getByLabelText("数量(1–100)")).toBeInTheDocument();
});

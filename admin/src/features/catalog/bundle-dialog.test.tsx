import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { BundleDialog } from "./bundle-dialog";
import { S } from "./strings";

vi.mock("./api", async (orig) => ({ ...(await orig<typeof import("./api")>()), listBundles: vi.fn(), importBundle: vi.fn() }));
afterEach(cleanup);

const IMPORTABLE = "3f2a9c1e-0000-4000-8000-000000000001";
const PRESENT = "9b7d4e2a-0000-4000-8000-000000000002";
const BUNDLE = (catalogId: string, importable: boolean): api.BundleRow =>
  ({ catalogId, bytes: 100, exportedAt: "2026-10-21T00:00:00Z", importable });

describe("BundleDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offers only the bundles this library does not already hold", async () => {
    vi.mocked(api.listBundles).mockResolvedValue([BUNDLE(IMPORTABLE, true), BUNDLE(PRESENT, false)]);
    render(<BundleDialog open onClose={() => {}} onDone={() => {}} />);
    const picker = await screen.findByLabelText(S.bundle.pick);
    expect(await screen.findByRole("option", { name: `${IMPORTABLE.slice(0, 8)} · 100 B` })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: new RegExp(PRESENT.slice(0, 8)) })).toBeNull();
    expect(picker.querySelectorAll("option")).toHaveLength(2); // the empty placeholder and the one importable bundle
  });

  it("says so when nothing can be imported", async () => {
    vi.mocked(api.listBundles).mockResolvedValue([BUNDLE(PRESENT, false)]);
    render(<BundleDialog open onClose={() => {}} onDone={() => {}} />);
    expect(await screen.findByText(S.bundle.none)).toBeInTheDocument();
  });

  it("needs both a chosen bundle and a reason, then imports with the trimmed reason and closes", async () => {
    vi.mocked(api.listBundles).mockResolvedValue([BUNDLE(IMPORTABLE, true)]);
    vi.mocked(api.importBundle).mockResolvedValue({ id: IMPORTABLE, segments: 2, status: "ready", published: false });
    const onDone = vi.fn();
    const onClose = vi.fn();
    render(<BundleDialog open onClose={onClose} onDone={onDone} />);
    const submit = await screen.findByRole("button", { name: S.bundle.import });
    expect(submit).toBeDisabled();

    await userEvent.selectOptions(await screen.findByLabelText(S.bundle.pick), IMPORTABLE);
    expect(submit).toBeDisabled(); // a bundle alone is not enough: the reason goes to the audit log

    await userEvent.type(screen.getByLabelText(S.bundle.reason), "  restore after the move  ");
    expect(submit).toBeEnabled();
    await userEvent.click(submit);

    await waitFor(() => expect(api.importBundle).toHaveBeenCalledWith(IMPORTABLE, "restore after the move"));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the dialog open and shows the server's refusal", async () => {
    vi.mocked(api.listBundles).mockResolvedValue([BUNDLE(IMPORTABLE, true)]);
    vi.mocked(api.importBundle).mockRejectedValue(new Error("Item exists"));
    const onDone = vi.fn();
    const onClose = vi.fn();
    render(<BundleDialog open onClose={onClose} onDone={onDone} />);
    await userEvent.selectOptions(await screen.findByLabelText(S.bundle.pick), IMPORTABLE);
    await userEvent.type(screen.getByLabelText(S.bundle.reason), "again");
    await userEvent.click(screen.getByRole("button", { name: S.bundle.import }));

    expect(await screen.findByRole("alert")).toHaveTextContent(S.errors["Item exists"]);
    expect(onDone).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows a failed bundle listing instead of an empty picker", async () => {
    vi.mocked(api.listBundles).mockRejectedValue(new Error("Bundle is invalid"));
    render(<BundleDialog open onClose={() => {}} onDone={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(S.errors["Bundle is invalid"]);
  });

  it("does not list bundles while closed, and clears the previous choice when reopened", async () => {
    vi.mocked(api.listBundles).mockResolvedValue([BUNDLE(IMPORTABLE, true)]);
    const { rerender } = render(<BundleDialog open={false} onClose={() => {}} onDone={() => {}} />);
    expect(api.listBundles).not.toHaveBeenCalled();

    rerender(<BundleDialog open onClose={() => {}} onDone={() => {}} />);
    await userEvent.selectOptions(await screen.findByLabelText(S.bundle.pick), IMPORTABLE);
    await userEvent.type(screen.getByLabelText(S.bundle.reason), "x");
    rerender(<BundleDialog open={false} onClose={() => {}} onDone={() => {}} />);
    rerender(<BundleDialog open onClose={() => {}} onDone={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText(S.bundle.pick)).toHaveValue(""));
    expect(screen.getByLabelText(S.bundle.reason)).toHaveValue("");
  });
});

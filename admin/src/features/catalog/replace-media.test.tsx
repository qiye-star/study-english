import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { ReplaceMedia } from "./replace-media";
import { S } from "./strings";

vi.mock("./api", async (orig) => ({ ...(await orig<typeof import("./api")>()), startReplace: vi.fn(), putChunk: vi.fn(), completeUpload: vi.fn() }));
afterEach(cleanup);

const ID = "3f2a9c1e-0000-4000-8000-000000000001";

describe("ReplaceMedia", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uploads the picked file in chunks to the same item, then completes", async () => {
    vi.mocked(api.startReplace).mockResolvedValue({ catalogId: ID, chunkBytes: 4 });
    vi.mocked(api.putChunk).mockResolvedValue({ catalogId: ID, status: "uploading", uploadReceived: 4, uploadTotal: 6, chunkBytes: 4 });
    vi.mocked(api.completeUpload).mockResolvedValue({ id: ID } as api.CatalogRow);
    const onDone = vi.fn();
    const onError = vi.fn();
    render(<ReplaceMedia id={ID} disabled={false} onDone={onDone} onError={onError} />);
    await userEvent.upload(screen.getByLabelText(S.detail.replace), new File([new Uint8Array(6)], "talk.mp4", { type: "video/mp4" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(api.startReplace).toHaveBeenCalledWith(ID, "talk.mp4", 6);
    expect(vi.mocked(api.putChunk).mock.calls.map((c) => c[1])).toEqual([0, 1]);
    expect(api.completeUpload).toHaveBeenCalledWith(ID);
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports a refusal and does not upload", async () => {
    vi.mocked(api.startReplace).mockRejectedValue(new Error("Item is published"));
    const onError = vi.fn();
    render(<ReplaceMedia id={ID} disabled={false} onDone={vi.fn()} onError={onError} />);
    await userEvent.upload(screen.getByLabelText(S.detail.replace), new File([new Uint8Array(2)], "talk.mp4", { type: "video/mp4" }));
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(api.putChunk).not.toHaveBeenCalled();
  });
});

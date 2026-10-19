import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuth, saveAuth } from "~/api/auth-storage";
import { AuthProvider } from "~/auth/auth-context";
import { createFetchMock, json } from "~/test/fetch-mock";
import { AvatarPicker } from "./avatar-picker";
import { AvatarPickError } from "./resize-image";

// jsdom 不解码图片:缩放在这里替换成直通(缩放本身在 resize-image.test.ts 里测)。
vi.mock("./resize-image", async (importOriginal) => {
  const real = await importOriginal<typeof import("./resize-image")>();
  return { ...real, prepareAvatar: vi.fn(async (file: File) => file) };
});
const resize = await import("./resize-image");

const AVATAR = "/api/avatars/00000000000000000000000000000000";

function setup(opts: { avatar?: string | null; routes?: Parameters<typeof createFetchMock>[0] } = {}) {
  let avatar: string | null = opts.avatar ?? null;
  const mock = createFetchMock({
    "GET /api/me": () => json({ id: "12345678", name: "alice", created_at: "t", nickname: "小明", display_name: "小明", avatar_url: avatar }),
    "POST /api/me/avatar": () => {
      avatar = AVATAR;
      return json({ avatar_url: AVATAR });
    },
    "DELETE /api/me/avatar": () => {
      avatar = null;
      return new Response(null, { status: 204 });
    },
    ...opts.routes,
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <AuthProvider fetchImpl={mock.fetch}>{children}</AuthProvider>
    </MemoryRouter>
  );
  render(<AvatarPicker />, { wrapper });
  return mock;
}

const photo = () => new File(["jpg"], "me.jpg", { type: "image/jpeg" });

describe("AvatarPicker", () => {
  beforeEach(() => {
    clearAuth();
    saveAuth({ token: "tok", user: { id: "12345678", name: "alice" } });
    vi.mocked(resize.prepareAvatar).mockClear();
  });

  it("resizes the picked photo, uploads it as multipart and shows the new avatar", async () => {
    const mock = setup();
    await userEvent.upload(await screen.findByTestId("avatar-file"), photo());
    await waitFor(() => expect(screen.getByTestId("account-avatar-status")).toHaveTextContent("Avatar updated"));
    const post = mock.calls.find((c) => c.method === "POST");
    expect(post?.headers.get("Authorization")).toBe("Bearer tok");
    expect(post?.headers.has("Content-Type")).toBe(false);
    expect((post?.body as FormData).get("file")).toBeInstanceOf(Blob);
    expect(resize.prepareAvatar).toHaveBeenCalledTimes(1);
    expect(document.querySelector("img")).toHaveAttribute("src", AVATAR);
  });

  it("hides the change button and explains when uploads are switched off (403)", async () => {
    setup({ routes: { "POST /api/me/avatar": () => json({ error: "Avatar upload is disabled" }, 403) } });
    await userEvent.upload(await screen.findByTestId("avatar-file"), photo());
    expect(await screen.findByTestId("account-avatar-status")).toHaveTextContent("The administrator has turned off avatar uploads for now.");
    expect(screen.queryByRole("button", { name: "Change avatar" })).toBeNull();
  });

  it("maps 413 and 422 to fixed localized text and never echoes server text", async () => {
    setup({ routes: { "POST /api/me/avatar": () => json({ error: "secret.jpg is bad" }, 422) } });
    await userEvent.upload(await screen.findByTestId("avatar-file"), photo());
    const status = await screen.findByTestId("account-avatar-status");
    expect(status).toHaveTextContent("This image can't be used. Choose a JPEG, PNG or WebP.");
    expect(status.textContent).not.toContain("secret");
  });

  it("says the image is too large on 413", async () => {
    setup({ routes: { "POST /api/me/avatar": () => json({ error: "Too large" }, 413) } });
    await userEvent.upload(await screen.findByTestId("avatar-file"), photo());
    expect(await screen.findByTestId("account-avatar-status")).toHaveTextContent("The image is too large. Choose a smaller one.");
  });

  it("reports a picked format the device cannot decode without calling the server", async () => {
    vi.mocked(resize.prepareAvatar).mockRejectedValueOnce(new AvatarPickError("unsupported"));
    const mock = setup();
    await userEvent.upload(await screen.findByTestId("avatar-file"), new File(["heic"], "IMG.HEIC", { type: "image/heic" }));
    expect(await screen.findByTestId("account-avatar-status")).toHaveTextContent("This image format isn't supported on this device.");
    expect(mock.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("removes the avatar only after a second confirmation", async () => {
    const mock = setup({ avatar: AVATAR });
    await userEvent.click(await screen.findByRole("button", { name: "Remove avatar" }));
    expect(mock.calls.some((c) => c.method === "DELETE")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
    await waitFor(() => expect(screen.getByTestId("account-avatar-status")).toHaveTextContent("Avatar removed"));
    expect(mock.calls.some((c) => c.method === "DELETE" && c.headers.get("Authorization") === "Bearer tok")).toBe(true);
  });
});

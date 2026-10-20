import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider } from "~/auth/auth-context";
import { createFetchMock, json } from "~/test/fetch-mock";
import { EmailCodeField } from "./email-code-field";

function Harness({ take, fetchImpl }: { take: () => string | null; fetchImpl: typeof fetch }) {
  const [email, setEmail] = useState("");
  return (
    <AuthProvider fetchImpl={fetchImpl}>
      <EmailCodeField
        id="e"
        value={email}
        onChange={setEmail}
        purpose="reset"
        sent={false}
        onSent={() => undefined}
        onError={() => undefined}
        takeCaptcha={take}
        captchaReady
      />
    </AuthProvider>
  );
}

describe("EmailCodeField payload hand-out (group 3)", () => {
  it("takes the payload when the request starts: the header is sent once and a second take gets nothing", async () => {
    let release!: (r: Response) => void;
    const pending = new Promise<Response>((resolve) => { release = resolve; });
    const mock = createFetchMock({
      "GET /api/me": () => json({ error: "unauthorized" }, 401),
      "POST /api/email/code": () => pending,
    });
    const payloads = ["P1", null];
    const take = vi.fn(() => payloads.shift() ?? null);
    render(<Harness take={take} fetchImpl={mock.fetch} />);
    await userEvent.type(screen.getByLabelText("Email"), "dan@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send code" }));
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/email/code")).toBe(true));
    // 请求还在途中:再次点击(按钮已禁用)或页面另一处再取载荷,都不能再拿到同一个载荷。
    await act(async () => {
      screen.getByRole("button").click();
    });
    expect(take).toHaveBeenCalledTimes(1);
    const sends = mock.calls.filter((c) => c.url.pathname === "/api/email/code");
    expect(sends).toHaveLength(1);
    expect(sends[0].headers.get("X-Captcha")).toBe("P1");
    release(json({ cooldownSeconds: 60 }));
  });
});

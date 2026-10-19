/**
 * 邀请码的分享链接(X27 / R-I12):码只放在 URL 的 `#` 片段里,不进 query、日志、存储或分析。
 * 片段不会随请求发往服务器,注册页读取后立即清掉(见 signup-page.tsx)。
 */

/** 码的字符表与格式(X18 / R-I2):去掉了易混淆的 I L O U 0 1。 */
const CODE_PATTERN = /^[A-Z2-9]{5}-[A-Z2-9]{5}$/;
/** 旧的 12 位管理员码仍可从片段带入(X18);字符集放宽,服务端最终校验。 */
const LEGACY_PATTERN = /^[A-Z0-9-]{6,32}$/;
const MAX_LENGTH = 32;

export function inviteLink(origin: string, code: string): string {
  return `${origin}/register#invite=${code}`;
}

/** 从 `location.hash` 取出邀请码;不合法或没有返回 null。结果为大写。 */
export function readInviteFragment(hash: string): string | null {
  const value = new URLSearchParams(hash.replace(/^#/, "")).get("invite");
  if (!value) return null;
  const code = value.trim().toUpperCase();
  if (code.length > MAX_LENGTH) return null;
  return CODE_PATTERN.test(code) || LEGACY_PATTERN.test(code) ? code : null;
}

export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

interface ShareDeps {
  share?: (data: { title: string; text: string; url: string }) => Promise<void>;
  clipboard?: { writeText(text: string): Promise<void> };
}

/**
 * 分享优先用系统分享面板,没有则复制到剪贴板。失败不抛出,返回结果由界面提示。
 * 分享文案只有通用说明与链接,不含用户的昵称、用户名或邮箱。
 */
export async function shareInviteLink(link: string, deps: ShareDeps = defaultShareDeps()): Promise<ShareOutcome> {
  if (deps.share) {
    try {
      await deps.share({ title: "", text: "", url: link });
      return "shared";
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return "cancelled";
      // 其他错误(例如权限被拒)退回到复制。
    }
  }
  if (!deps.clipboard) return "failed";
  try {
    await deps.clipboard.writeText(link);
    return "copied";
  } catch {
    return "failed";
  }
}

function defaultShareDeps(): ShareDeps {
  if (typeof navigator === "undefined") return {};
  const nav = navigator as Navigator & { share?: ShareDeps["share"] };
  return {
    share: typeof nav.share === "function" ? (data) => nav.share!(data) : undefined,
    clipboard: nav.clipboard,
  };
}

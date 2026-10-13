import type { CSSProperties } from "react";
import { motionAllowed } from "./motion";

/** 超过这么多个词 / 字就不逐个动画(一整段只淡入),避免几百个 inline-block 同时动画。 */
export const BLUR_TEXT_MAX_TOKENS = 120;
const MAX_DELAY_MS = 2400;
const CJK = /[぀-ヿ㐀-鿿가-힯豈-﫿]/;

/** 英文按词、中日韩按字;空白单独成段(不动画)。 */
export function splitBlurTokens(text: string): string[] {
  const out: string[] = [];
  for (const part of text.match(/\s+|\S+/g) ?? []) {
    if (/^\s+$/.test(part)) out.push(part);
    else if (CJK.test(part)) out.push(...Array.from(part));
    else out.push(part);
  }
  return out;
}

/**
 * AI 分析逐词浮现(BlurText):每个词从模糊到清晰依次出现,只在生成完成的那一次播放(spec §11.4a)。
 * 动效关闭(减少动态效果 / 低端机 / enabled === false)或词太多时直接显示整段文字;完整文字始终在 sr-only 里。
 */
export function BlurText({ text, stepMs = 40, className, enabled }: { text: string; stepMs?: number; className?: string; enabled?: boolean }) {
  const tokens = splitBlurTokens(text);
  const words = tokens.filter((t) => t.trim() !== "").length;
  if (!(enabled ?? motionAllowed()) || words > BLUR_TEXT_MAX_TOKENS) return <span className={className}>{text}</span>;
  let k = 0;
  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden className="whitespace-pre-wrap">
        {tokens.map((token, i) =>
          token.trim() === "" ? (
            token
          ) : (
            <span key={i} className="lib-bw" style={{ "--d": `${Math.min(k++ * stepMs, MAX_DELAY_MS)}ms` } as CSSProperties}>{token}</span>
          ),
        )}
      </span>
    </span>
  );
}

import { Fragment } from "react";
import { parseEmphasis } from "./emphasis";

/** 把 `*…*` 渲染成 <em class="greet-em">;只产出 React 文本节点,不解析任何 HTML。 */
export function EmphasisText({ text }: { text: string }) {
  return (
    <>
      {parseEmphasis(text).map((part, i) =>
        part.em ? <em key={i} className="greet-em">{part.text}</em> : <Fragment key={i}>{part.text}</Fragment>,
      )}
    </>
  );
}

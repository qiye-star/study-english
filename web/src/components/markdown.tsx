import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@renderer/lib/utils";

/**
 * 轻量 Markdown(桌面的 markdown-wrapper 依赖 EnjoyApp,不能复用)。
 * 不启用原始 HTML;react-markdown 默认的 urlTransform 会剥掉 javascript: 等危险协议;
 * 图片一律不渲染(避免 AI 输出触发第三方请求)。
 */
export function MarkdownText({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn("prose prose-sm max-w-none break-words dark:prose-invert", className)}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        disallowedElements={["img"]}
        components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" /> }}
      >
        {content}
      </Markdown>
    </div>
  );
}

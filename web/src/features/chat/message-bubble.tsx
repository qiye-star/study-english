import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import { cn } from "@renderer/lib/utils";
import { MarkdownText } from "~/components/markdown";

export interface UiMessage {
  key: string;
  id?: string;
  role: "user" | "assistant";
  content: string;
  status: "done" | "streaming" | "error";
}

export function MessageBubble({ message, onRetry, actions }: { message: UiMessage; onRetry?: () => void; actions?: ReactNode }) {
  const { t } = useTranslation();
  const isUser = message.role === "user";
  return (
    <div data-testid={isUser ? "message-user" : "message-assistant"} data-status={message.status}
      className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div className={cn(
        "max-w-[85%] rounded-2xl px-3 py-2 text-base",
        isUser ? "bg-primary text-primary-foreground" : "bg-muted",
        message.status === "error" && "border border-destructive bg-background text-destructive",
      )}>
        <div data-lookup-context className="select-text">
          {isUser || message.status === "error" ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <MarkdownText content={message.content || "…"} />
          )}
        </div>
        {!isUser && message.status === "done" && actions}
        {message.status === "error" && onRetry && (
          <Button variant="link" data-testid="message-retry" className="h-11 px-0" onClick={onRetry}>{t("web.common.retry")}</Button>
        )}
      </div>
    </div>
  );
}

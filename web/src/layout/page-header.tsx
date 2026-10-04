import { ChevronLeftIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@renderer/components/ui/button";

export function PageHeader({ title, back, actions }: { title: string; back?: string; actions?: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-10 flex h-12 items-center gap-1 border-b bg-background/95 px-1 backdrop-blur">
      {back ? (
        <Button variant="ghost" size="icon" className="h-11 w-11" aria-label={t("web.common.back")} onClick={() => navigate(back)}>
          <ChevronLeftIcon className="h-5 w-5" />
        </Button>
      ) : (
        <span className="w-3" />
      )}
      <h1 className="flex-1 truncate text-base font-semibold">{title}</h1>
      {actions}
    </header>
  );
}

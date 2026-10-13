import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { SegmentedControl } from "~/components/segmented-control";
import { ImportForm } from "./import-form";
import { limitsOrDefault, type LibraryConfig, type LibraryItem } from "./library-api";
import "./locales";
import "./library.css";
import type { UploadInput } from "./upload-client";
import { UploadForm } from "./upload-form";

type Tab = "upload" | "link";

/** 添加素材的底部弹层(spec §11.1:不单独路由;R-L19)。 */
export function AddSheet({ open, onOpenChange, config, onUpload, onImported }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: LibraryConfig;
  onUpload: (input: UploadInput) => void;
  onImported: (item: LibraryItem) => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("upload");
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent className="library-root lib-sheet max-h-[90dvh] overflow-y-auto" aria-describedby={undefined}>
        <BottomSheetHeader title={t("web.library.sheet.title")} />
        <SegmentedControl<Tab> label={t("web.library.sheet.tabs")} value={tab} onChange={setTab}
          options={[
            { value: "upload", label: t("web.library.sheet.upload"), testId: "library-tab-upload" },
            { value: "link", label: t("web.library.sheet.link"), testId: "library-tab-link" },
          ]} />
        <div className="mt-3">
          {tab === "upload"
            ? <UploadForm limits={limitsOrDefault(config.limits)} asr={config.asr} onSubmit={onUpload} />
            : <ImportForm linkImport={config.linkImport} onImported={onImported} />}
        </div>
      </BottomSheetContent>
    </BottomSheet>
  );
}

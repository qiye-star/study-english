import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { RecorderEnv } from "~/audio/recorder";
import type { ShadowRequest } from "./shadow-context";

export interface ShadowSheetProps {
  request: ShadowRequest;
  onClose(): void;
  recorderEnv?: RecorderEnv;
}

export function ShadowSheet({ request, onClose }: ShadowSheetProps) {
  return (
    <DialogPrimitive.Root open modal={false} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content data-testid="shadow-sheet" aria-describedby={undefined}
          onInteractOutside={(e) => e.preventDefault()} className="fixed inset-x-2 bottom-2 z-[36] rounded-sheet bg-surface p-4 text-ink">
          <DialogPrimitive.Title>Read aloud</DialogPrimitive.Title>
          <p data-testid="shadow-reference">{request.items[request.index]}</p>
          <button type="button" data-testid="shadow-close" onClick={onClose}>Close</button>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

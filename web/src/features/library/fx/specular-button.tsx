import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@renderer/lib/utils";

/** 主按钮的玻璃光带样式类(SpecularButton):渐变底 + 内高光 + 斜向光带周期性扫过。只在 `.library-root` 内生效(library.css)。 */
export const SPECULAR_CLASS = "lib-spec";

export const SpecularButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(function SpecularButton(
  { className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex min-h-tap min-w-0 items-center justify-center gap-2 px-5 text-body font-semibold",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:pointer-events-none disabled:opacity-40 [&_svg]:h-5 [&_svg]:w-5 [&_svg]:flex-none",
        SPECULAR_CLASS,
        className,
      )}
      {...rest}
    />
  );
});

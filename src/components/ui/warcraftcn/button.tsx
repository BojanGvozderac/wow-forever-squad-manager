import type { ComponentProps } from "react";
import normalFrame from "./assets/button-bg.webp";
import ornateFrame from "./assets/button-bg-with-frame.webp";

// Adapted from warcraftcn.com/r/button.json (MIT). The registry's responsive
// border-image implementation and original artwork are kept; utility classes
// and optional Slot support are replaced with the app's plain CSS.
export function Button({
  className = "",
  variant = "default",
  style,
  ...props
}: ComponentProps<"button"> & { variant?: "default" | "frame" }) {
  return (
    <button
      data-slot="button"
      className={`wc-button ${className}`}
      style={{
        borderImageSource: `url(${variant === "frame" ? ornateFrame : normalFrame})`,
        ...style,
      }}
      {...props}
    />
  );
}

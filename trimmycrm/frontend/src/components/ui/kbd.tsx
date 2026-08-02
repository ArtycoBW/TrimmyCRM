import type { ComponentProps } from "react";

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return <kbd className={"ui-kbd" + (className ? ` ${className}` : "")} {...props} />;
}

export function KbdGroup({ className, ...props }: ComponentProps<"span">) {
  return <span className={"ui-kbd-group" + (className ? ` ${className}` : "")} {...props} />;
}

import type { ComponentProps } from "react";

/** Project wrapper for the shadcn Input primitive. */
export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={"ui-input" + (className ? " " + className : "")} {...props} />;
}

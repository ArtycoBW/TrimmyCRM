import type { ComponentPropsWithoutRef } from "react";

type TrimmyLoaderSize = "xs" | "sm" | "md" | "lg" | "xl";

type TrimmyLoaderProps = Omit<ComponentPropsWithoutRef<"span">, "children"> & {
  label?: string;
  size?: TrimmyLoaderSize;
};

export function TrimmyLoader({
  className,
  label = "Загружаем",
  size = "md",
  ...props
}: TrimmyLoaderProps) {
  return (
    <span
      className={["trimmy-loader", `trimmy-loader--${size}`, className].filter(Boolean).join(" ")}
      role="status"
      aria-label={label}
      {...props}
    >
      <span className="trimmy-loader__track" aria-hidden="true" />
      <span className="trimmy-loader__orbit" aria-hidden="true" />
      <span className="trimmy-loader__core" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/trimmy-symbol.svg" alt="" />
      </span>
    </span>
  );
}

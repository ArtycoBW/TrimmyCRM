type BrandMarkProps = {
  compact?: boolean;
  inverse?: boolean;
};

export function BrandMark({ compact = false, inverse = false }: BrandMarkProps) {
  return (
    <span className={`brand-mark${compact ? " brand-mark--compact" : ""}${inverse ? " brand-mark--inverse" : ""}`}>
      <span className="brand-mark__symbol" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="brand-mark__image" src="/brand/trimmy-symbol-editorial.webp" alt="" />
      </span>
      <span className="brand-mark__type" aria-hidden="true">
        TrimmyCRM
      </span>
      <span className="sr-only">TrimmyCRM</span>
    </span>
  );
}

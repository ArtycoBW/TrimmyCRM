export function RouteSkeleton({ variant = "page" }: { variant?: "page" | "document" | "form" }) {
  return (
    <main className={`route-skeleton route-skeleton--${variant}`} aria-busy="true" aria-label="Загружаем страницу">
      <span className="route-skeleton__bar route-skeleton__bar--eyebrow" />
      <span className="route-skeleton__bar route-skeleton__bar--title" />
      <span className="route-skeleton__bar route-skeleton__bar--lead" />
      <div className="route-skeleton__grid">
        <span />
        <span />
        <span />
      </div>
    </main>
  );
}

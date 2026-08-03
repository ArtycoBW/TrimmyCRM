export function RouteSkeleton({ variant = "page" }: { variant?: "page" | "document" | "form" }) {
  return (
    <main
      className={`route-preloader route-preloader--${variant}`}
      aria-busy="true"
      aria-live="polite"
      aria-label="Загружаем страницу"
    >
      <div className="route-preloader__cut" aria-hidden="true">
        <span /><span /><span /><span /><span /><span /><span />
      </div>
      <p>TrimmyCRM</p>
      <small>Собираем образ</small>
    </main>
  );
}

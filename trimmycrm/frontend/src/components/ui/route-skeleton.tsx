import { TrimmyLoader } from "@/components/ui/trimmy-loader";

export function RouteSkeleton({ variant = "page" }: { variant?: "page" | "document" | "form" }) {
  return (
    <main
      className={`route-preloader route-preloader--${variant}`}
      aria-busy="true"
      aria-live="polite"
      aria-label="Загружаем страницу"
    >
      <TrimmyLoader size="xl" label="Загружаем страницу" />
    </main>
  );
}

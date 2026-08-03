"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { apiRequest } from "@/lib/api/client";
import type { PublicSiteSnapshot } from "@/lib/api/types";

type TenantAuthBrandProps = {
  compact?: boolean;
};

export function TenantAuthBrand({ compact = false }: TenantAuthBrandProps) {
  const [site, setSite] = useState<PublicSiteSnapshot | null>(null);
  const name = site?.name || "Кабинет клиента";

  useEffect(() => {
    let active = true;

    void apiRequest<PublicSiteSnapshot>("/public/site", { realm: false })
      .then((snapshot) => {
        if (active) setSite(snapshot);
      })
      .catch(() => {
        // The authentication screen remains available even if a public site is temporarily unavailable.
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <Link
      className={`tenant-auth-brand${compact ? " tenant-auth-brand--compact" : ""}`}
      href="/"
      aria-label={`${name}, на главную`}
    >
      <span className="tenant-auth-brand__logo" aria-hidden="true">
        {site?.logoUrl ? (
          // Public tenant media is served by the tenant host, so Next image optimization is not applicable.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={site.logoUrl} alt="" />
        ) : name.charAt(0).toUpperCase()}
      </span>
      {!compact && <strong>{name}</strong>}
    </Link>
  );
}

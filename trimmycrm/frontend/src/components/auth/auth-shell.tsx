import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";

import { TenantAuthBrand } from "@/components/auth/tenant-auth-brand";
import { BrandMark } from "@/components/ui/brand-mark";
import { realmForHostname } from "@/lib/auth/realm";

type AuthShellProps = {
  eyebrow: string;
  title: React.ReactNode;
  description: string;
  children: React.ReactNode;
};

function requestHostname(value: string | null) {
  return (value || "").split(",", 1)[0].trim().toLowerCase().replace(/\.$/, "").replace(/:\d+$/, "");
}

export async function AuthShell({ eyebrow, title, description, children }: AuthShellProps) {
  const requestHeaders = await headers();
  const isTenant = realmForHostname(requestHostname(
    requestHeaders.get("x-forwarded-host") || requestHeaders.get("host"),
  )) === "tenant";

  return (
    <main className="auth-page">
      <a className="skip-link" href="#auth-form">К форме</a>
      <section className="auth-story" aria-label={isTenant ? "Кабинет клиента" : "О TrimmyCRM"}>
        {isTenant ? (
          <TenantAuthBrand />
        ) : (
          <Link className="auth-story__brand" href="/" aria-label="TrimmyCRM, на главную">
            <BrandMark />
          </Link>
        )}
        <div className="auth-story__copy">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <figure className="auth-story__photo">
          <Image
            src="/images/editorial/auth-salon-studio.webp"
            alt="Стилист работает над короткой стрижкой в современной студии"
            width={1536}
            height={1024}
            sizes="(max-width: 1100px) 52vw, 620px"
            priority
          />
        </figure>
      </section>
      <section className="auth-panel" id="auth-form">
        <div className="auth-panel__mobile-brand">
          {isTenant ? <TenantAuthBrand compact /> : <Link href="/"><BrandMark compact /></Link>}
        </div>
        <div className="auth-panel__content">{children}</div>
      </section>
    </main>
  );
}

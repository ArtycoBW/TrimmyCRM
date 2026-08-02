export function tenantBaseDomain() {
  return process.env.NEXT_PUBLIC_TENANT_BASE_DOMAIN || "trimmycrm.ru";
}

export function tenantHostname(slug: string) {
  return slug + "." + tenantBaseDomain();
}

export function tenantSiteUrl(slug: string) {
  let protocol = "https:";
  const publicSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (publicSiteUrl) {
    try {
      protocol = new URL(publicSiteUrl).protocol;
    } catch {
      // The deployment validation will surface an invalid public URL.
    }
  }
  return protocol + "//" + tenantHostname(slug);
}

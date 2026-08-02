import type { Metadata } from "next";

import { PublicSalonSite } from "@/components/site/public-salon-site";

export const metadata: Metadata = {
  title: "Предпросмотр сайта",
  robots: { index: false, follow: false },
};

export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <PublicSalonSite previewToken={token} />;
}

import type { Metadata } from "next";

import { SiteWorkspace } from "@/components/app/site-workspace";

export const metadata: Metadata = { title: "Сайт салона" };

export default function SitePage() { return <SiteWorkspace />; }

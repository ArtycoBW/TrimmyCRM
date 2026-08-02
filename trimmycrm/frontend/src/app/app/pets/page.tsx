import type { Metadata } from "next";

import { PetsWorkspace } from "@/components/app/pets-workspace";

export const metadata: Metadata = { title: "Питомцы" };

export default function PetsPage() {
  return <PetsWorkspace />;
}

import type { Metadata } from "next";

import { OnboardingForm } from "@/components/app/onboarding-form";

export const metadata: Metadata = { title: "Создание салона" };

export default function OnboardingPage() {
  return <OnboardingForm />;
}

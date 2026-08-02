"use client";

import { useEffect, useState } from "react";

import {
  fallbackPlans,
  normalizePlans,
  type MarketingPlan,
} from "@/content/landing";
import { Icon } from "@/components/ui/icons";
import { useLandingSession } from "@/components/landing/landing-session";

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/v1";

function formatPrice(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value);
}

export function PlansSection() {
  const session = useLandingSession();
  const [plans, setPlans] = useState<MarketingPlan[]>(fallbackPlans);

  useEffect(() => {
    const controller = new AbortController();

    async function loadPlans() {
      try {
        const response = await fetch(`${apiBase}/plans`, {
          credentials: "include",
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!response.ok) return;
        setPlans(normalizePlans(await response.json()));
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    void loadPlans();
    return () => controller.abort();
  }, []);

  return (
    <div className="plans-grid" aria-live="polite">
      {plans.map((plan) => (
        <article
          className={`plan-card${plan.featured ? " plan-card--featured" : ""}`}
          key={plan.code}
        >
          {plan.featured && <span className="plan-card__badge">Чаще выбирают</span>}
          <div className="plan-card__top">
            <p className="plan-card__name">{plan.name}</p>
            <p className="plan-card__description">{plan.description}</p>
          </div>
          <p className="plan-card__price">
            <strong>{formatPrice(plan.price)} ₽</strong>
            <span>/ месяц</span>
          </p>
          <a
            className={`button ${plan.featured ? "button--ink" : "button--outline"} plan-card__button`}
            href={session === "authenticated" ? "/app" : `/register?plan=${plan.code}`}
          >
            {session === "authenticated" ? "Управлять тарифом" : "Начать бесплатно"} <Icon name="arrow" />
          </a>
          <ul className="plan-card__features">
            {plan.features.map((feature) => (
              <li key={feature}>
                <span className="plan-card__check"><Icon name="check" /></span>
                {feature}
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}

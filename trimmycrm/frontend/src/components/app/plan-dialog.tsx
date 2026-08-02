"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";

import { apiRequest } from "@/lib/api/client";
import type { PlanView } from "@/lib/api/types";

function price(value: number | string) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Number(value));
}

const featureLabels: Record<string, string> = {
  subdomain: "Адрес сайта",
  basic_blocks: "Базовые блоки сайта",
  all_blocks: "Все блоки сайта",
  booking: "Онлайн-запись",
  crm: "CRM салона",
  email_notifications: "Email-уведомления",
  basic_analytics: "Базовая аналитика",
  advanced_analytics: "Расширенная аналитика",
};

function planFeatures(features: string[]) {
  return features.slice(0, 3).map((feature) => featureLabels[feature] || feature.replaceAll("_", " "));
}

export function PlanDialog({ open, onOpenChange, currentPlanId }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPlanId?: string;
}) {
  const [plans, setPlans] = useState<PlanView[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || plans.length) return;
    apiRequest<PlanView[]>("/plans", { realm: "platform" })
      .then(setPlans)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Не удалось загрузить тарифы"));
  }, [open, plans.length]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="plan-dialog__overlay" />
        <Dialog.Content className="plan-dialog" aria-describedby="plan-dialog-description">
          <div className="plan-dialog__header">
            <div>
              <p className="crm-kicker">Подписка</p>
              <Dialog.Title>Выберите тариф</Dialog.Title>
            </div>
            <Dialog.Close className="plan-dialog__close" aria-label="Закрыть">×</Dialog.Close>
          </div>
          <Dialog.Description id="plan-dialog-description">
            Сравните возможности тарифа. Смена тарифа станет доступна здесь после подключения эквайринга.
          </Dialog.Description>
          {error && <p className="crm-form-error" role="alert">{error}</p>}
          <div className="plan-dialog__list">
            {plans.map((plan) => (
              <article className={"plan-dialog__plan" + (plan.id === currentPlanId ? " is-current" : "")} key={plan.id}>
                <div><strong>{plan.name}</strong><span>{price(plan.price)} ₽ / {plan.period === "month" ? "месяц" : plan.period}</span></div>
                <ul>{planFeatures(plan.features).map((feature) => <li key={feature}>{feature}</li>)}</ul>
                {plan.id === currentPlanId && <small>Текущий тариф</small>}
              </article>
            ))}
            {!error && !plans.length && <p className="plan-dialog__loading">Загружаем тарифы…</p>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

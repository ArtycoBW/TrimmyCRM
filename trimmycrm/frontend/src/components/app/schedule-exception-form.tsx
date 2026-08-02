"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { AppSelect } from "@/components/ui/select";
import { apiRequest } from "@/lib/api/client";
import type { ScheduleExceptionView, StaffView } from "@/lib/api/types";
import {
  exceptionKinds,
  localDateTimeValue,
} from "@/lib/app/catalog";
import {
  addDays,
  zonedDateTimeToIso,
} from "@/lib/app/calendar";
import { salonDayKey } from "@/lib/app/dashboard";

function localValueToIso(value: string, timezone: string) {
  const [date, time] = value.split("T");
  if (!date || !time) throw new Error("Укажите дату и время");
  return zonedDateTimeToIso(date, time, timezone);
}

export function ScheduleExceptionForm({
  member,
  exception,
  timezone,
  onClose,
  onSaved,
}: {
  member: StaffView;
  exception?: ScheduleExceptionView | null;
  timezone: string;
  onClose: () => void;
  onSaved: (exception: ScheduleExceptionView) => void;
}) {
  const firstField = useRef<HTMLInputElement>(null);
  const defaultDay = addDays(salonDayKey(new Date(), timezone), 1);
  const [startsAt, setStartsAt] = useState(
    exception ? localDateTimeValue(exception.startsAt, timezone) : defaultDay + "T09:00",
  );
  const [endsAt, setEndsAt] = useState(
    exception ? localDateTimeValue(exception.endsAt, timezone) : defaultDay + "T18:00",
  );
  const [kind, setKind] = useState<ScheduleExceptionView["kind"]>(exception?.kind || "day_off");
  const [reason, setReason] = useState(exception?.reason || "");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    firstField.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    try {
      const startIso = localValueToIso(startsAt, timezone);
      const endIso = localValueToIso(endsAt, timezone);
      if (new Date(endIso) <= new Date(startIso)) {
        setFormError("Окончание должно быть позже начала");
        return;
      }
      setSubmitting(true);
      const saved = await apiRequest<ScheduleExceptionView>(
        "/staff/" + member.id + "/schedule-exceptions" + (exception ? "/" + exception.id : ""),
        {
          realm: "platform",
          method: exception ? "PATCH" : "POST",
          body: JSON.stringify({
            startsAt: startIso,
            endsAt: endIso,
            kind,
            reason: reason.trim() || null,
          }),
        },
      );
      onSaved(saved);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Не удалось сохранить изменение графика");
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div className="appointment-dialog appointment-dialog--form appointment-dialog--nested">
      <button className="appointment-dialog__backdrop" type="button" onClick={onClose} aria-label="Закрыть форму" />
      <section className="crm-modal exception-form" role="dialog" aria-modal="true" aria-labelledby="exception-form-title">
        <header>
          <div>
            <p className="crm-kicker">Исключение графика</p>
            <h2 id="exception-form-title">{exception ? "Изменить период" : "Добавить период"}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть">×</button>
        </header>

        <form onSubmit={submit}>
          <fieldset disabled={submitting}>
            <div className="crm-field crm-modal__wide">
              <label htmlFor="exception-kind">Тип изменения</label>
              <AppSelect
                id="exception-kind"
                value={kind}
                onValueChange={(value) => setKind(value as ScheduleExceptionView["kind"])}
                options={Object.entries(exceptionKinds).map(([value, meta]) => ({ value, label: meta.label }))}
              />
            </div>

            <div className="crm-field">
              <label htmlFor="exception-start">Начало</label>
              <input
                id="exception-start"
                ref={firstField}
                type="datetime-local"
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
                required
              />
            </div>

            <div className="crm-field">
              <label htmlFor="exception-end">Окончание</label>
              <input
                id="exception-end"
                type="datetime-local"
                value={endsAt}
                onChange={(event) => setEndsAt(event.target.value)}
                required
              />
            </div>

            <div className="crm-field crm-modal__wide">
              <label htmlFor="exception-reason">Причина <small>необязательно</small></label>
              <input
                id="exception-reason"
                value={reason}
                maxLength={300}
                placeholder="Отпуск, обучение, дополнительная смена"
                onChange={(event) => setReason(event.target.value)}
              />
            </div>

            <aside className="exception-form__note crm-modal__wide">
              <span aria-hidden="true">i</span>
              <p>
                «Выходной» и «Перерыв» блокируют слоты, а «Рабочее окно» добавляет доступное время поверх обычного графика.
                Часовой пояс: {timezone}.
              </p>
            </aside>

            {formError && <p className="crm-form-error crm-modal__wide" role="alert">{formError}</p>}

            <button className="button button--ink crm-modal__submit" type="submit">
              {submitting ? "Сохраняем…" : exception ? "Сохранить период →" : "Добавить в график →"}
            </button>
          </fieldset>
        </form>
      </section>
    </div>,
    document.body,
  );
}

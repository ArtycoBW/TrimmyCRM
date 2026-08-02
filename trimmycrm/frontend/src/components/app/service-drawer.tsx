"use client";

import { useEffect, useRef, useState } from "react";

import type { ServiceView, StaffView } from "@/lib/api/types";
import { formatDuration, staffInitials } from "@/lib/app/catalog";
import { formatMoney } from "@/lib/app/dashboard";

export function ServiceDrawer({
  service,
  staff,
  removing,
  onClose,
  onEdit,
  onRemove,
}: {
  service: ServiceView;
  staff: StaffView[];
  removing: boolean;
  onClose: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    closeButton.current?.focus();
    document.body.classList.add("crm-dialog-open");
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.classList.remove("crm-dialog-open");
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div className="appointment-dialog">
      <button className="appointment-dialog__backdrop" type="button" onClick={onClose} aria-label="Закрыть карточку" />
      <aside className="service-drawer" role="dialog" aria-modal="true" aria-labelledby="service-title">
        <header>
          <div>
            <p className="crm-kicker">Карточка услуги</p>
            <span className={"crm-status crm-status--" + (service.isActive ? "lime" : "muted")}>
              {service.isActive ? "Активна" : "Скрыта"}
            </span>
          </div>
          <button ref={closeButton} type="button" onClick={onClose} aria-label="Закрыть">×</button>
        </header>

        <section className="service-drawer__hero">
          <p>{service.category || "Без категории"}</p>
          <h2 id="service-title">{service.name}</h2>
          <strong>{formatMoney(service.price)}</strong>
        </section>

        <dl className="service-facts">
          <div><dt>Длительность</dt><dd>{formatDuration(service.durationMin)}</dd></div>
          <div><dt>Подготовка</dt><dd>{service.bufferBeforeMin ? service.bufferBeforeMin + " мин" : "Не нужна"}</dd></div>
          <div><dt>Буфер после</dt><dd>{service.bufferAfterMin ? service.bufferAfterMin + " мин" : "Без буфера"}</dd></div>
        </dl>

        <section className="service-description">
          <p className="crm-kicker">Описание для клиента</p>
          <p>{service.description || "Описание пока не добавлено."}</p>
        </section>

        <section className="service-team">
          <header><p className="crm-kicker">Выполняют мастера</p><strong>{staff.length}</strong></header>
          {staff.length ? (
            <div>
              {staff.map((member) => (
                <span key={member.id}>
                  <i>{staffInitials(member.name)}</i>
                  <b>{member.name}</b>
                </span>
              ))}
            </div>
          ) : (
            <p>Назначьте услугу мастеру в разделе «Команда».</p>
          )}
        </section>

        <footer className="service-drawer__actions">
          <button className="button button--ink" type="button" onClick={onEdit}>Изменить</button>
          {!confirming ? (
            <button className="button service-remove" type="button" onClick={() => setConfirming(true)}>
              Убрать услугу
            </button>
          ) : (
            <div className="service-remove-confirm">
              <p>Услуга с историей визитов будет скрыта, а без истории — удалена.</p>
              <button type="button" onClick={() => setConfirming(false)} disabled={removing}>Отмена</button>
              <button type="button" onClick={onRemove} disabled={removing}>
                {removing ? "Убираем…" : "Подтвердить"}
              </button>
            </div>
          )}
        </footer>
      </aside>
    </div>
  );
}

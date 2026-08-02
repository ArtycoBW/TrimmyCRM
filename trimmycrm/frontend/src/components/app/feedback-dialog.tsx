"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState, type FormEvent } from "react";

import { ApiError, apiRequest } from "@/lib/api/client";

export function FeedbackDialog({ open, onOpenChange, phone: initialPhone }: { open: boolean; onOpenChange: (open: boolean) => void; phone: string }) {
  const [message, setMessage] = useState("");
  const [phone, setPhone] = useState(initialPhone);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSending(true);
    try {
      await apiRequest("/feedback", {
        realm: "platform",
        method: "POST",
        body: JSON.stringify({ message, phone }),
      });
      setSent(true);
      setMessage("");
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "Не удалось отправить сообщение. Попробуйте ещё раз.");
    } finally {
      setSending(false);
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setSent(false);
      setPhone(initialPhone);
    }
    onOpenChange(nextOpen);
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="feedback-dialog__overlay" />
        <Dialog.Content className="feedback-dialog" aria-describedby="feedback-dialog-description">
          <header>
            <div>
              <p className="crm-kicker">Мы на связи</p>
              <Dialog.Title>Обратная связь</Dialog.Title>
            </div>
            <Dialog.Close aria-label="Закрыть">×</Dialog.Close>
          </header>
          {sent ? (
            <div className="feedback-dialog__success" role="status">
              <strong>Сообщение отправлено</strong>
              <p>Спасибо! Мы увидим его в панели администратора и сможем связаться с вами по телефону из профиля.</p>
              <Dialog.Close className="button button--ink">Готово</Dialog.Close>
            </div>
          ) : (
            <form onSubmit={submit}>
              <Dialog.Description id="feedback-dialog-description">
                Расскажите, что стоит улучшить, или задайте вопрос — команда TrimmyCRM всё прочитает.
              </Dialog.Description>
              <label htmlFor="feedback-message">Сообщение</label>
              <label htmlFor="feedback-phone">Телефон для связи</label>
              <input
                id="feedback-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+7 (900) 000-00-00"
                minLength={7}
                maxLength={32}
                required
              />
              <textarea
                id="feedback-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                minLength={10}
                maxLength={5000}
                placeholder="Например: нужна помощь с настройкой онлайн-записи…"
                required
              />
              <p className="feedback-dialog__hint">Минимум 10 символов. Телефон сохраним в профиле для обратной связи.</p>
              {error && <p className="crm-form-error" role="alert">{error}</p>}
              <button className="button button--ink" type="submit" disabled={sending}>
                {sending ? "Отправляем…" : "Отправить сообщение"}
              </button>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

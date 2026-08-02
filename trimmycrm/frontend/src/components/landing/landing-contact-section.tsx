"use client";

import { useState, type FormEvent } from "react";

import { useHydrated } from "@/hooks/use-hydrated";
import { ApiError, apiRequest } from "@/lib/api/client";
import { formatRussianPhone, normalizeRussianPhone } from "@/lib/app/phone";

type LeadKind = "question" | "callback";

export function LandingContactSection() {
  const hydrated = useHydrated();
  const [kind, setKind] = useState<LeadKind>("question");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [question, setQuestion] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [consent, setConsent] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    setSending(true);
    try {
      const response = await apiRequest<{ message: string }>("/public/leads", {
        method: "POST",
        body: JSON.stringify({ kind, name, phone: normalizeRussianPhone(phone), question, preferredTime, consent }),
      });
      setResult(response.message);
      setQuestion("");
    } catch (reason) {
      setResult(reason instanceof ApiError ? reason.message : "Не удалось отправить заявку. Попробуйте ещё раз.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="landing-contact section" id="contact" aria-labelledby="contact-title" data-hydrated={hydrated}>
      <div className="page-container landing-contact__layout">
        <div className="landing-contact__copy">
          <p className="eyebrow">Можно просто спросить</p>
          <h2 id="contact-title">Обсудим ваш<br /><span>салон.</span></h2>
          <p>Расскажите, что хотите настроить. Или оставьте время — перезвоним без навязчивых продаж.</p>
          <span className="landing-contact__note">Ответим в рабочее время · не продаём данные и не используем их для сторонней рекламы</span>
        </div>
        <form className="landing-contact__form" onSubmit={submit}>
          <div className="landing-contact__tabs" role="tablist" aria-label="Тип обращения">
            <button className={kind === "question" ? "is-active" : ""} type="button" role="tab" aria-selected={kind === "question"} onClick={() => setKind("question")}>Задать вопрос</button>
            <button className={kind === "callback" ? "is-active" : ""} type="button" role="tab" aria-selected={kind === "callback"} onClick={() => setKind("callback")}>Заказать звонок</button>
          </div>
          <label>Имя<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" minLength={2} maxLength={160} required /></label>
          <label>Телефон<input value={phone} onChange={(event) => setPhone(formatRussianPhone(event.target.value))} type="tel" inputMode="tel" autoComplete="tel" placeholder="+7 (989) 652 15 42" minLength={7} required /></label>
          {kind === "question" ? <label className="landing-contact__wide">Ваш вопрос<textarea value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={5000} placeholder="Например: как перенести клиентов и записи?" required /></label> : <label className="landing-contact__wide">Когда удобно позвонить?<input type="time" value={preferredTime} onChange={(event) => setPreferredTime(event.target.value)} required /></label>}
          <label className="landing-contact__consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required /><span>Даю <a href="/consent" target="_blank" rel="noreferrer">согласие на обработку персональных данных</a> и ознакомлен(-а) с <a href="/privacy" target="_blank" rel="noreferrer">Политикой</a>.</span></label>
          {result && <p className="landing-contact__result" role="status">{result}</p>}
          <button className="button button--ink" type="submit" disabled={sending}>{sending ? "Отправляем…" : kind === "callback" ? "Заказать звонок" : "Отправить вопрос"}</button>
        </form>
      </div>
    </section>
  );
}

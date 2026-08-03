"use client";

import { ArrowUpRight } from "lucide-react";
import Image from "next/image";
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
        <div className="landing-contact__visual" data-reveal>
          <Image
            alt="Стилист обсуждает новую форму стрижки с клиенткой"
            fill
            sizes="(max-width: 1080px) 100vw, 46vw"
            src="/images/editorial/salon-copper-consultation.webp"
          />
          <div className="landing-contact__copy">
            <p className="eyebrow">Есть вопрос?</p>
            <h2 id="contact-title">Расскажите, что<br /><span>нужно настроить.</span></h2>
            <p>Опишите, как сейчас работает салон и что хотите перенести в TrimmyCRM. Мы подскажем, с чего начать.</p>
          </div>
        </div>
        <form className="landing-contact__form" onSubmit={submit} data-reveal data-reveal-delay="1">
          <div className="landing-contact__tabs" role="tablist" aria-label="Тип обращения">
            <button className={kind === "question" ? "is-active" : ""} type="button" role="tab" aria-selected={kind === "question"} onClick={() => setKind("question")}>Задать вопрос</button>
            <button className={kind === "callback" ? "is-active" : ""} type="button" role="tab" aria-selected={kind === "callback"} onClick={() => setKind("callback")}>Заказать звонок</button>
          </div>
          <label>Имя<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" minLength={2} maxLength={160} required /></label>
          <label>Телефон<input value={phone} onChange={(event) => setPhone(formatRussianPhone(event.target.value))} type="tel" inputMode="tel" autoComplete="tel" placeholder="+7 (989) 652 15 42" minLength={7} required /></label>
          {kind === "question" ? <label className="landing-contact__wide">Ваш вопрос<textarea value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={5000} placeholder="Например: как перенести клиентов и записи?" required /></label> : <label className="landing-contact__wide">Когда удобно позвонить?<input type="time" value={preferredTime} onChange={(event) => setPreferredTime(event.target.value)} required /></label>}
          <label className="landing-contact__consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required /><span>Даю <a href="/consent" target="_blank" rel="noreferrer">согласие на обработку персональных данных</a> и ознакомлен(-а) с <a href="/privacy" target="_blank" rel="noreferrer">Политикой</a>.</span></label>
          {result && <p className="landing-contact__result" role="status">{result}</p>}
          <button className="button button--ink" type="submit" disabled={sending}>
            <span>{sending ? "Отправляем…" : kind === "callback" ? "Заказать звонок" : "Отправить вопрос"}</span>
            <ArrowUpRight aria-hidden="true" />
          </button>
        </form>
      </div>
    </section>
  );
}

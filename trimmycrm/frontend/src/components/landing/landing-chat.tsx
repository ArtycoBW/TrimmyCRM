"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, MessageCircleQuestion, X } from "lucide-react";

import { ApiError, apiRequest } from "@/lib/api/client";
import { formatRussianPhone, normalizeRussianPhone } from "@/lib/app/phone";

const answers = [
  { question: "Что входит в TrimmyCRM?", answer: "Сайт салона, онлайн-запись, календарь, клиентская база, услуги и основная аналитика." },
  { question: "Сколько стоит?", answer: "Первые 14 дней бесплатны. Затем тариф стоит от 990 ₽ в месяц. Банковская карта для регистрации не нужна." },
  { question: "Как быстро запустить?", answer: "Базовый сайт и расписание можно настроить за вечер. Если нужно перенести клиентов, поможем подготовить данные." },
];

export function LandingChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([{ from: "bot", text: "Здравствуйте. Что хотите узнать о TrimmyCRM?" }]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [question, setQuestion] = useState("");
  const [consent, setConsent] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "auto" });
  }, [messages]);

  function answer(item: typeof answers[number]) {
    setMessages((current) => [...current, { from: "user", text: item.question }, { from: "bot", text: item.answer }]);
    setQuestion(item.question);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    setSending(true);
    try {
      const response = await apiRequest<{ message: string }>("/public/chat-leads", { method: "POST", body: JSON.stringify({ name, phone: normalizeRussianPhone(phone), question, consent }) });
      setResult(response.message);
      setMessages((current) => [...current, { from: "bot", text: "Спасибо. Получили контакты и скоро свяжемся с вами." }]);
    } catch (reason) {
      setResult(reason instanceof ApiError ? reason.message : "Не удалось сохранить контакты. Попробуйте ещё раз.");
    } finally {
      setSending(false);
    }
  }

  return <div className="landing-chat">
    <button className="landing-chat__trigger" type="button" aria-expanded={open} aria-controls="landing-chat-panel" onClick={() => setOpen((value) => !value)}><span>Спросить</span><MessageCircleQuestion aria-hidden="true" /></button>
    {open && <aside className="landing-chat__panel" id="landing-chat-panel" aria-label="Чат с TrimmyCRM">
      <header><div><strong>Есть вопрос?</strong><span>Ответим по TrimmyCRM и запуску сайта</span></div><button type="button" aria-label="Закрыть чат" onClick={() => setOpen(false)}><X aria-hidden="true" /></button></header>
      <div className="landing-chat__messages" ref={messagesRef}>{messages.map((message, index) => <p className={`is-${message.from}`} key={`${message.from}-${index}`}>{message.text}</p>)}</div>
      <div className="landing-chat__quick">{answers.map((item) => <button key={item.question} type="button" onClick={() => answer(item)}>{item.question}</button>)}</div>
      <form onSubmit={submit}>
        <label><span>Имя</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Анна" autoComplete="name" minLength={2} required /></label>
        <label><span>Телефон</span><input value={phone} onChange={(event) => setPhone(formatRussianPhone(event.target.value))} placeholder="+7 (989) 652 15 42" type="tel" inputMode="tel" autoComplete="tel" minLength={7} required /></label>
        <label><span>Вопрос</span><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Необязательно" maxLength={5000} /></label>
        <label className="landing-chat__consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required /><span>Согласен(-на) на <a href="/consent" target="_blank" rel="noreferrer">обработку данных</a> и с <a href="/privacy" target="_blank" rel="noreferrer">Политикой</a>.</span></label>
        {result && <small role="status">{result}</small>}
        <button className="button button--lime" type="submit" disabled={sending}>{sending ? "Сохраняем..." : "Оставить контакты"}<ArrowUpRight aria-hidden="true" /></button>
      </form>
    </aside>}
  </div>;
}

"use client";

import {
  CalendarDays,
  Clock3,
  LogOut,
  Plus,
  Scissors,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { DatePicker } from "@/components/ui/date-picker";
import { AppSelect } from "@/components/ui/select";
import { apiRequest, logout } from "@/lib/api/client";
import type {
  AppointmentView,
  Paginated,
  PublicServiceView,
  PublicSiteSnapshot,
  PublicStaffView,
  SlotsResponse,
  UserView,
} from "@/lib/api/types";

type PortalTab = "booking" | "appointments";

const appointmentStatusLabels: Record<AppointmentView["status"], string> = {
  new: "Новая",
  confirmed: "Подтверждена",
  completed: "Завершена",
  cancelled: "Отменена",
  no_show: "Клиент не пришёл",
};

function tomorrow() {
  const value = new Date();
  value.setDate(value.getDate() + 1);
  return value.toISOString().slice(0, 10);
}

function formatDate(value: string, timeZone?: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(value));
}

export function ClientPortal() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<PortalTab>(searchParams.get("booking") ? "booking" : "appointments");
  const [user, setUser] = useState<UserView | null>(null);
  const [site, setSite] = useState<PublicSiteSnapshot | null>(null);
  const [services, setServices] = useState<PublicServiceView[]>([]);
  const [staff, setStaff] = useState<PublicStaffView[]>([]);
  const [appointments, setAppointments] = useState<AppointmentView[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [date, setDate] = useState(tomorrow());
  const [slots, setSlots] = useState<SlotsResponse["slots"]>([]);
  const [slotTimezone, setSlotTimezone] = useState("Europe/Moscow");
  const [slot, setSlot] = useState("");
  const [booking, setBooking] = useState(false);
  const currentQuery = searchParams.toString();

  useEffect(() => {
    let active = true;

    async function initialize() {
      let authenticated = false;
      try {
        const currentUser = await apiRequest<UserView>("/t/auth/me", { realm: "tenant" });
        if (!active) return;
        authenticated = true;
        setUser(currentUser);

        const [currentAppointments, currentServices, currentStaff, currentSite] = await Promise.all([
          apiRequest<Paginated<AppointmentView>>("/appointments/mine?page=1&limit=100", { realm: "tenant" }),
          apiRequest<PublicServiceView[]>("/public/services"),
          apiRequest<PublicStaffView[]>("/public/staff"),
          apiRequest<PublicSiteSnapshot>("/public/site"),
        ]);
        if (!active) return;
        setAppointments(currentAppointments.items);
        setServices(currentServices);
        setStaff(currentStaff);
        setSite(currentSite);
        setServiceId(currentServices[0]?.id || "");
        setStaffId(currentStaff.find((member) => member.serviceIds.includes(currentServices[0]?.id || ""))?.id || "");
      } catch (reason) {
        if (!active) return;
        if (!authenticated) {
          const returnPath = `/client${currentQuery ? `?${currentQuery}` : ""}`;
          router.replace(`/login?next=${encodeURIComponent(returnPath)}`);
          return;
        }
        setMessage(reason instanceof Error ? reason.message : "Не удалось открыть кабинет");
      } finally {
        if (active) setLoading(false);
      }
    }

    void initialize();
    return () => { active = false; };
  }, [currentQuery, router]);

  const availableStaff = useMemo(
    () => staff.filter((member) => !serviceId || member.serviceIds.includes(serviceId)),
    [serviceId, staff],
  );

  useEffect(() => {
    if (!serviceId || !staffId || !date) return;
    let active = true;
    apiRequest<SlotsResponse>(`/booking/slots?serviceId=${encodeURIComponent(serviceId)}&staffId=${encodeURIComponent(staffId)}&date=${date}`)
      .then((result) => {
        if (!active) return;
        const available = result.slots.filter((item) => item.available);
        setSlotTimezone(result.timezone);
        setSlots(available);
        setSlot(available[0]?.startAt || "");
      })
      .catch((reason) => { if (active) setMessage(reason instanceof Error ? reason.message : "Не удалось загрузить время"); });
    return () => { active = false; };
  }, [date, serviceId, staffId]);

  function chooseService(value: string) {
    const nextStaff = staff.find((member) => member.serviceIds.includes(value));
    setServiceId(value);
    setStaffId(nextStaff?.id || "");
    setSlots([]);
    setSlot("");
  }

  function chooseStaff(value: string) {
    setStaffId(value);
    setSlots([]);
    setSlot("");
  }

  async function signOut() {
    await logout("tenant");
    router.replace("/login");
  }

  async function createBooking() {
    if (!serviceId || !staffId || !slot) {
      setMessage("Выберите услугу, мастера и свободное время");
      return;
    }
    setBooking(true);
    setMessage(null);
    try {
      const created = await apiRequest<AppointmentView>("/booking", {
        realm: "tenant",
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ serviceId, staffId, startAt: slot, promotionCode: null }),
      });
      setAppointments((current) => [created, ...current]);
      setTab("appointments");
      setMessage("Готово! Запись создана и появилась в кабинете.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Не удалось создать запись");
    } finally {
      setBooking(false);
    }
  }

  if (loading) return <main className="client-portal-state" aria-busy="true"><i /><p>Открываем личный кабинет…</p></main>;
  if (!user) return <main className="client-portal-state" aria-busy="true"><i /><p>Переходим ко входу…</p></main>;

  return (
    <main className="client-portal">
      <header className="client-portal__header">
        <Link href="/" className="client-portal__brand">
          <span className={site?.logoUrl ? "client-portal__brand-logo" : ""}>
            {site?.logoUrl ? (
              // Public tenant media is served by the tenant host, so Next image optimization is not applicable.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={site.logoUrl} alt="" />
            ) : site?.name.charAt(0) || "С"}
          </span>
          <strong>{site?.name || "Мой салон"}</strong>
        </Link>
        <div><p>{user.fullName || user.email}</p><button type="button" onClick={() => void signOut()}><LogOut aria-hidden="true" /> Выйти</button></div>
      </header>
      <section className="client-portal__intro"><div><p className="salon-site__eyebrow">Личный кабинет</p><h1>Запись без звонков<span>.</span></h1><p>Выберите услугу и свободное время — подтверждение сразу появится здесь.</p></div><Link href="/">← На сайт салона</Link></section>
      <nav className="client-portal__tabs" aria-label="Разделы кабинета">
        <button className={tab === "booking" ? "is-active" : ""} type="button" onClick={() => setTab("booking")}><Scissors aria-hidden="true" /> Записаться</button>
        <button className={tab === "appointments" ? "is-active" : ""} type="button" onClick={() => setTab("appointments")}><CalendarDays aria-hidden="true" /> Мои записи <span>{appointments.length}</span></button>
      </nav>
      {message && <p className="client-portal__notice" role="status">{message}</p>}

      {tab === "booking" && (
        <section className="client-booking">
          <header><p className="salon-site__eyebrow">Новая запись</p><h2>Выберите всё по порядку</h2></header>
          <div className="client-booking__grid">
            <label className="client-booking__field"><span><i>1</i><b>Услуга</b></span><AppSelect ariaLabel="Услуга" value={serviceId} onValueChange={chooseService} placeholder="Выберите услугу" options={services.map((service) => ({ value: service.id, label: `${service.name} · ${Number(service.price).toLocaleString("ru-RU")} ₽` }))} /></label>
            <label className="client-booking__field"><span><i>2</i><b>Мастер</b></span><AppSelect ariaLabel="Мастер" value={staffId} onValueChange={chooseStaff} placeholder="Выберите мастера" options={availableStaff.map((member) => ({ value: member.id, label: member.name }))} disabled={!serviceId || !availableStaff.length} /></label>
            <label className="client-booking__field"><span><i>3</i><b>Дата</b></span><DatePicker ariaLabel="Дата записи" min={tomorrow()} value={date} onValueChange={(value) => { setDate(value); setSlots([]); setSlot(""); }} required /></label>
            <div className="client-booking__slots"><span><i>4</i><b>Свободное время</b></span><div>{slots.map((item) => <button className={slot === item.startAt ? "is-active" : ""} type="button" key={item.startAt} onClick={() => setSlot(item.startAt)}>{new Date(item.startAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: slotTimezone })}</button>)}{!slots.length && <p className="client-booking__no-slots"><Clock3 aria-hidden="true" /><span><strong>Свободных окон на эту дату нет</strong>Выберите другой день — доступное время появится здесь.</span></p>}</div></div>
            <button className="salon-site__button client-booking__submit" type="button" disabled={booking || !slot} onClick={() => void createBooking()}>{booking ? "Создаём запись…" : "Подтвердить запись →"}</button>
          </div>
        </section>
      )}

      {tab === "appointments" && (
        <section className="client-list-section"><header><div><p className="salon-site__eyebrow">История и планы</p><h2>Мои записи</h2></div><button className="salon-site__button" type="button" onClick={() => setTab("booking")}><Plus aria-hidden="true" /> Новая запись</button></header><div className="client-appointment-list">{appointments.length ? appointments.map((item) => <article key={item.id}><span><Clock3 aria-hidden="true" /></span><div><strong>{item.serviceName || "Услуга"}</strong><p>{item.staffName || "Мастер будет назначен"}</p></div><time>{formatDate(item.startAt, site?.timezone)}</time><i>{appointmentStatusLabels[item.status]}</i></article>) : <div className="client-list-empty"><CalendarDays aria-hidden="true" /><h3>Записей пока нет</h3><p>Выберите услугу и удобное время — всё займёт пару минут.</p></div>}</div></section>
      )}

    </main>
  );
}

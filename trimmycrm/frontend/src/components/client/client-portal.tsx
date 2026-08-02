"use client";

import {
  CalendarDays,
  Clock3,
  FileText,
  ImagePlus,
  LogOut,
  PawPrint,
  Plus,
  Scissors,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { AppSelect } from "@/components/ui/select";
import { apiRequest, ApiError, logout } from "@/lib/api/client";
import type {
  AppointmentView,
  Paginated,
  PetDocumentView,
  PetView,
  PhotoView,
  PublicServiceView,
  PublicSiteSnapshot,
  PublicStaffView,
  SlotsResponse,
  UserView,
} from "@/lib/api/types";

type PortalTab = "booking" | "appointments" | "pets";

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
  const [pets, setPets] = useState<PetView[]>([]);
  const [services, setServices] = useState<PublicServiceView[]>([]);
  const [staff, setStaff] = useState<PublicStaffView[]>([]);
  const [appointments, setAppointments] = useState<AppointmentView[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [petId, setPetId] = useState("");
  const [date, setDate] = useState(tomorrow());
  const [slots, setSlots] = useState<SlotsResponse["slots"]>([]);
  const [slotTimezone, setSlotTimezone] = useState("Europe/Moscow");
  const [slot, setSlot] = useState("");
  const [booking, setBooking] = useState(false);
  const [addingPet, setAddingPet] = useState(false);
  const [petName, setPetName] = useState("");
  const [petBreed, setPetBreed] = useState("");
  const [petSpecies, setPetSpecies] = useState("dog");
  const [petMedicalNotes, setPetMedicalNotes] = useState("");
  const [petAdditionalInfo, setPetAdditionalInfo] = useState("");
  const [petPhoto, setPetPhoto] = useState<File | null>(null);
  const [petPassport, setPetPassport] = useState<File | null>(null);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      apiRequest<UserView>("/t/auth/me", { realm: "tenant" }),
      apiRequest<PetView[]>("/pets", { realm: "tenant" }),
      apiRequest<Paginated<AppointmentView>>("/appointments/mine?page=1&limit=100", { realm: "tenant" }),
      apiRequest<PublicServiceView[]>("/public/services"),
      apiRequest<PublicStaffView[]>("/public/staff"),
      apiRequest<PublicSiteSnapshot>("/public/site"),
    ]).then(([currentUser, currentPets, currentAppointments, currentServices, currentStaff, currentSite]) => {
      if (!active) return;
      setUser(currentUser);
      setPets(currentPets);
      setAppointments(currentAppointments.items);
      setServices(currentServices);
      setStaff(currentStaff);
      setSite(currentSite);
      setPetId(currentPets[0]?.id || "");
      setServiceId(currentServices[0]?.id || "");
      setStaffId(currentStaff.find((member) => member.serviceIds.includes(currentServices[0]?.id || ""))?.id || "");
    }).catch((reason) => {
      if (!active) return;
      if (reason instanceof ApiError && reason.status === 401) {
        router.replace("/login?next=%2Fclient%3Fbooking%3D1");
        return;
      }
      setMessage(reason instanceof Error ? reason.message : "Не удалось открыть кабинет");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [router]);

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

  async function createPet() {
    if (!petName.trim()) return;
    setBooking(true);
    setMessage(null);
    try {
      let created = await apiRequest<PetView>("/pets", {
        realm: "tenant",
        method: "POST",
        body: JSON.stringify({
          name: petName.trim(),
          species: petSpecies,
          breed: petBreed.trim() || null,
          medicalNotes: petMedicalNotes.trim() || null,
          additionalInfo: petAdditionalInfo.trim() || null,
        }),
      });

      const uploadErrors: string[] = [];
      if (petPhoto) {
        const form = new FormData();
        form.append("file", petPhoto);
        form.append("isCover", "true");
        try {
          const photo = await apiRequest<PhotoView>(`/pets/${created.id}/photos`, {
            realm: "tenant",
            method: "POST",
            body: form,
          });
          created = { ...created, photos: [...created.photos, photo] };
        } catch {
          uploadErrors.push("фото");
        }
      }
      if (petPassport) {
        const form = new FormData();
        form.append("file", petPassport);
        form.append("type", "passport");
        try {
          const document = await apiRequest<PetDocumentView>(`/pets/${created.id}/documents`, {
            realm: "tenant",
            method: "POST",
            body: form,
          });
          created = { ...created, documents: [...created.documents, document] };
        } catch {
          uploadErrors.push("ветеринарный паспорт");
        }
      }

      setPets((current) => [...current, created]);
      setPetId(created.id);
      setPetName("");
      setPetBreed("");
      setPetMedicalNotes("");
      setPetAdditionalInfo("");
      setPetPhoto(null);
      setPetPassport(null);
      setAddingPet(false);
      setTab("booking");
      setMessage(
        uploadErrors.length
          ? `Питомец сохранён, но не удалось загрузить: ${uploadErrors.join(", ")}.`
          : "Питомец добавлен — теперь выберите время",
      );
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Не удалось добавить питомца");
    } finally {
      setBooking(false);
    }
  }

  async function createBooking() {
    if (!serviceId || !staffId || !petId || !slot) {
      setMessage("Выберите питомца, услугу, мастера и свободное время");
      return;
    }
    setBooking(true);
    setMessage(null);
    try {
      const created = await apiRequest<AppointmentView>("/booking", {
        realm: "tenant",
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ serviceId, staffId, petId, startAt: slot, promotionCode: null }),
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

  async function deletePassport(pet: PetView, document: PetDocumentView) {
    if (!window.confirm(`Удалить файл «${document.filename || "ветеринарный паспорт"}»?`)) return;
    setDeletingDocumentId(document.id);
    setMessage(null);
    try {
      await apiRequest(`/pets/${pet.id}/documents/${document.id}`, {
        realm: "tenant",
        method: "DELETE",
      });
      setPets((current) => current.map((item) => item.id === pet.id
        ? { ...item, documents: item.documents.filter((value) => value.id !== document.id) }
        : item,
      ));
      setMessage("Ветеринарный паспорт удалён.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Не удалось удалить ветеринарный паспорт.");
    } finally {
      setDeletingDocumentId(null);
    }
  }

  if (loading) return <main className="client-portal-state" aria-busy="true"><i /><p>Открываем личный кабинет…</p></main>;
  if (!user) return <main className="client-portal-state"><h1>Кабинет недоступен</h1><p>{message}</p></main>;

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
      <section className="client-portal__intro"><div><p className="salon-site__eyebrow">Личный кабинет</p><h1>Запись без звонков<span>.</span></h1><p>Добавьте питомца, выберите услугу и свободное время — подтверждение сразу появится здесь.</p></div><Link href="/">← На сайт салона</Link></section>
      <nav className="client-portal__tabs" aria-label="Разделы кабинета">
        <button className={tab === "booking" ? "is-active" : ""} type="button" onClick={() => setTab("booking")}><Scissors aria-hidden="true" /> Записаться</button>
        <button className={tab === "appointments" ? "is-active" : ""} type="button" onClick={() => setTab("appointments")}><CalendarDays aria-hidden="true" /> Мои записи <span>{appointments.length}</span></button>
        <button className={tab === "pets" ? "is-active" : ""} type="button" onClick={() => setTab("pets")}><PawPrint aria-hidden="true" /> Питомцы <span>{pets.length}</span></button>
      </nav>
      {message && <p className="client-portal__notice" role="status">{message}</p>}

      {tab === "booking" && (
        <section className="client-booking">
          <header><p className="salon-site__eyebrow">Новая запись</p><h2>Выберите всё по порядку</h2></header>
          {!pets.length ? (
            <div className="client-booking__empty"><PawPrint aria-hidden="true" /><h3>Сначала добавьте питомца</h3><p>Это займёт меньше минуты, а потом данные сохранятся для следующих записей.</p><button className="salon-site__button" type="button" onClick={() => { setAddingPet(true); setTab("pets"); }}>Добавить питомца →</button></div>
          ) : (
            <div className="client-booking__grid">
              <label className="client-booking__field"><span><i>1</i><b>Питомец</b></span><AppSelect ariaLabel="Питомец" value={petId} onValueChange={setPetId} options={pets.map((pet) => ({ value: pet.id, label: pet.name }))} /></label>
              <label className="client-booking__field"><span><i>2</i><b>Услуга</b></span><AppSelect ariaLabel="Услуга" value={serviceId} onValueChange={chooseService} placeholder="Выберите услугу" options={services.map((service) => ({ value: service.id, label: `${service.name} · ${Number(service.price).toLocaleString("ru-RU")} ₽` }))} /></label>
              <label className="client-booking__field"><span><i>3</i><b>Мастер</b></span><AppSelect ariaLabel="Мастер" value={staffId} onValueChange={chooseStaff} placeholder="Выберите мастера" options={availableStaff.map((member) => ({ value: member.id, label: member.name }))} disabled={!serviceId || !availableStaff.length} /></label>
              <label className="client-booking__field"><span><i>4</i><b>Дата</b></span><DatePicker ariaLabel="Дата записи" min={tomorrow()} value={date} onValueChange={(value) => { setDate(value); setSlots([]); setSlot(""); }} required /></label>
              <div className="client-booking__slots"><span><i>5</i><b>Свободное время</b></span><div>{slots.map((item) => <button className={slot === item.startAt ? "is-active" : ""} type="button" key={item.startAt} onClick={() => setSlot(item.startAt)}>{new Date(item.startAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: slotTimezone })}</button>)}{!slots.length && <p className="client-booking__no-slots"><Clock3 aria-hidden="true" /><span><strong>Свободных окон на эту дату нет</strong>Выберите другой день — доступное время появится здесь.</span></p>}</div></div>
              <button className="salon-site__button client-booking__submit" type="button" disabled={booking || !slot} onClick={() => void createBooking()}>{booking ? "Создаём запись…" : "Подтвердить запись →"}</button>
            </div>
          )}
        </section>
      )}

      {tab === "appointments" && (
        <section className="client-list-section"><header><div><p className="salon-site__eyebrow">История и планы</p><h2>Мои записи</h2></div><button className="salon-site__button" type="button" onClick={() => setTab("booking")}><Plus aria-hidden="true" /> Новая запись</button></header><div className="client-appointment-list">{appointments.length ? appointments.map((item) => <article key={item.id}><span><Clock3 aria-hidden="true" /></span><div><strong>{item.serviceName || "Услуга"}</strong><p>{item.petName || "Питомец"} · {item.staffName || "Мастер будет назначен"}</p></div><time>{formatDate(item.startAt, site?.timezone)}</time><i>{appointmentStatusLabels[item.status]}</i></article>) : <div className="client-list-empty"><CalendarDays aria-hidden="true" /><h3>Записей пока нет</h3><p>Выберите услугу и удобное время — всё займёт пару минут.</p></div>}</div></section>
      )}

      {tab === "pets" && (
        <section className="client-list-section">
          <header>
            <div>
              <p className="salon-site__eyebrow">Ваши любимцы</p>
              <h2>Питомцы</h2>
            </div>
            <button
              className="salon-site__button"
              type="button"
              onClick={() => setAddingPet((value) => !value)}
            >
              <Plus aria-hidden="true" /> Добавить
            </button>
          </header>

          {addingPet && (
            <div className="client-pet-form">
              <label>
                <span>Имя питомца</span>
                <Input
                  value={petName}
                  onChange={(event) => setPetName(event.target.value)}
                  placeholder="Боня"
                />
              </label>
              <label>
                <span>Вид</span>
                <AppSelect
                  value={petSpecies}
                  onValueChange={setPetSpecies}
                  ariaLabel="Вид питомца"
                  options={[
                    { value: "dog", label: "Собака" },
                    { value: "cat", label: "Кошка" },
                    { value: "other", label: "Другой" },
                  ]}
                />
              </label>
              <label>
                <span>Порода</span>
                <Input
                  value={petBreed}
                  onChange={(event) => setPetBreed(event.target.value)}
                  placeholder="Шпиц"
                />
              </label>

              <label className="client-pet-form__upload">
                <span><ImagePlus aria-hidden="true" /> Фото питомца</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  aria-label="Фото питомца"
                  onChange={(event) => setPetPhoto(event.target.files?.[0] || null)}
                />
                <small>{petPhoto?.name || "JPEG, PNG или WebP · до 10 МБ"}</small>
              </label>
              <label className="client-pet-form__upload">
                <span><FileText aria-hidden="true" /> Ветеринарный паспорт</span>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  aria-label="Ветеринарный паспорт"
                  onChange={(event) => setPetPassport(event.target.files?.[0] || null)}
                />
                <small>{petPassport?.name || "PDF, JPEG, PNG или WebP · до 10 МБ"}</small>
              </label>

              <label className="client-pet-form__wide">
                <span>Особенности здоровья и противопоказания</span>
                <textarea
                  value={petMedicalNotes}
                  onChange={(event) => setPetMedicalNotes(event.target.value)}
                  placeholder="Например: аллергия на определённые средства, чувствительная кожа, ограничения по процедурам"
                  maxLength={5000}
                />
              </label>
              <label className="client-pet-form__wide">
                <span>Дополнительная информация для грумера</span>
                <textarea
                  value={petAdditionalInfo}
                  onChange={(event) => setPetAdditionalInfo(event.target.value)}
                  placeholder="Характер, привычки, реакция на фен или другие важные детали"
                  maxLength={5000}
                />
              </label>

              <p className="client-pet-form__privacy">
                Фото и документы доступны только вам и сотрудникам салона.
              </p>
              <button
                className="salon-site__button"
                type="button"
                disabled={booking || !petName.trim()}
                onClick={() => void createPet()}
              >
                {booking ? "Сохраняем…" : "Сохранить питомца →"}
              </button>
            </div>
          )}

          <div className="client-pet-grid">
            {pets.map((pet) => (
              <article key={pet.id}>
                <span><PawPrint aria-hidden="true" /></span>
                <h3>{pet.name}</h3>
                <p>
                  {pet.breed || (
                    pet.species === "cat"
                      ? "Кошка"
                      : pet.species === "dog"
                        ? "Собака"
                        : "Питомец"
                  )}
                </p>
                {(pet.photos.length > 0 || pet.documents.length > 0) && (
                  <div className="client-pet-card__meta">
                    {pet.photos.length > 0 && <span><ImagePlus aria-hidden="true" /> Фото</span>}
                    {pet.documents.length > 0 && <span><FileText aria-hidden="true" /> Паспорт</span>}
                  </div>
                )}
                {pet.documents.map((document) => (
                  <button
                    className="client-pet-card__delete-document"
                    type="button"
                    key={document.id}
                    disabled={deletingDocumentId === document.id}
                    onClick={() => void deletePassport(pet, document)}
                  >
                    <Trash2 aria-hidden="true" />
                    {deletingDocumentId === document.id ? "Удаляем…" : "Удалить паспорт"}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setPetId(pet.id);
                    setTab("booking");
                  }}
                >
                  Записать →
                </button>
              </article>
            ))}
            {!pets.length && !addingPet && (
              <div className="client-list-empty">
                <PawPrint aria-hidden="true" />
                <h3>Добавьте первого питомца</h3>
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}

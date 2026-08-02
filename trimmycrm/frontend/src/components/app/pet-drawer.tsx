"use client";

import { useEffect, useRef, useState } from "react";

import type { PetView } from "@/lib/api/types";
import { downloadApiFile } from "@/lib/api/client";
import { formatShortDate, speciesLabels } from "@/lib/app/crm";

export function PetDrawer({
  pet,
  ownerName,
  onClose,
}: {
  pet: PetView;
  ownerName?: string | null;
  onClose: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const [downloadingDocument, setDownloadingDocument] = useState<string | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);

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

  async function downloadDocument(documentId: string, filename: string | null) {
    setDownloadingDocument(documentId);
    setDocumentError(null);
    try {
      await downloadApiFile(
        `/admin/pets/${pet.id}/documents/${documentId}/content`,
        filename || `passport-${pet.name}.pdf`,
      );
    } catch {
      setDocumentError("Не удалось скачать документ. Попробуйте ещё раз.");
    } finally {
      setDownloadingDocument(null);
    }
  }

  return (
    <div className="appointment-dialog">
      <button className="appointment-dialog__backdrop" type="button" onClick={onClose} aria-label="Закрыть карточку" />
      <aside className="pet-drawer" role="dialog" aria-modal="true" aria-labelledby="pet-title">
        <header>
          <div>
            <p className="crm-kicker">Карточка питомца</p>
            <span className="pet-species">{speciesLabels[pet.species]}</span>
          </div>
          <button ref={closeButton} type="button" onClick={onClose} aria-label="Закрыть">×</button>
        </header>

        <section className="pet-drawer__hero">
          <div className="pet-drawer__portrait">
            <span aria-hidden="true">{pet.name[0]?.toUpperCase()}</span>
            <i>{pet.photos.length ? pet.photos.length + " фото" : "фото пока нет"}</i>
          </div>
          <div>
            <h2 id="pet-title">{pet.name}</h2>
            <p>{pet.breed || speciesLabels[pet.species]}</p>
            {ownerName && <span>владелец · {ownerName}</span>}
          </div>
        </section>

        <dl className="pet-facts">
          <div><dt>Возраст</dt><dd>{pet.ageYears === null ? "Не указан" : pet.ageYears + " г."}</dd></div>
          <div><dt>Вес</dt><dd>{pet.weightKg === null ? "Не указан" : pet.weightKg + " кг"}</dd></div>
          <div><dt>Дата рождения</dt><dd>{formatShortDate(pet.birthDate)}</dd></div>
          <div><dt>Тип шерсти</dt><dd>{pet.coatType || "Не указан"}</dd></div>
          <div className={pet.vaccinationCurrent === false ? "has-warning" : ""}>
            <dt>Вакцинация</dt>
            <dd>
              {pet.vaccinatedUntil
                ? (pet.vaccinationCurrent === false ? "Просрочена · " : "До ") + formatShortDate(pet.vaccinatedUntil)
                : "Нет данных"}
            </dd>
          </div>
          <div><dt>В CRM с</dt><dd>{formatShortDate(pet.createdAt)}</dd></div>
        </dl>

        <section className="pet-notes">
          <article>
            <p className="crm-kicker">Характер</p>
            <p>{pet.temperament || "Особенности поведения пока не указаны."}</p>
          </article>
          <article className={pet.allergies ? "has-warning" : ""}>
            <p className="crm-kicker">Аллергии</p>
            <p>{pet.allergies || "Не указаны."}</p>
          </article>
          <article className={pet.medicalNotes ? "has-warning" : ""}>
            <p className="crm-kicker">Медицинские заметки</p>
            <p>{pet.medicalNotes || "Ограничений не указано."}</p>
          </article>
          {pet.additionalInfo && (
            <article>
              <p className="crm-kicker">Дополнительная информация</p>
              <p>{pet.additionalInfo}</p>
            </article>
          )}
        </section>

        {pet.documents.length > 0 && (
          <section className="pet-documents" aria-label="Документы питомца">
            <p className="crm-kicker">Документы</p>
            {pet.documents.map((document) => (
              <button
                key={document.id}
                type="button"
                onClick={() => void downloadDocument(document.id, document.filename)}
                disabled={downloadingDocument === document.id}
              >
                <span aria-hidden="true">PDF</span>
                <span>
                  <strong>Ветеринарный паспорт</strong>
                  <small>{document.filename}</small>
                </span>
                <i>{downloadingDocument === document.id ? "Загрузка…" : "Скачать ↓"}</i>
              </button>
            ))}
            {documentError && <p className="pet-documents__error" role="alert">{documentError}</p>}
          </section>
        )}

        <footer>
          <span aria-hidden="true">i</span>
          <p>Изменять медицинские данные и фото может клиент в своём кабинете. Владелец салона видит актуальную карточку.</p>
        </footer>
      </aside>
    </div>
  );
}

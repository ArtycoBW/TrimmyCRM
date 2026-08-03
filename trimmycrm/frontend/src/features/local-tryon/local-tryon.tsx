"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type PointerEvent } from "react";
import Image from "next/image";
import Link from "next/link";

import { clampTransform, drawComposition, initialTransform, moveTransform } from "./canvas-engine";
import { TryOnControls } from "./controls";
import { exportLocalResult } from "./export-image";
import { decodeLocalPhoto, loadTemplateImage, type DecodedPhoto } from "./image-loader";
import { consultationHref, LOCAL_TRYON_DISCLAIMER, LOCAL_TRYON_PRIVACY_NOTICE } from "./privacy-boundary";
import { loadHairstyleManifest } from "./template-manifest";
import type { HairstyleTemplate, TryOnTransform } from "./template-types";

type DragState = {
  pointerId: number;
  x: number;
  y: number;
  transform: TryOnTransform;
};

function sameTransform(left: TryOnTransform, right: TryOnTransform) {
  return left.x === right.x && left.y === right.y && left.width === right.width
    && left.rotation === right.rotation && left.mirrored === right.mirrored && left.opacity === right.opacity;
}

export function LocalTryOn() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<DecodedPhoto | null>(null);
  const frameRef = useRef<number | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [templates, setTemplates] = useState<HairstyleTemplate[]>([]);
  const [templateImages, setTemplateImages] = useState<Map<string, HTMLImageElement>>(new Map());
  const [selectedId, setSelectedId] = useState("");
  const [photo, setPhoto] = useState<DecodedPhoto | null>(null);
  const [transform, setTransform] = useState<TryOnTransform>({ x: 0.5, y: 0.32, width: 0.58, rotation: 0, mirrored: false, opacity: 1 });
  const [history, setHistory] = useState<TryOnTransform[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Каталог загружается локально…");

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedId) || null,
    [selectedId, templates],
  );

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const loadedImages: HTMLImageElement[] = [];
    void loadHairstyleManifest(controller.signal)
      .then(async (manifest) => {
        const entries = await Promise.all(manifest.templates.map(async (template) => {
          const image = await loadTemplateImage(template.asset, controller.signal);
          loadedImages.push(image);
          return [template.id, image] as const;
        }));
        if (!active) return;
        const first = manifest.templates[0];
        setTemplates(manifest.templates);
        setTemplateImages(new Map(entries));
        setSelectedId(first.id);
        setTransform(initialTransform(first));
        setStatus("Выберите шаблон и откройте фото с устройства");
      })
      .catch((reason: unknown) => {
        if (!active || (reason instanceof DOMException && reason.name === "AbortError")) return;
        setError(reason instanceof Error ? reason.message : "Не удалось открыть каталог причёсок");
        setStatus("Каталог недоступен");
      });
    return () => {
      active = false;
      controller.abort();
      loadedImages.forEach((image) => { image.src = ""; });
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const templateImage = templateImages.get(selectedId);
    if (!canvas || !photo || !templateImage) return;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      drawComposition(canvas, photo.source, photo.width, photo.height, templateImage, transform);
      frameRef.current = null;
    });
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [photo, selectedId, templateImages, transform]);

  const clearPhoto = useCallback((message = "Фото удалено из рабочей памяти страницы") => {
    photoRef.current?.release();
    photoRef.current = null;
    setPhoto(null);
    setHistory([]);
    setError(null);
    setStatus(message);
    if (inputRef.current) inputRef.current.value = "";
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    if (canvas) { canvas.width = 1; canvas.height = 1; }
  }, []);

  useEffect(() => () => {
    photoRef.current?.release();
    photoRef.current = null;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    setStatus("Фото читается только в браузере…");
    try {
      const decoded = await decodeLocalPhoto(file);
      photoRef.current?.release();
      photoRef.current = decoded;
      setPhoto(decoded);
      setHistory([]);
      if (selectedTemplate) setTransform(initialTransform(selectedTemplate));
      setStatus("Фото готово. Переместите причёску на холсте");
    } catch (reason) {
      event.target.value = "";
      setError(reason instanceof Error ? reason.message : "Не удалось прочитать фото");
      setStatus("Фото не открыто");
    } finally {
      setBusy(false);
    }
  }

  function selectTemplate(template: HairstyleTemplate) {
    setHistory((current) => photo ? [...current, transform] : []);
    setSelectedId(template.id);
    setTransform(initialTransform(template));
    setStatus(`Выбран шаблон «${template.label}»`);
  }

  function changeTransform(next: TryOnTransform) {
    const clamped = clampTransform(next);
    if (sameTransform(clamped, transform)) return;
    setHistory((current) => [...current.slice(-39), transform]);
    setTransform(clamped);
  }

  function undo() {
    const previous = history.at(-1);
    if (!previous) return;
    setTransform(previous);
    setHistory((current) => current.slice(0, -1));
  }

  function pointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (!photo) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, transform };
  }

  function pointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setTransform(moveTransform(drag.transform, (event.clientX - drag.x) / rect.width, (event.clientY - drag.y) / rect.height));
  }

  function pointerUp(event: PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (!sameTransform(drag.transform, transform)) setHistory((current) => [...current.slice(-39), drag.transform]);
  }

  function canvasKeyDown(event: KeyboardEvent<HTMLCanvasElement>) {
    if (!photo) return;
    const step = event.shiftKey ? 0.02 : 0.006;
    let next: TryOnTransform | null = null;
    if (event.key === "ArrowLeft") next = moveTransform(transform, -step, 0);
    if (event.key === "ArrowRight") next = moveTransform(transform, step, 0);
    if (event.key === "ArrowUp") next = moveTransform(transform, 0, -step);
    if (event.key === "ArrowDown") next = moveTransform(transform, 0, step);
    if (event.key === "+" || event.key === "=") next = clampTransform({ ...transform, width: transform.width + step * 2 });
    if (event.key === "-") next = clampTransform({ ...transform, width: transform.width - step * 2 });
    if (event.key === "[") next = clampTransform({ ...transform, rotation: transform.rotation - 1 });
    if (event.key === "]") next = clampTransform({ ...transform, rotation: transform.rotation + 1 });
    if (event.key.toLowerCase() === "m") next = { ...transform, mirrored: !transform.mirrored };
    if (!next) return;
    event.preventDefault();
    changeTransform(next);
  }

  async function download() {
    const canvas = canvasRef.current;
    if (!canvas || !photo) return;
    setBusy(true);
    setError(null);
    setStatus("Готовим локальный файл…");
    try {
      await exportLocalResult(canvas);
      setStatus("Файл создан локально и передан браузеру для скачивания");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось скачать результат");
      setStatus("Экспорт не выполнен");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="tryon-shell">
      <a className="tryon-skip" href="#tryon-editor">К редактору</a>
      <header className="tryon-header">
        <Link href="/" className="tryon-brand" aria-label="TrimmyCRM — вернуться на сайт">T — CRM</Link>
        <a href="/client?booking=1" className="tryon-header__booking">Записаться без примерки</a>
      </header>

      <section className="tryon-intro" aria-labelledby="tryon-title">
        <p className="tryon-kicker">Локальная 2D-примерка · прототип</p>
        <h1 id="tryon-title">Примерьте форму <span>до консультации</span></h1>
        <figure className="tryon-intro__portrait" aria-hidden="true">
          <Image src="/images/editorial/woman-graphic-pixie.webp" alt="" fill priority sizes="(max-width: 760px) 50vw, 28vw" />
          <figcaption>PIXIE / EDGE</figcaption>
        </figure>
        <div className="tryon-intro__copy">
          <p>{LOCAL_TRYON_PRIVACY_NOTICE}</p>
          <p>{LOCAL_TRYON_DISCLAIMER}</p>
        </div>
      </section>

      <section className="tryon-steps" aria-label="Как работает примерка">
        <span>01 Выберите шаблон</span><span>02 Откройте фото</span><span>03 Совместите и скачайте</span>
      </section>

      <div className="tryon-layout" id="tryon-editor">
        <aside className="tryon-catalog" aria-labelledby="tryon-catalog-title">
          <div>
            <p>01 / Каталог</p>
            <h2 id="tryon-catalog-title">Форма причёски</h2>
          </div>
          <div className="tryon-template-list" aria-busy={templates.length === 0}>
            {templates.map((template) => (
              <button
                type="button"
                className={selectedId === template.id ? "is-selected" : ""}
                aria-pressed={selectedId === template.id}
                onClick={() => selectTemplate(template)}
                key={template.id}
              >
                {/* Curated same-origin assets only; URLs are validated by template-manifest.ts. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={template.preview} alt="" />
                <span><strong>{template.label}</strong><small>{template.audience.includes("men") ? "Короткая форма" : "Средняя длина"}</small></span>
                <i aria-hidden="true">{selectedId === template.id ? "✓" : "+"}</i>
              </button>
            ))}
          </div>
          {templates.length === 0 && !error && <p className="tryon-catalog__loading">Проверяем локальный manifest…</p>}
        </aside>

        <section className="tryon-stage" aria-labelledby="tryon-stage-title">
          <div className="tryon-stage__heading">
            <div><p>Фото остаётся у вас</p><h2 id="tryon-stage-title">Холст</h2></div>
            {photo && <button type="button" onClick={() => clearPhoto()} disabled={busy}>Удалить фото</button>}
          </div>
          <div className={`tryon-canvas-wrap${photo ? " has-photo" : ""}`}>
            <canvas
              ref={canvasRef}
              width="1"
              height="1"
              tabIndex={photo ? 0 : -1}
              role="img"
              aria-label={photo ? "Локальный холст примерки. Перетаскивайте причёску или используйте клавиатуру" : "Холст примерки без фото"}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onPointerCancel={pointerUp}
              onKeyDown={canvasKeyDown}
            />
            {!photo && <div className="tryon-empty">
              <span aria-hidden="true">↥</span>
              <h3>Откройте фронтальное фото</h3>
              <p>Ровный свет и видимая линия головы помогут точнее совместить 2D-шаблон.</p>
              <label className="tryon-file-button">
                <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} disabled={busy || templates.length === 0} />
                <span>{busy ? "Читаем фото…" : "Выбрать фото"}</span>
              </label>
            </div>}
          </div>
          {photo && <label className="tryon-file-inline">
            <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} disabled={busy} />
            <span>Заменить фото</span>
          </label>}
          <p className="tryon-status" role={error ? "alert" : "status"} aria-live="polite">{error || status}</p>
        </section>

        <TryOnControls
          transform={transform}
          disabled={!photo || busy}
          canUndo={history.length > 0}
          onChange={changeTransform}
          onMirror={() => changeTransform({ ...transform, mirrored: !transform.mirrored })}
          onReset={() => selectedTemplate && changeTransform(initialTransform(selectedTemplate))}
          onUndo={undo}
        />
      </div>

      <section className="tryon-actions" aria-labelledby="tryon-actions-title">
        <div><p>03 / Результат</p><h2 id="tryon-actions-title">Сохраните или обсудите</h2></div>
        <p>{LOCAL_TRYON_DISCLAIMER} Шаблон показывает только общую форму и не оценивает достижимость длины, густоты или цвета.</p>
        <div>
          <button type="button" onClick={download} disabled={!photo || busy}>Скачать локально</button>
          <a href={selectedTemplate ? consultationHref(selectedTemplate.id) : "/client?booking=1"}>Обсудить с мастером</a>
        </div>
      </section>

      <footer className="tryon-footer">
        <strong>TrimmyCRM</strong>
        <p>Без распознавания лица, внешнего AI API, загрузки на сервер и хранения результата.</p>
        <a href="/privacy">Политика конфиденциальности</a>
      </footer>
    </main>
  );
}

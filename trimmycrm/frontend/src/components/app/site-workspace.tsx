"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Eye, EyeOff, ExternalLink, GripVertical, ImagePlus, Keyboard, LoaderCircle, LockKeyhole, Maximize2, Minimize2, Monitor, Palette, Pencil, Plus, RotateCcw, Save, Send, Settings2, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";

import { useApp } from "@/components/app/app-provider";
import { mediaUrl, SalonSiteCanvas } from "@/components/site/public-salon-site";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { AppSelect } from "@/components/ui/select";
import { apiRequest } from "@/lib/api/client";
import type {
  BlockCatalogItem,
  MediaView,
  PublicSiteSnapshot,
  SiteBlockView,
  SitePreview,
  SitePublishResult,
  SiteView,
} from "@/lib/api/types";

type LoadState = "loading" | "ready" | "error";

const blockFields: Record<string, Array<{ key: string; label: string; multiline?: boolean }>> = {
  hero: [
    { key: "title", label: "Главный заголовок" },
    { key: "subtitle", label: "Подзаголовок", multiline: true },
    { key: "cta", label: "Текст кнопки" },
  ],
  about: [{ key: "title", label: "Заголовок" }, { key: "text", label: "Описание", multiline: true }],
  services: [{ key: "title", label: "Заголовок" }, { key: "subtitle", label: "Текст над карточками", multiline: true }],
  booking: [{ key: "title", label: "Заголовок" }, { key: "subtitle", label: "Пояснение", multiline: true }, { key: "cta", label: "Текст кнопки" }],
  loyalty: [{ key: "title", label: "Заголовок" }, { key: "text", label: "Описание", multiline: true }, { key: "cta", label: "Текст кнопки" }],
  cta: [{ key: "title", label: "Заголовок" }, { key: "text", label: "Описание", multiline: true }, { key: "cta", label: "Текст кнопки" }],
  gallery: [{ key: "title", label: "Заголовок" }, { key: "subtitle", label: "Пояснение", multiline: true }],
  staff: [{ key: "title", label: "Заголовок" }, { key: "subtitle", label: "Пояснение", multiline: true }],
  reviews: [{ key: "title", label: "Заголовок" }, { key: "subtitle", label: "Пояснение", multiline: true }],
  promotions: [{ key: "title", label: "Заголовок" }, { key: "subtitle", label: "Описание акции", multiline: true }],
  hours: [{ key: "title", label: "Заголовок" }, { key: "subtitle", label: "Пояснение", multiline: true }],
  contacts: [{ key: "title", label: "Заголовок" }, { key: "subtitle", label: "Пояснение", multiline: true }],
  faq: [{ key: "title", label: "Заголовок" }, { key: "subtitle", label: "Пояснение", multiline: true }],
  blog: [{ key: "title", label: "Заголовок" }, { key: "subtitle", label: "Пояснение", multiline: true }],
  socials: [{ key: "title", label: "Заголовок" }, { key: "subtitle", label: "Пояснение", multiline: true }],
};

type GalleryItem = { id: string; src: string; caption: string };
type StructuredItem = Record<string, string>;

function galleryItems(block: SiteBlockView | null, key = "items"): GalleryItem[] {
  const source = block?.config[key];
  if (!block || !Array.isArray(source)) return [];
  return source.filter((item): item is GalleryItem => {
    if (!item || typeof item !== "object") return false;
    const value = item as Record<string, unknown>;
    return typeof value.id === "string" && typeof value.src === "string" && typeof value.caption === "string";
  });
}

const fontOptions = [
  { value: "display", label: "Акцентный · Unbounded" },
  { value: "clean", label: "Спокойный · Manrope" },
  { value: "hand", label: "Рукописный · Caveat" },
];

const appearanceKeys = ["backgroundColor", "textColor", "accentColor", "fontFamily", "titleSize", "textSize"] as const;

const colorPresets = [
  "#fffef9", "#10100f", "#20c4dc", "#d5ff3a", "#ff4092", "#e9ddff",
  "#ffd0b8", "#fff1dc", "#a5e9f1", "#5d9c73", "#9a4e58", "#5c58c9",
];

function configColor(block: SiteBlockView, key: string, fallback: string) {
  const value = block.config[key];
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function AppearanceColorPicker({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  function selectColor(next: string) {
    setDraft(next);
    onValueChange(next);
  }

  return (
    <details className="visual-builder__color">
      <summary>
        <span>{label}</span>
        <i className="visual-builder__color-swatch" style={{ backgroundColor: value }} aria-hidden="true" />
      </summary>
      <div className="visual-builder__color-options" role="group" aria-label={`Палитра: ${label}`}>
        {colorPresets.map((color) => (
          <button
            type="button"
            key={color}
            title={color}
            aria-label={`${label}: ${color}`}
            aria-pressed={color.toLowerCase() === value.toLowerCase()}
            style={{ "--color": color } as CSSProperties}
            onClick={() => selectColor(color)}
          />
        ))}
        <input
          aria-label={`${label}: цвет в формате HEX`}
          value={draft}
          maxLength={7}
          inputMode="text"
          spellCheck={false}
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            if (/^#[0-9a-f]{6}$/i.test(next)) onValueChange(next);
          }}
          onBlur={() => setDraft(value)}
        />
      </div>
    </details>
  );
}

function configSize(block: SiteBlockView, key: string, fallback: number) {
  const value = block.config[key];
  return typeof value === "number" ? value : fallback;
}

function structuredItems(block: SiteBlockView | null): StructuredItem[] {
  if (!block || !["faq", "blog"].includes(block.type) || !Array.isArray(block.config.items)) return [];
  return block.config.items.filter((item): item is StructuredItem => Boolean(item) && typeof item === "object" && !Array.isArray(item) && Object.values(item).every((value) => typeof value === "string"));
}

function defaultFields(type: string) {
  return blockFields[type] || [{ key: "title", label: "Заголовок" }];
}

function catalogName(catalog: BlockCatalogItem[], type: string) {
  return catalog.find((item) => item.type === type)?.name || type.replaceAll("_", " ");
}

function SortablePreviewBlock({
  block,
  name,
  selected,
  onSelect,
  onToggle,
  onRemove,
  children,
}: {
  block: SiteBlockView;
  name: string;
  selected: boolean;
  onSelect: () => void;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`site-preview-sortable${selected ? " is-selected" : ""}${!block.enabled ? " is-disabled" : ""}${isDragging ? " is-dragging" : ""}`}
      data-builder-block-id={block.id}
      onClick={onSelect}
      {...listeners}
    >
      <div className="site-preview-sortable__toolbar" onClick={(event) => event.stopPropagation()}>
        <button className="site-preview-sortable__handle" type="button" aria-label={`Перетащить блок ${name}`} {...attributes}>
          <GripVertical aria-hidden="true" /><span>{block.position + 1}. {name}</span>
        </button>
        <button type="button" aria-label={`Редактировать блок ${name}`} onPointerDown={(event) => event.stopPropagation()} onClick={onSelect}><Pencil aria-hidden="true" /></button>
        <button type="button" aria-label={`${block.enabled ? "Скрыть" : "Показать"} блок ${name}`} onPointerDown={(event) => event.stopPropagation()} onClick={() => onToggle(!block.enabled)}>{block.enabled ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}</button>
        <button className="is-danger" type="button" aria-label={`Удалить блок ${name}`} onPointerDown={(event) => event.stopPropagation()} onClick={onRemove}><Trash2 aria-hidden="true" /></button>
      </div>
      <div className="site-preview-sortable__content">{children}</div>
    </div>
  );
}

export function SiteWorkspace() {
  const { site, setSite } = useApp();
  const [state, setState] = useState<LoadState>("loading");
  const [blocks, setBlocks] = useState<SiteBlockView[]>([]);
  const [catalog, setCatalog] = useState<BlockCatalogItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMac, setIsMac] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    let alive = true;
    Promise.all([
      apiRequest<SiteBlockView[]>("/sites/mine/blocks", { realm: "platform" }),
      apiRequest<BlockCatalogItem[]>("/sites/mine/block-catalog", { realm: "platform" }),
    ])
      .then(([savedBlocks, available]) => {
        if (!alive) return;
        const ordered = savedBlocks.sort((left, right) => left.position - right.position);
        setBlocks(ordered);
        setCatalog(available);
        setSelectedId(ordered[0]?.id || null);
        setState("ready");
      })
      .catch((reason) => {
        if (!alive) return;
        setState("error");
        setMessage(reason instanceof Error ? reason.message : "Не удалось загрузить конструктор сайта");
      });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setIsMac(/Mac|iPhone|iPad|iPod/i.test(navigator.platform)), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("site-builder-fullscreen", isFullscreen);
    return () => document.body.classList.remove("site-builder-fullscreen");
  }, [isFullscreen]);

  useEffect(() => {
    function syncFullscreen() {
      if (!document.fullscreenElement) setIsFullscreen(false);
    }
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  const unusedBlocks = useMemo(
    () => catalog.filter((item) => !blocks.some((block) => block.type === item.type)),
    [blocks, catalog],
  );
  const selected = blocks.find((block) => block.id === selectedId) || null;
  const modifierKey = isMac ? "⌘" : "Ctrl";
  const optionKey = isMac ? "⌥" : "Alt";
  const previewSnapshot = useMemo<PublicSiteSnapshot | null>(() => site ? ({
    id: site.id,
    name: site.name,
    slug: site.slug,
    salonType: site.salonType,
    serviceFocuses: site.serviceFocuses,
    locale: site.locale,
    currency: site.currency,
    customDomain: site.customDomain,
    description: site.description,
    city: site.city,
    street: site.street,
    phone: site.phone,
    workHours: site.workHours,
    socials: site.socials,
    logoUrl: site.logoUrl,
    theme: site.theme,
    timezone: site.timezone,
    templateKey: site.templateKey,
    blocks,
  }) : null, [blocks, site]);
  const previewMediaUrl = (url: string) => previewSnapshot ? mediaUrl(url, previewSnapshot, true) : url;

  function updateBlock(id: string, patch: Partial<SiteBlockView>) {
    setBlocks((current) => current.map((block) => block.id === id ? { ...block, ...patch } : block));
  }

  function updateConfig(key: string, value: unknown) {
    if (!selected) return;
    updateBlock(selected.id, { config: { ...selected.config, [key]: value } });
  }

  function resetAppearance() {
    if (!selected) return;
    const config = { ...selected.config };
    for (const key of appearanceKeys) delete config[key];
    updateBlock(selected.id, { config });
  }

  function scrollToBlock(id: string) {
    window.requestAnimationFrame(() => {
      const element = Array.from(document.querySelectorAll<HTMLElement>("[data-builder-block-id]"))
        .find((item) => item.dataset.builderBlockId === id);
      element?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  function selectRelativeBlock(direction: -1 | 1) {
    if (!blocks.length) return;
    const current = blocks.findIndex((block) => block.id === selectedId);
    const nextIndex = current < 0
      ? (direction > 0 ? 0 : blocks.length - 1)
      : (current + direction + blocks.length) % blocks.length;
    const next = blocks[nextIndex];
    setSelectedId(next.id);
    scrollToBlock(next.id);
  }

  function moveSelectedBlock(direction: -1 | 1) {
    if (!selectedId) return;
    setBlocks((current) => {
      const from = current.findIndex((block) => block.id === selectedId);
      const to = Math.max(0, Math.min(current.length - 1, from + direction));
      if (from < 0 || from === to) return current;
      return arrayMove(current, from, to).map((block, position) => ({ ...block, position }));
    });
    scrollToBlock(selectedId);
  }

  async function toggleFullscreen(next = !isFullscreen) {
    setIsFullscreen(next);
    try {
      if (next && !document.fullscreenElement) await document.documentElement.requestFullscreen();
      if (!next && document.fullscreenElement) await document.exitFullscreen();
    } catch {
      // CSS fullscreen remains available when the browser blocks the native API.
    }
  }

  useEffect(() => {
    function onBuilderShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (target?.closest(".ui-select-trigger")) return;
      if (event.key === "Escape" && document.activeElement?.matches(".ui-select-trigger")) return;
      // Radix places an open listbox in a portal. Its Escape and arrow keys
      // belong to the select, not to the canvas-level shortcut handler.
      if (document.querySelector(".ui-select-content[data-state='open']")) return;
      const modifier = isMac ? event.metaKey : event.ctrlKey;

      if (modifier && !event.shiftKey && event.key === "ArrowDown") {
        event.preventDefault();
        selectRelativeBlock(1);
        return;
      }
      if (modifier && !event.shiftKey && event.key === "ArrowUp") {
        event.preventDefault();
        selectRelativeBlock(-1);
        return;
      }
      if (event.altKey && event.key === "ArrowDown") {
        event.preventDefault();
        moveSelectedBlock(1);
        return;
      }
      if (event.altKey && event.key === "ArrowUp") {
        event.preventDefault();
        moveSelectedBlock(-1);
        return;
      }
      if (modifier && event.shiftKey && event.key.toLowerCase() === "h" && selected) {
        event.preventDefault();
        updateBlock(selected.id, { enabled: !selected.enabled });
        return;
      }
      if (modifier && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        void toggleFullscreen();
        return;
      }
      if (event.key === "Escape" && isFullscreen) {
        event.preventDefault();
        void toggleFullscreen(false);
      }
    }

    window.addEventListener("keydown", onBuilderShortcut);
    return () => window.removeEventListener("keydown", onBuilderShortcut);
  });

  async function uploadImages(files: FileList | null) {
    if (!selected || !files?.length || !["hero", "about", "gallery"].includes(selected.type)) return;
    const target = selected;
    const itemKey = target.type === "hero" ? "images" : "items";
    const currentItems = galleryItems(target, itemKey);
    const available = target.type === "gallery"
      ? Math.max(0, 12 - currentItems.length)
      : target.type === "hero"
        ? Math.max(0, 3 - currentItems.length)
        : 1;
    const chosen = Array.from(files).slice(0, available);
    if (!chosen.length) {
      setMessage(target.type === "hero" ? "На первом экране можно разместить до 3 фотографий" : "В галерее можно разместить до 12 фотографий");
      return;
    }
    setUploading(true);
    setMessage(null);
    try {
      const uploaded: MediaView[] = [];
      for (const file of chosen) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("purpose", "gallery");
        uploaded.push(await apiRequest<MediaView>("/media", {
          realm: "platform",
          method: "POST",
          body: formData,
        }));
      }
      if (target.type === "gallery" || target.type === "hero") {
        updateBlock(target.id, {
          config: {
            ...target.config,
            [itemKey]: [...currentItems, ...uploaded.map((media) => ({ id: media.id, src: media.url, caption: "" }))],
          },
        });
      } else {
        updateBlock(target.id, { config: { ...target.config, image: uploaded[0].url } });
      }
      setMessage(uploaded.length === 1 ? "Фотография добавлена в черновик" : `Добавлено фотографий: ${uploaded.length}`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Не удалось загрузить фотографию");
    } finally {
      setUploading(false);
    }
  }

  function updateGalleryItem(index: number, patch: Partial<GalleryItem>) {
    if (!selected || selected.type !== "gallery") return;
    updateConfig("items", galleryItems(selected).map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  function removeGalleryItem(index: number) {
    if (!selected || selected.type !== "gallery") return;
    updateConfig("items", galleryItems(selected).filter((_, itemIndex) => itemIndex !== index));
  }

  function updateHeroImage(index: number, patch: Partial<GalleryItem>) {
    if (!selected || selected.type !== "hero") return;
    updateConfig("images", galleryItems(selected, "images").map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  function removeHeroImage(index: number) {
    if (!selected || selected.type !== "hero") return;
    updateConfig("images", galleryItems(selected, "images").filter((_, itemIndex) => itemIndex !== index));
  }

  function addStructuredItem() {
    if (!selected || !["faq", "blog"].includes(selected.type)) return;
    const items = structuredItems(selected);
    if (items.length >= 10) {
      setMessage("В одном разделе можно разместить до 10 элементов");
      return;
    }
    const next = selected.type === "faq"
      ? { question: "Новый вопрос", answer: "Напишите понятный ответ для клиента." }
      : { title: "Новая публикация", text: "Добавьте короткий текст новости или полезного совета." };
    updateConfig("items", [...items, next]);
  }

  function updateStructuredItem(index: number, key: string, value: string) {
    if (!selected) return;
    updateConfig("items", structuredItems(selected).map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
  }

  function removeStructuredItem(index: number) {
    if (!selected) return;
    updateConfig("items", structuredItems(selected).filter((_, itemIndex) => itemIndex !== index));
  }

  function addBlock(item: BlockCatalogItem) {
    if (!item.allowed) {
      setMessage(item.lockedReason || "Этот блок недоступен на текущем тарифе");
      return;
    }
    const id = `new-${item.type}`;
    setBlocks((current) => [...current, { id, type: item.type, position: current.length, config: { ...item.defaultConfig }, enabled: true }]);
    setSelectedId(id);
    setMessage(null);
  }

  function removeBlock(id: string) {
    setBlocks((current) => current.filter((item) => item.id !== id).map((item, position) => ({ ...item, position })));
    if (selectedId === id) setSelectedId(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setBlocks((current) => {
      const from = current.findIndex((block) => block.id === active.id);
      const to = current.findIndex((block) => block.id === over.id);
      return arrayMove(current, from, to).map((block, position) => ({ ...block, position }));
    });
  }

  async function persistBlocks(successMessage = "Черновик сохранён") {
    if (!site) return null;
    const saved = await apiRequest<SiteBlockView[]>("/sites/mine/blocks", {
      realm: "platform",
      method: "PUT",
      body: JSON.stringify({
        expectedVersion: site.draftVersion,
        blocks: blocks.map(({ type, position, config, enabled }) => ({ type, position, config, enabled })),
      }),
    });
    const ordered = saved.sort((left, right) => left.position - right.position);
    setBlocks(ordered);
    const updated = await apiRequest<SiteView>("/sites/mine", { realm: "platform" });
    setSite(updated);
    setMessage(successMessage);
    return ordered;
  }

  async function saveBlocks() {
    setSaving(true);
    setMessage(null);
    try {
      await persistBlocks();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Не удалось сохранить блоки");
    } finally {
      setSaving(false);
    }
  }

  async function preview() {
    const previewWindow = window.open("about:blank", "_blank");
    if (previewWindow) previewWindow.opener = null;
    setSaving(true);
    setMessage(null);
    try {
      await persistBlocks("Черновик сохранён — открываем предпросмотр");
      const result = await apiRequest<SitePreview>("/sites/mine/preview", { realm: "platform", method: "POST" });
      if (previewWindow) previewWindow.location.replace(result.previewUrl);
      else window.location.assign(result.previewUrl);
    } catch (reason) {
      previewWindow?.close();
      setMessage(reason instanceof Error ? reason.message : "Не удалось открыть предпросмотр");
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    setSaving(true);
    setMessage(null);
    try {
      await persistBlocks("Черновик сохранён");
      const result = await apiRequest<SitePublishResult>("/sites/mine/publish", { realm: "platform", method: "POST" });
      const updated = await apiRequest<SiteView>("/sites/mine", { realm: "platform" });
      setSite(updated);
      setMessage(`Сайт опубликован: версия ${result.version}`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Не удалось опубликовать сайт");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="site-workspace" aria-labelledby="site-workspace-title">
      <header className="workspace-heading site-workspace__heading">
        <div><p className="crm-kicker">Визуальный конструктор</p><h1 id="site-workspace-title">Сайт салона</h1><p>Перетаскивайте блоки, меняйте тексты и сразу смотрите результат. Сохранение и публикация используют тот же макет.</p></div>
        <div className="workspace-heading__actions">
          <button className="button button--outline" type="button" onClick={() => void toggleFullscreen(true)} disabled={state !== "ready"}><Maximize2 aria-hidden="true" /> На весь экран</button>
          <button className="button button--outline" type="button" onClick={() => void preview()} disabled={state !== "ready" || saving}><Monitor aria-hidden="true" /> Предпросмотр</button>
          <button className="button button--outline" type="button" onClick={() => void saveBlocks()} disabled={state !== "ready" || saving}><Save aria-hidden="true" /> Сохранить</button>
          <button className="button button--ink" type="button" onClick={() => void publish()} disabled={state !== "ready" || saving}><Send aria-hidden="true" /> Опубликовать</button>
        </div>
      </header>
      {message && <p className={message.includes("сохранён") || message.startsWith("Сайт опубликован") || message.includes("добавлен") || message.startsWith("Добавлено") ? "workspace-notice is-success" : "workspace-notice"} role="status">{message}</p>}
      {state === "loading" && <div className="workspace-loading" aria-busy="true">Загружаем визуальный конструктор…</div>}
      {state === "error" && <div className="workspace-loading">Конструктор не загрузился. Обновите страницу.</div>}
      {state === "ready" && (
        <div className={`visual-builder visual-builder--live${isFullscreen ? " visual-builder--fullscreen" : ""}`}>
          <div className="visual-builder__topbar">
            <div className="visual-builder__topbar-brand"><span>G</span><div><strong>TrimmyCRM</strong><small>{site?.name} · живой холст</small></div></div>
            <div className="visual-builder__topbar-hints" aria-label="Основные горячие клавиши">
              <span><KbdGroup><Kbd>{modifierKey}</Kbd><Kbd>↑</Kbd><Kbd>↓</Kbd></KbdGroup> выбрать</span>
              <span><KbdGroup><Kbd>{optionKey}</Kbd><Kbd>↑</Kbd><Kbd>↓</Kbd></KbdGroup> переместить</span>
            </div>
            <div className="visual-builder__topbar-actions">
              <button type="button" onClick={() => void saveBlocks()} disabled={saving}><Save aria-hidden="true" /> Сохранить</button>
              <button className="is-primary" type="button" onClick={() => void publish()} disabled={saving}><Send aria-hidden="true" /> Опубликовать</button>
              <button type="button" aria-label="Выйти из полноэкранного режима" onClick={() => void toggleFullscreen(false)}><Minimize2 aria-hidden="true" /></button>
            </div>
          </div>
          <aside className="visual-builder__catalog">
            <header><span><Plus aria-hidden="true" /></span><div><p className="crm-kicker">Библиотека</p><h2>Блоки</h2></div></header>
            <p>Добавьте раздел, затем настройте его прямо в живом макете.</p>
            <div className="visual-builder__catalog-list">
              {unusedBlocks.map((item) => (
                <button className={!item.allowed ? "is-locked" : undefined} type="button" key={item.type} onClick={() => addBlock(item)} disabled={!item.allowed} title={!item.allowed ? item.lockedReason || "Недоступно на текущем тарифе" : undefined}>
                  <span>{item.allowed ? "+" : <LockKeyhole aria-hidden="true" />}</span><strong>{item.name}</strong><small>{item.allowed ? "Добавить" : item.lockedReason || "Недоступно"}</small>
                </button>
              ))}
              {!unusedBlocks.length && <p className="visual-builder__catalog-empty">Все доступные блоки уже на странице.</p>}
            </div>
            <div className="visual-builder__shortcuts">
              <header><Keyboard aria-hidden="true" /><div><strong>Горячие клавиши</strong><span>{isMac ? "macOS" : "Windows"}</span></div></header>
              <ul>
                <li><span>Следующий / предыдущий</span><KbdGroup><Kbd>{modifierKey}</Kbd><Kbd>↑</Kbd><Kbd>↓</Kbd></KbdGroup></li>
                <li><span>Переместить секцию</span><KbdGroup><Kbd>{optionKey}</Kbd><Kbd>↑</Kbd><Kbd>↓</Kbd></KbdGroup></li>
                <li><span>Скрыть / показать</span><KbdGroup><Kbd>{modifierKey}</Kbd><Kbd>⇧</Kbd><Kbd>H</Kbd></KbdGroup></li>
                <li><span>Полный экран</span><KbdGroup><Kbd>{modifierKey}</Kbd><Kbd>⇧</Kbd><Kbd>F</Kbd></KbdGroup></li>
              </ul>
            </div>
          </aside>

          <section className="visual-builder__preview" aria-label="Живой макет страницы">
            <header><div><span className="is-red" /><span className="is-yellow" /><span className="is-green" /></div><p>{site?.slug}.trimmycrm.ru · зажмите любую часть секции и перетащите</p><strong>{blocks.filter((block) => block.enabled).length} LIVE</strong></header>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={blocks.map((block) => block.id)} strategy={verticalListSortingStrategy}>
                <div className="visual-builder__preview-scroll">
                  {previewSnapshot && <SalonSiteCanvas
                    snapshot={previewSnapshot}
                    embedded={!isFullscreen}
                    editor
                    includeDisabled
                    renderBlock={(block, content) => (
                      <SortablePreviewBlock
                        block={block}
                        name={catalogName(catalog, block.type)}
                        selected={selectedId === block.id}
                        onSelect={() => setSelectedId(block.id)}
                        onToggle={(enabled) => updateBlock(block.id, { enabled })}
                        onRemove={() => removeBlock(block.id)}
                      >{content}</SortablePreviewBlock>
                    )}
                  />}
                  {!blocks.length && <div className="visual-builder__empty"><Plus aria-hidden="true" /><strong>Страница пустая</strong><p>Добавьте первый раздел из библиотеки.</p></div>}
                </div>
              </SortableContext>
            </DndContext>
          </section>

          <aside className="visual-builder__settings">
            {selected ? <>
              <header><Settings2 aria-hidden="true" /><div><p className="crm-kicker">Содержимое раздела</p><h3>{catalogName(catalog, selected.type)}</h3></div></header>
              <div className="visual-builder__settings-actions">
                <button type="button" onClick={() => updateBlock(selected.id, { enabled: !selected.enabled })}>{selected.enabled ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}{selected.enabled ? "Скрыть" : "Показать"}</button>
                <button className="is-danger" type="button" onClick={() => removeBlock(selected.id)}><Trash2 aria-hidden="true" />Удалить</button>
              </div>
              <div className="visual-builder__settings-fields">
                {defaultFields(selected.type).map((field) => (
                  <label key={field.key}><span>{field.label}</span>{field.multiline ? (
                    <textarea rows={4} value={typeof selected.config[field.key] === "string" ? String(selected.config[field.key]) : ""} placeholder="Введите текст, который увидят посетители" onChange={(event) => updateConfig(field.key, event.target.value)} />
                  ) : (
                    <Input value={typeof selected.config[field.key] === "string" ? String(selected.config[field.key]) : ""} placeholder="Введите текст" onChange={(event) => updateConfig(field.key, event.target.value)} />
                  )}</label>
                ))}
                <section className="visual-builder__appearance" aria-labelledby="block-appearance-title">
                  <header><Palette aria-hidden="true" /><div><strong id="block-appearance-title">Оформление раздела</strong><span>Цвета, шрифт и масштаб текста</span></div></header>
                  <div className="visual-builder__colors">
                    <AppearanceColorPicker label="Фон" value={configColor(selected, "backgroundColor", "#fffef9")} onValueChange={(value) => updateConfig("backgroundColor", value)} />
                    <AppearanceColorPicker label="Текст" value={configColor(selected, "textColor", "#10100f")} onValueChange={(value) => updateConfig("textColor", value)} />
                    <AppearanceColorPicker label="Акцент" value={configColor(selected, "accentColor", "#ff4092")} onValueChange={(value) => updateConfig("accentColor", value)} />
                  </div>
                  <label><span>Шрифт заголовков</span><AppSelect value={typeof selected.config.fontFamily === "string" ? selected.config.fontFamily : "display"} onValueChange={(value) => updateConfig("fontFamily", value)} options={fontOptions} /></label>
                  <label className="visual-builder__range"><span>Размер заголовка <output aria-hidden="true">{configSize(selected, "titleSize", 76)} px</output></span><input aria-label="Размер заголовка" type="range" min="28" max="150" step="2" value={configSize(selected, "titleSize", 76)} onChange={(event) => updateConfig("titleSize", Number(event.target.value))} /></label>
                  <label className="visual-builder__range"><span>Размер обычного текста <output aria-hidden="true">{configSize(selected, "textSize", 18)} px</output></span><input aria-label="Размер обычного текста" type="range" min="12" max="30" step="1" value={configSize(selected, "textSize", 18)} onChange={(event) => updateConfig("textSize", Number(event.target.value))} /></label>
                  <button className="visual-builder__appearance-reset" type="button" onClick={resetAppearance}><RotateCcw aria-hidden="true" /> Сбросить оформление</button>
                </section>
                {selected.type === "gallery" && <label><span>Сетка фотографий</span><AppSelect value={String(typeof selected.config.columns === "number" ? selected.config.columns : 3)} onValueChange={(value) => updateConfig("columns", Number(value))} options={[{ value: "2", label: "2 колонки" }, { value: "3", label: "3 колонки" }, { value: "4", label: "4 колонки" }]} /></label>}
                {selected.type === "reviews" && <label><span>Количество отзывов</span><AppSelect value={String(typeof selected.config.limit === "number" ? selected.config.limit : 6)} onValueChange={(value) => updateConfig("limit", Number(value))} options={[{ value: "3", label: "3 отзыва" }, { value: "6", label: "6 отзывов" }, { value: "9", label: "9 отзывов" }]} /></label>}
                {["faq", "blog"].includes(selected.type) && (
                  <div className="visual-builder__repeat">
                    <header><div><strong>{selected.type === "faq" ? "Вопросы и ответы" : "Публикации"}</strong><span>До 10 элементов</span></div><button type="button" onClick={addStructuredItem}><Plus aria-hidden="true" /> Добавить</button></header>
                    {structuredItems(selected).map((item, index) => {
                      const titleKey = selected.type === "faq" ? "question" : "title";
                      const textKey = selected.type === "faq" ? "answer" : "text";
                      return <article key={index}>
                        <label><span>{selected.type === "faq" ? "Вопрос" : "Заголовок"}</span><Input value={item[titleKey] || ""} onChange={(event) => updateStructuredItem(index, titleKey, event.target.value)} /></label>
                        <label><span>{selected.type === "faq" ? "Ответ" : "Текст"}</span><textarea rows={3} value={item[textKey] || ""} onChange={(event) => updateStructuredItem(index, textKey, event.target.value)} /></label>
                        <button type="button" aria-label={`Удалить элемент ${index + 1}`} onClick={() => removeStructuredItem(index)}><Trash2 aria-hidden="true" /> Удалить</button>
                      </article>;
                    })}
                    {!structuredItems(selected).length && <p>Пока пусто. Добавьте первый элемент — он сразу появится в макете.</p>}
                  </div>
                )}
                {["hero", "about", "gallery"].includes(selected.type) && (
                  <div className="visual-builder__media">
                    <div className="visual-builder__media-heading">
                      <div><strong>{selected.type === "gallery" ? "Фото питомцев и работ" : selected.type === "hero" ? "Фото питомцев на первом экране" : "Фотография раздела"}</strong><span>JPEG, PNG или WebP · до 10 МБ</span></div>
                      <label className="visual-builder__upload">{uploading ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <ImagePlus aria-hidden="true" />}{uploading ? "Загружаем…" : "Добавить"}<input type="file" accept="image/jpeg,image/png,image/webp" multiple={selected.type === "gallery" || selected.type === "hero"} disabled={uploading} onChange={(event) => { void uploadImages(event.target.files); event.target.value = ""; }} /></label>
                    </div>
                    {selected.type === "gallery" ? (
                      galleryItems(selected).length ? <ul className="visual-builder__gallery-list">{galleryItems(selected).map((item, index) => <li key={item.id}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={previewMediaUrl(item.src)} alt="" />
                        <Input aria-label={`Подпись к фотографии ${index + 1}`} placeholder="Например: Мия после экспресс-линьки" value={item.caption} onChange={(event) => updateGalleryItem(index, { caption: event.target.value })} />
                        <button type="button" aria-label={`Убрать фотографию ${index + 1}`} onClick={() => removeGalleryItem(index)}><X aria-hidden="true" /></button>
                      </li>)}</ul> : <p className="visual-builder__media-empty">Добавьте фотографии и подписи — они сразу появятся в макете.</p>
                    ) : selected.type === "hero" ? (
                      galleryItems(selected, "images").length ? <ul className="visual-builder__gallery-list">{galleryItems(selected, "images").map((item, index) => <li key={item.id}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={previewMediaUrl(item.src)} alt="" />
                        <Input aria-label={`Подпись к фото питомца ${index + 1}`} placeholder="Например: Боня после груминга" value={item.caption} onChange={(event) => updateHeroImage(index, { caption: event.target.value })} />
                        <button type="button" aria-label={`Убрать фото питомца ${index + 1}`} onClick={() => removeHeroImage(index)}><X aria-hidden="true" /></button>
                      </li>)}</ul> : typeof selected.config.image === "string" ? <div className="visual-builder__single-image">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={selected.config.image} alt="Предпросмотр загруженной фотографии" />
                        <button type="button" onClick={() => updateConfig("image", null)}><X aria-hidden="true" /> Убрать</button>
                      </div> : <p className="visual-builder__media-empty"><strong>Добавьте до трёх фото питомцев.</strong><br />Они соберутся в живой фотоколлаж на первом экране.</p>
                    ) : typeof selected.config.image === "string" ? <div className="visual-builder__single-image">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={selected.config.image} alt="Предпросмотр загруженной фотографии" />
                      <button type="button" onClick={() => updateConfig("image", null)}><X aria-hidden="true" /> Убрать</button>
                    </div> : <p className="visual-builder__media-empty">Добавьте фотографию — она адаптируется под телефон автоматически.</p>}
                  </div>
                )}
                {selected.type === "staff" && <div className="visual-builder__linked-content"><strong>Карточки мастеров синхронизируются с командой.</strong><p>Портрет, имя и специализация берутся из CRM.</p><Link href="/app/staff">Открыть команду <ExternalLink aria-hidden="true" /></Link></div>}
                {selected.type === "reviews" && <div className="visual-builder__linked-content"><strong>Показываются только опубликованные отзывы.</strong><p>Текст раздела выше можно изменить вручную.</p></div>}
              </div>
            </> : <div className="visual-builder__settings-empty"><Pencil aria-hidden="true" /><strong>Выберите раздел</strong><p>Нажмите на любой раздел в макете, чтобы изменить его текст и содержимое.</p></div>}
          </aside>
        </div>
      )}
    </section>
  );
}

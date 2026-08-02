from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from app.schemas import SiteBlockInput


@dataclass(frozen=True, slots=True)
class BlockDefinition:
    name: str
    basic: bool
    default_config: dict[str, Any]
    allowed_keys: frozenset[str]


BLOCK_CATALOG: dict[str, BlockDefinition] = {
    "hero": BlockDefinition(
        "Главный экран",
        True,
        {"title": "", "subtitle": "", "cta": "Записаться", "images": []},
        frozenset({"title", "subtitle", "cta", "image", "images", "alignment"}),
    ),
    "about": BlockDefinition(
        "О салоне",
        True,
        {"title": "О салоне", "text": ""},
        frozenset({"title", "text", "image"}),
    ),
    "services": BlockDefinition(
        "Услуги и цены",
        True,
        {
            "title": "Услуги и цены",
            "subtitle": "Выберите подходящий уход — стоимость и длительность всегда видны заранее.",
        },
        frozenset({"title", "subtitle", "category", "showDuration"}),
    ),
    "booking": BlockDefinition(
        "Онлайн-запись",
        True,
        {
            "title": "Записаться онлайн",
            "subtitle": "Выберите услугу, мастера и удобное время без звонка.",
            "cta": "Выбрать время",
        },
        frozenset({"title", "subtitle", "cta"}),
    ),
    "gallery": BlockDefinition(
        "До/после",
        False,
        {
            "title": "Наши работы",
            "subtitle": "Посмотрите стрижки, укладки, окрашивания и детали образов.",
            "columns": 3,
            "items": [],
        },
        frozenset({"title", "subtitle", "columns", "items"}),
    ),
    "staff": BlockDefinition(
        "Наши мастера",
        False,
        {
            "title": "Наши мастера",
            "subtitle": "Команда, с которой легко обсудить форму, цвет и домашний уход.",
        },
        frozenset({"title", "subtitle", "layout"}),
    ),
    "reviews": BlockDefinition(
        "Отзывы",
        False,
        {
            "title": "Отзывы клиентов",
            "subtitle": "Впечатления хозяев после визита в салон.",
            "limit": 6,
        },
        frozenset({"title", "subtitle", "limit"}),
    ),
    "promotions": BlockDefinition(
        "Акции",
        False,
        {"title": "Акции", "subtitle": "Специальные предложения салона.", "limit": 6},
        frozenset({"title", "subtitle", "limit"}),
    ),
    "loyalty": BlockDefinition(
        "Программа лояльности",
        False,
        {
            "title": "Программа лояльности",
            "text": "Возвращайтесь снова и получайте персональные предложения салона.",
            "cta": "Узнать подробнее",
        },
        frozenset({"title", "text", "cta"}),
    ),
    "hours": BlockDefinition(
        "Часы работы",
        False,
        {"title": "Часы работы", "subtitle": "Выберите удобный день для визита."},
        frozenset({"title", "subtitle"}),
    ),
    "contacts": BlockDefinition(
        "Контакты и карта",
        False,
        {
            "title": "Контакты",
            "subtitle": "Позвоните нам или постройте маршрут до салона.",
            "showMap": True,
        },
        frozenset({"title", "subtitle", "showMap", "mapZoom"}),
    ),
    "faq": BlockDefinition(
        "FAQ",
        False,
        {
            "title": "Частые вопросы",
            "subtitle": "Коротко ответили на то, что обычно спрашивают перед первой записью.",
            "items": [],
        },
        frozenset({"title", "subtitle", "items"}),
    ),
    "blog": BlockDefinition(
        "Блог/Новости",
        False,
        {
            "title": "Новости",
            "subtitle": "Полезные заметки и новости салона.",
            "items": [],
        },
        frozenset({"title", "subtitle", "items"}),
    ),
    "socials": BlockDefinition(
        "Социальные сети",
        False,
        {"title": "Мы в соцсетях", "subtitle": "Больше работ и новостей в наших соцсетях."},
        frozenset({"title", "subtitle"}),
    ),
    "cta": BlockDefinition(
        "Призыв к действию",
        False,
        {
            "title": "Запишитесь прямо сейчас",
            "text": "Подберём услугу, мастера и удобное время для визита.",
            "cta": "Записаться",
        },
        frozenset({"title", "text", "cta", "background"}),
    ),
}

_UNSAFE_VALUE = re.compile(r"(?:<\s*script|javascript\s*:|data\s*:\s*text/html)", re.I)
_PUBLIC_MEDIA_PATH = re.compile(
    r"^/api/v1/public/media/"
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-"
    r"[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
)
_MEDIA_KEYS = frozenset({"image", "src", "photoUrl", "before", "after"})
_APPEARANCE_KEYS = frozenset(
    {"backgroundColor", "textColor", "accentColor", "fontFamily", "titleSize", "textSize"}
)
_COLOR_VALUE = re.compile(r"^#[0-9a-fA-F]{6}$")
_FONT_VALUES = frozenset({"display", "clean", "hand"})


class BlockValidationError(ValueError):
    pass


def _assert_safe_json(value: Any, path: str = "config") -> None:
    if isinstance(value, str) and _UNSAFE_VALUE.search(value):
        raise BlockValidationError(f"Недопустимое значение в {path}")
    if isinstance(value, dict):
        for key, nested in value.items():
            if key in _MEDIA_KEYS and nested is not None:
                if not isinstance(nested, str) or not _PUBLIC_MEDIA_PATH.fullmatch(nested):
                    raise BlockValidationError(
                        f"Медиа в {path}.{key} должно быть загружено через TrimmyCRM"
                    )
            _assert_safe_json(nested, f"{path}.{key}")
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            _assert_safe_json(nested, f"{path}[{index}]")


def validate_blocks(
    blocks: list[SiteBlockInput], *, features: set[str], limits: dict[str, int | None]
) -> list[SiteBlockInput]:
    enabled = [block for block in blocks if block.enabled]
    max_blocks = limits.get("blocks")
    if max_blocks is not None and len(enabled) > max_blocks:
        raise BlockValidationError(f"Тариф разрешает не более {max_blocks} блоков")

    seen_types: set[str] = set()
    normalized: list[SiteBlockInput] = []
    for new_position, block in enumerate(sorted(blocks, key=lambda item: item.position)):
        definition = BLOCK_CATALOG.get(block.type)
        if definition is None:
            raise BlockValidationError(f"Неизвестный тип блока: {block.type}")
        if block.type in seen_types:
            raise BlockValidationError(f"Блок {block.type} можно добавить только один раз")
        if not definition.basic and "all_blocks" not in features:
            raise BlockValidationError(f"Блок {block.type} недоступен на текущем тарифе")
        unknown = set(block.config) - definition.allowed_keys - _APPEARANCE_KEYS
        if unknown:
            raise BlockValidationError(
                f"Неизвестные настройки блока {block.type}: {', '.join(sorted(unknown))}"
            )
        _assert_safe_json(block.config)
        for color_key in ("backgroundColor", "textColor", "accentColor"):
            color = block.config.get(color_key)
            if color is not None and (
                not isinstance(color, str) or not _COLOR_VALUE.fullmatch(color)
            ):
                raise BlockValidationError(f"{block.type}.{color_key} должен быть цветом #RRGGBB")
        font = block.config.get("fontFamily")
        if font is not None and font not in _FONT_VALUES:
            raise BlockValidationError(f"Некорректный шрифт блока {block.type}")
        for size_key, minimum, maximum in (("titleSize", 28, 160), ("textSize", 12, 32)):
            size = block.config.get(size_key)
            if size is not None and (
                isinstance(size, bool)
                or not isinstance(size, (int, float))
                or not minimum <= size <= maximum
            ):
                raise BlockValidationError(
                    f"{block.type}.{size_key} должен быть от {minimum} до {maximum}"
                )
        if block.type == "gallery":
            columns = block.config.get("columns", 3)
            if not isinstance(columns, int) or not 1 <= columns <= 6:
                raise BlockValidationError("gallery.columns должен быть от 1 до 6")
        if block.type in {"reviews", "promotions"}:
            limit = block.config.get("limit", 6)
            if not isinstance(limit, int) or not 1 <= limit <= 30:
                raise BlockValidationError(f"{block.type}.limit должен быть от 1 до 30")
        normalized.append(block.model_copy(update={"position": new_position}))
        seen_types.add(block.type)
    return normalized


def block_catalog_for(features: set[str], limits: dict[str, int | None]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for key, definition in BLOCK_CATALOG.items():
        allowed = definition.basic or "all_blocks" in features
        result.append(
            {
                "type": key,
                "name": definition.name,
                "allowed": allowed,
                "lockedReason": None if allowed else "Недоступно на текущем тарифе",
                "defaultConfig": definition.default_config,
                "maxEnabledBlocks": limits.get("blocks"),
            }
        )
    return result


def public_snapshot_for_access(
    snapshot: Mapping[str, Any],
    *,
    features: set[str],
    limits: dict[str, int | None],
) -> dict[str, Any]:
    """Запретить доступ, если опубликованный снимок пережил исходный тариф."""

    visible: list[dict[str, Any]] = []
    max_blocks = limits.get("blocks")
    raw_blocks = snapshot.get("blocks", [])
    if isinstance(raw_blocks, list):
        for raw in raw_blocks:
            if not isinstance(raw, dict) or raw.get("enabled") is not True:
                continue
            block_type = raw.get("type")
            definition = BLOCK_CATALOG.get(block_type) if isinstance(block_type, str) else None
            if definition is None or (not definition.basic and "all_blocks" not in features):
                continue
            if max_blocks is not None and len(visible) >= max_blocks:
                break
            visible.append(dict(raw))
    return {**dict(snapshot), "blocks": visible}

import pytest

from app.schemas import SiteBlockInput
from app.services.site_builder import (
    BlockValidationError,
    block_catalog_for,
    public_snapshot_for_access,
    validate_blocks,
)


def test_start_plan_rejects_premium_block() -> None:
    with pytest.raises(BlockValidationError):
        validate_blocks(
            [SiteBlockInput(type="gallery", position=0, config={})],
            features={"online_booking"},
            limits={"blocks": 4},
        )


def test_blocks_are_normalized_to_contiguous_positions() -> None:
    blocks = validate_blocks(
        [
            SiteBlockInput(type="booking", position=8, config={}),
            SiteBlockInput(type="hero", position=2, config={}),
        ],
        features=set(),
        limits={"blocks": 4},
    )
    assert [(item.type, item.position) for item in blocks] == [("hero", 0), ("booking", 1)]


def test_promotions_limit_is_bounded() -> None:
    with pytest.raises(BlockValidationError, match="promotions.limit"):
        validate_blocks(
            [SiteBlockInput(type="promotions", position=0, config={"limit": 31})],
            features={"all_blocks"},
            limits={"blocks": None},
        )


def test_public_snapshot_removes_blocks_after_tariff_downgrade() -> None:
    snapshot = {
        "id": "salon-id",
        "blocks": [
            {"id": "1", "type": "hero", "position": 0, "config": {}, "enabled": True},
            {
                "id": "2",
                "type": "reviews",
                "position": 1,
                "config": {},
                "enabled": True,
            },
            {"id": "3", "type": "about", "position": 2, "config": {}, "enabled": False},
        ],
    }

    filtered = public_snapshot_for_access(
        snapshot,
        features={"basic_blocks"},
        limits={"blocks": 4},
    )

    assert [block["type"] for block in filtered["blocks"]] == ["hero"]
    assert len(snapshot["blocks"]) == 3


def test_builder_rejects_external_rendered_image() -> None:
    with pytest.raises(BlockValidationError, match="загружено через TrimmyCRM"):
        validate_blocks(
            [
                SiteBlockInput(
                    type="hero",
                    position=0,
                    config={"image": "http://127.0.0.1/internal"},
                )
            ],
            features=set(),
            limits={"blocks": 4},
        )


def test_catalog_provides_editable_copy_for_content_sections() -> None:
    catalog = {item["type"]: item for item in block_catalog_for({"all_blocks"}, {"blocks": None})}

    assert catalog["services"]["defaultConfig"]["subtitle"]
    assert catalog["faq"]["defaultConfig"]["subtitle"]
    assert catalog["booking"]["defaultConfig"]["cta"] == "Выбрать время"

    blocks = validate_blocks(
        [
            SiteBlockInput(
                type="faq",
                position=0,
                config={
                    "title": "Перед визитом",
                    "subtitle": "Отвечаем заранее",
                    "items": [{"question": "Что взять?", "answer": "Только питомца."}],
                },
            )
        ],
        features={"all_blocks"},
        limits={"blocks": None},
    )

    assert blocks[0].config["items"][0]["answer"] == "Только питомца."


def test_builder_accepts_safe_appearance_and_rejects_invalid_values() -> None:
    [block] = validate_blocks(
        [
            SiteBlockInput(
                type="hero",
                position=0,
                config={
                    "backgroundColor": "#FFF4E8",
                    "textColor": "#151515",
                    "accentColor": "#FF4092",
                    "fontFamily": "clean",
                    "titleSize": 86,
                    "textSize": 18,
                },
            )
        ],
        features=set(),
        limits={"blocks": 4},
    )
    assert block.config["titleSize"] == 86

    with pytest.raises(BlockValidationError, match="backgroundColor"):
        validate_blocks(
            [SiteBlockInput(type="hero", position=0, config={"backgroundColor": "red"})],
            features=set(),
            limits={"blocks": 4},
        )

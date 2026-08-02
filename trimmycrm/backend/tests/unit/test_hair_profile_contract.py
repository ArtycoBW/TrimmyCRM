from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from app.schemas import ClientHairProfileUpdate


def test_hair_profile_validates_structured_characteristics() -> None:
    profile = ClientHairProfileUpdate.model_validate(
        {
            "hairLength": "very_long",
            "density": "high",
            "texture": "curly",
            "porosity": "unknown",
            "grayPercentage": 35,
            "currentColor": "уровень 7",
            "expectedVersion": 2,
        }
    )

    assert profile.hairLength == "very_long"
    assert profile.grayPercentage == 35

    with pytest.raises(ValidationError):
        ClientHairProfileUpdate.model_validate({"grayPercentage": 101})

    with pytest.raises(ValidationError):
        ClientHairProfileUpdate.model_validate({"texture": "undefined"})


def test_hair_profile_migration_forces_tenant_rls() -> None:
    migration = (
        Path(__file__).parents[2] / "alembic" / "versions" / "0009_client_hair_profiles.py"
    ).read_text(encoding="utf-8")

    assert "FORCE ROW LEVEL SECURITY" in migration
    assert "current_setting('app.current_tenant'" in migration
    assert '["tenant_id", "client_id"]' in migration
    assert "TO trimmycrm_app" in migration

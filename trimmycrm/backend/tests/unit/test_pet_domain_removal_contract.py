from __future__ import annotations

from pathlib import Path

from app.models import Base
from app.schemas import ClientView


def test_pet_domain_is_absent_from_runtime_contract() -> None:
    assert {"pets", "pet_photos", "pet_documents"}.isdisjoint(Base.metadata.tables)
    assert "pets" not in ClientView.model_fields

    backend_root = Path(__file__).parents[2]
    crm_routes = (backend_root / "app" / "api" / "routes" / "crm.py").read_text(encoding="utf-8")
    media_routes = (backend_root / "app" / "api" / "routes" / "media.py").read_text(
        encoding="utf-8"
    )
    assert '"/pets' not in crm_routes
    assert '"/pets' not in media_routes


def test_pet_domain_migration_drops_legacy_schema() -> None:
    migration = (
        Path(__file__).parents[2] / "alembic" / "versions" / "0013_remove_pet_domain.py"
    ).read_text(encoding="utf-8")

    assert 'op.drop_table("pet_documents")' in migration
    assert 'op.drop_table("pet_photos")' in migration
    assert 'op.drop_table("pets")' in migration
    assert "DROP TYPE IF EXISTS pet_species" in migration
    assert "uploaded_by_tenant_user_id = NULL" in migration

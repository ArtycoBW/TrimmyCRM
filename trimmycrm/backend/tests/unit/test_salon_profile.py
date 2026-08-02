from __future__ import annotations

from app.models import SalonType
from app.services.sites import TRIMMY_THEME, salon_profile_defaults


def test_each_salon_type_has_a_deterministic_preset() -> None:
    women = salon_profile_defaults(SalonType.women_hair_salon)
    barber = salon_profile_defaults(SalonType.barbershop)
    unisex = salon_profile_defaults(SalonType.unisex_hair_salon)

    assert women["template_key"] == "women-hair"
    assert {"color", "styling"}.issubset(women["service_focuses"])
    assert barber["template_key"] == "barbershop"
    assert {"beard", "shaving"}.issubset(barber["service_focuses"])
    assert unisex["template_key"] == "unisex-hair"
    assert {"color", "beard"}.issubset(unisex["service_focuses"])
    assert women["theme"] == TRIMMY_THEME


def test_preset_collections_are_not_shared_between_calls() -> None:
    first = salon_profile_defaults(SalonType.barbershop)
    first["service_focuses"].append("changed")
    first["theme"]["vermillion"] = "changed"

    second = salon_profile_defaults(SalonType.barbershop)

    assert "changed" not in second["service_focuses"]
    assert second["theme"]["vermillion"] == "#d15022"

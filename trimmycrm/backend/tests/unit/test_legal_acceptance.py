from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas import PlatformRegistration, Registration


def _registration_payload() -> dict[str, object]:
    return {
        "email": "owner@example.ru",
        "phone": "+79991234567",
        "password": "Strong-pass1!",
        "passwordConfirm": "Strong-pass1!",
        "termsAccepted": True,
        "consent": True,
    }


def test_client_registration_records_terms_and_personal_consent() -> None:
    payload = Registration.model_validate(_registration_payload())

    assert payload.termsAccepted is True
    assert payload.consent is True


def test_platform_registration_requires_separate_processing_instruction_acceptance() -> None:
    with pytest.raises(ValidationError):
        PlatformRegistration.model_validate(_registration_payload())

    payload = PlatformRegistration.model_validate(
        {
            **_registration_payload(),
            "dataProcessingInstructionAccepted": True,
            "salonName": "Форма",
            "salonType": "women_hair_salon",
            "city": "Москва",
            "timezone": "Europe/Moscow",
        }
    )

    assert payload.dataProcessingInstructionAccepted is True
    assert payload.salonType.value == "women_hair_salon"


def test_platform_registration_requires_salon_profile() -> None:
    base = {
        **_registration_payload(),
        "dataProcessingInstructionAccepted": True,
        "salonName": "Форма",
    }

    with pytest.raises(ValidationError):
        PlatformRegistration.model_validate(base)

    with pytest.raises(ValidationError):
        PlatformRegistration.model_validate({**base, "salonType": "pet_salon"})

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import platform_db
from app.models import ChatLead, LandingLead
from app.schemas import ChatLeadCreate, LandingLeadCreate, Message

router = APIRouter(prefix="/public", tags=["public leads"])


@router.post("/leads", response_model=Message, status_code=status.HTTP_201_CREATED)
async def create_landing_lead(
    payload: LandingLeadCreate,
    session: AsyncSession = Depends(platform_db, scope="function"),
) -> Message:
    session.add(
        LandingLead(
            kind=payload.kind,
            name=payload.name.strip(),
            phone=payload.phone,
            question=payload.question.strip() if payload.question else None,
            preferred_time=payload.preferredTime,
            consent_at=datetime.now(UTC),
        )
    )
    text = (
        "Заявка принята — скоро свяжемся с вами."
        if payload.kind == "callback"
        else "Спасибо! Ответим вам в ближайшее время."
    )
    return Message(message=text)


@router.post("/chat-leads", response_model=Message, status_code=status.HTTP_201_CREATED)
async def create_chat_lead(
    payload: ChatLeadCreate,
    session: AsyncSession = Depends(platform_db, scope="function"),
) -> Message:
    session.add(
        ChatLead(
            name=payload.name.strip(),
            phone=payload.phone,
            question=payload.question.strip() if payload.question else None,
            consent_at=datetime.now(UTC),
        )
    )
    return Message(message="Контакты сохранены. Мы скоро свяжемся с вами.")

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_platform_user, platform_db
from app.models import FeedbackMessage, PlatformUser
from app.schemas import FeedbackCreate, Message

router = APIRouter(prefix="/feedback", tags=["feedback"])


@router.post("", response_model=Message, status_code=status.HTTP_201_CREATED)
async def create_feedback(
    payload: FeedbackCreate,
    user: PlatformUser = Depends(current_platform_user),
    session: AsyncSession = Depends(platform_db, scope="function"),
) -> Message:
    user.phone = payload.phone
    session.add(FeedbackMessage(author_id=user.id, message=payload.message))
    return Message(message="Спасибо! Сообщение отправлено команде TrimmyCRM.")

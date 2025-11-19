"""Score routes."""
from fastapi import APIRouter
from app.models import Score

router = APIRouter(prefix="/api/score", tags=["score"])

# In-memory score (for MVP)
current_score = Score()


@router.get("")
async def get_score() -> Score:
    """Get current score."""
    return current_score


@router.post("/reset")
async def reset_score() -> Score:
    """Reset score."""
    global current_score
    current_score = Score()
    return current_score


"""Activity tracking routes."""
from fastapi import APIRouter, HTTPException
from app.models import ActivityRequest, ActivityEvent, GameStatus
from app.routes.game import game_state
from app.ws import broadcaster, create_event
from app.settings import settings
from datetime import datetime
import uuid

router = APIRouter(prefix="/api/activity", tags=["activity"])

# Store recent activities (last 50 per role)
_activity_history: dict[str, list[ActivityEvent]] = {
    "red": [],
    "blue": [],
    "gm": [],
    "audience": [],
}


@router.post("/track")
async def track_activity(request: ActivityRequest) -> dict:
    """Track a player activity."""
    if game_state.status != GameStatus.RUNNING and game_state.status != GameStatus.PAUSED:
        # Allow activity tracking even when game is not running (for presence)
        pass
    
    # Create activity event
    activity = ActivityEvent(
        id=str(uuid.uuid4()),
        player_name=request.player_name,
        role=request.role,
        activity_type=request.activity_type,
        description=request.description,
        timestamp=datetime.utcnow(),
        metadata=request.metadata or {},
    )
    
    # Add to history
    if request.role in _activity_history:
        _activity_history[request.role].append(activity)
        # Keep only last 50 activities
        _activity_history[request.role] = _activity_history[request.role][-50:]
    
    # Emit activity event to team room
    from app.models import EventKind
    activity_event = create_event(
        EventKind.ACTIVITY_EVENT,
        {
            "id": activity.id,
            "player_name": activity.player_name,
            "role": activity.role,
            "activity_type": activity.activity_type,
            "description": activity.description,
            "timestamp": activity.timestamp.isoformat(),
            "metadata": activity.metadata,
        },
    )
    
    # Emit to role-specific room
    await broadcaster.emit_to_role(request.role, activity_event)
    
    return {"success": True, "activity_id": activity.id}


@router.get("/recent")
async def get_recent_activities(role: str, limit: int = 20) -> dict:
    """Get recent activities for a role."""
    if role not in ["red", "blue", "gm", "audience"]:
        raise HTTPException(status_code=400, detail="Invalid role")
    
    activities = _activity_history.get(role, [])[-limit:]
    # Convert to JSON-serializable format
    return {
        "role": role,
        "activities": [
            {
                "id": act.id,
                "player_name": act.player_name,
                "role": act.role,
                "activity_type": act.activity_type,
                "description": act.description,
                "timestamp": act.timestamp.isoformat(),
                "metadata": act.metadata,
            }
            for act in activities
        ],
    }


def clear_activity_history():
    """Clear activity history (called on game reset)."""
    global _activity_history
    _activity_history = {
        "red": [],
        "blue": [],
        "gm": [],
        "audience": [],
    }


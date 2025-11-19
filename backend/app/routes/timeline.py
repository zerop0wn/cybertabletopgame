"""Timeline routes (only registered if FEATURE_WS_SNAPSHOT=True)."""
from fastapi import APIRouter, HTTPException, Query
from typing import List, Optional
from datetime import datetime
from app.models import Event
from app.settings import settings
from app.store import get_recent_events

router = APIRouter(prefix="/api/timeline", tags=["timeline"])


@router.get("")
async def get_timeline(
    since_ts: Optional[str] = Query(None, description="ISO timestamp to fetch events since"),
) -> dict:
    """
    Get timeline events since a timestamp (only available if FEATURE_WS_SNAPSHOT=True).
    
    Used for reconnection/resync when WebSocket snapshot feature is enabled.
    """
    if not settings.FEATURE_WS_SNAPSHOT:
        raise HTTPException(status_code=404, detail="Timeline endpoint requires FEATURE_WS_SNAPSHOT=true")
    
    recent_events = get_recent_events(100)
    
    # Filter by timestamp if provided
    if since_ts:
        try:
            since_dt = datetime.fromisoformat(since_ts.replace("Z", "+00:00"))
            filtered_events = [
                e for e in recent_events
                if e.ts >= since_dt
            ]
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid since_ts format (expected ISO 8601)")
    else:
        filtered_events = recent_events
    
    return {
        "events": [e.model_dump() for e in filtered_events],
        "count": len(filtered_events),
        "server_ts": datetime.utcnow().isoformat(),
    }


"""In-memory event store for MVP (optional, only used if FEATURE_WS_SNAPSHOT=True)."""
from typing import List
from app.models import Event

# In-memory event log (for snapshot/resync when FEATURE_WS_SNAPSHOT=True)
_event_log: List[Event] = []


def add_event(event: Event):
    """Add event to in-memory log (only used if snapshot feature is enabled)."""
    from app.settings import settings
    if settings.FEATURE_WS_SNAPSHOT:
        _event_log.append(event)
        # Keep only last 100 events
        if len(_event_log) > 100:
            _event_log.pop(0)


def get_recent_events(limit: int = 50) -> List[Event]:
    """Get recent events (only used if snapshot feature is enabled)."""
    from app.settings import settings
    if settings.FEATURE_WS_SNAPSHOT:
        return _event_log[-limit:]
    return []


def clear_events():
    """Clear event log (called on game reset)."""
    _event_log.clear()


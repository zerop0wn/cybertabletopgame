"""WebSocket event broadcasting."""
import socketio
from typing import Dict, Any, List, Optional
from datetime import datetime
import uuid
from app.models import Event, EventKind
from app.settings import settings


class GameEventBroadcaster:
    """Manages WebSocket rooms and event broadcasting."""
    
    def __init__(self):
        self.sio = socketio.AsyncServer(
            cors_allowed_origins="*",
            async_mode="asgi",
            logger=False,
            engineio_logger=False,
        )
        # Configure Socket.IO - socketio_path="/" because we mount at /socket.io in main.py
        self.app = socketio.ASGIApp(self.sio, socketio_path="/")
        self.rooms = {
            "gm": [],
            "red": [],
            "blue": [],
            "audience": [],
        }
        # Track session-scoped rooms: {session_id: {role: [sid, ...]}}
        self.session_rooms: Dict[str, Dict[str, List[str]]] = {}
    
    async def join_room(self, sid: str, role: str):
        """Join a role-specific room."""
        if role in self.rooms:
            await self.sio.enter_room(sid, role)
            if sid not in self.rooms[role]:
                self.rooms[role].append(sid)
    
    async def join_session_room(self, sid: str, session_id: str, role: str):
        """Join a session-scoped room and track it."""
        room_name = f"session:{session_id}:{role}"
        await self.sio.enter_room(sid, room_name)
        
        # Track session room membership
        if session_id not in self.session_rooms:
            self.session_rooms[session_id] = {}
        if role not in self.session_rooms[session_id]:
            self.session_rooms[session_id][role] = []
        if sid not in self.session_rooms[session_id][role]:
            self.session_rooms[session_id][role].append(sid)
        
        print(f"[WS] Client {sid} joined session room: {room_name} (total: {len(self.session_rooms[session_id][role])} clients)")
    
    async def leave_session_room(self, sid: str, session_id: str, role: str):
        """Leave a session-scoped room and untrack it."""
        room_name = f"session:{session_id}:{role}"
        await self.sio.leave_room(sid, room_name)
        
        # Untrack session room membership
        if session_id in self.session_rooms and role in self.session_rooms[session_id]:
            if sid in self.session_rooms[session_id][role]:
                self.session_rooms[session_id][role].remove(sid)
            # Clean up empty rooms
            if not self.session_rooms[session_id][role]:
                del self.session_rooms[session_id][role]
            if not self.session_rooms[session_id]:
                del self.session_rooms[session_id]
        
        print(f"[WS] Client {sid} left session room: {room_name}")
    
    async def leave_room(self, sid: str, role: str):
        """Leave a role-specific room."""
        if role in self.rooms and sid in self.rooms[role]:
            await self.sio.leave_room(sid, role)
            self.rooms[role].remove(sid)
    
    async def emit_to_role(self, role: str, event: Event):
        """Emit event to all clients in a role room."""
        payload = self._prepare_event_payload(event)
        await self.sio.emit("game_event", payload, room=role)
    
    async def emit_to_all(self, event: Event):
        """Emit event to all connected clients."""
        payload = self._prepare_event_payload(event)
        event_kind_str = event.kind.value if hasattr(event.kind, 'value') else str(event.kind)
        
        # Strategy: Use broadcast to reach all clients efficiently
        # Broadcast reaches all connected clients regardless of room membership
        # This is more efficient than emitting to multiple rooms which can cause duplicates
        await self.sio.emit("game_event", payload)
        # Only log important events to reduce console noise
        if event_kind_str in ['attack_launched', 'attack_resolved', 'round_started', 'round_ended']:
            print(f"[WS] Emitted {event_kind_str} event to all clients (broadcast)")
    
    def _prepare_event_payload(self, event: Event) -> Dict[str, Any]:
        """
        Prepare event payload with backward compatibility.
        
        Always emits legacy shape. If FEATURE_TIMELINE_SLA is True, adds optional v2 fields.
        Legacy clients ignore unknown keys.
        """
        event_dict = event.model_dump()
        
        # Always emit legacy shape for compatibility
        payload = {
            "type": "game_event",
            "event": {
                "id": event_dict["id"],
                "kind": event_dict["kind"].value if hasattr(event_dict["kind"], "value") else event_dict["kind"],
                "ts": event_dict["ts"].isoformat() if isinstance(event_dict["ts"], datetime) else event_dict["ts"],
                "payload": event_dict["payload"],
            }
        }
        
        # Add v2 fields only if feature flag is enabled
        if settings.FEATURE_TIMELINE_SLA or settings.FEATURE_WS_SNAPSHOT:
            payload["v"] = "2"
            
            # Add optional timing fields if present
            if event.server_ts:
                payload["event"]["server_ts"] = event.server_ts.isoformat()
            if event.client_ts:
                payload["event"]["client_ts"] = event.client_ts.isoformat()
            if event.correlation_id:
                payload["event"]["correlation_id"] = event.correlation_id
            if event.caused_by:
                payload["event"]["caused_by"] = event.caused_by
            if event.deadline_at:
                payload["event"]["deadline_at"] = event.deadline_at.isoformat()
            if event.latency_ms is not None:
                payload["event"]["latency_ms"] = event.latency_ms
        
        return payload
    
    async def emit_snapshot_state(self, sid: str, game_state: Dict[str, Any], recent_events: List[Event]):
        """
        Emit snapshot state for reconnection (only if FEATURE_WS_SNAPSHOT=True).
        
        Provides minimal game state + last N events for fast resync.
        """
        if not settings.FEATURE_WS_SNAPSHOT:
            return  # Skip if feature disabled
        
        snapshot = {
            "type": "snapshot_state",
            "game_state": game_state,
            "events": [self._prepare_event_payload(e)["event"] for e in recent_events[-50:]],  # Last 50 events
            "server_ts": datetime.utcnow().isoformat(),
        }
        await self.sio.emit("snapshot_state", snapshot, room=sid)
    
    async def emit_to_roles(self, roles: List[str], event: Event):
        """Emit event to multiple role rooms."""
        for role in roles:
            await self.emit_to_role(role, event)


# Global broadcaster instance
broadcaster = GameEventBroadcaster()


def create_event(
    kind: EventKind,
    payload: Dict[str, Any],
    event_id: Optional[str] = None,
    server_ts: Optional[datetime] = None,
    correlation_id: Optional[str] = None,
    caused_by: Optional[str] = None,
    deadline_at: Optional[datetime] = None,
) -> Event:
    """
    Helper to create typed events with optional v2 timing fields.
    
    If FEATURE_TIMELINE_SLA is False, timing fields are ignored.
    """
    now = server_ts or datetime.utcnow()
    
    # Only set v2 fields if feature flag is enabled
    kwargs = {
        "id": event_id or str(uuid.uuid4()),
        "kind": kind,
        "ts": now,
        "payload": payload,
    }
    
    if settings.FEATURE_TIMELINE_SLA:
        kwargs["server_ts"] = now
        if correlation_id:
            kwargs["correlation_id"] = correlation_id
        if caused_by:
            kwargs["caused_by"] = caused_by
        if deadline_at:
            kwargs["deadline_at"] = deadline_at
    
    return Event(**kwargs)


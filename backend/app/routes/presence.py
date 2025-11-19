"""Player presence tracking routes."""
from fastapi import APIRouter, HTTPException
from app.models import PlayerPresence, PresenceStatus
from datetime import datetime, timedelta
from typing import Dict

router = APIRouter(prefix="/api/presence", tags=["presence"])

# Track player presence: {role: {player_name: PlayerPresence}}
_presence_data: Dict[str, Dict[str, PlayerPresence]] = {
    "red": {},
    "blue": {},
    "gm": {},
    "audience": {},
}

# Timeout for considering a player offline (30 seconds of inactivity)
PRESENCE_TIMEOUT_SECONDS = 30


@router.post("/update")
async def update_presence(
    player_name: str,
    role: str,
    current_activity: str = None,
) -> dict:
    """Update player presence."""
    if role not in ["red", "blue", "gm", "audience"]:
        raise HTTPException(status_code=400, detail="Invalid role")
    
    # Update or create presence
    if role not in _presence_data:
        _presence_data[role] = {}
    
    _presence_data[role][player_name] = PlayerPresence(
        player_name=player_name,
        role=role,
        is_online=True,
        last_seen=datetime.utcnow(),
        current_activity=current_activity,
    )
    
    # Emit presence update to team
    presence_event = create_event(
        EventKind.PRESENCE_UPDATE,
        {
            "role": role,
            "player_name": player_name,
            "is_online": True,
            "last_seen": datetime.utcnow().isoformat(),
            "current_activity": current_activity,
        },
    )
    await broadcaster.emit_to_role(role, presence_event)
    
    return {"success": True}


@router.get("/status")
async def get_presence_status(role: str) -> PresenceStatus:
    """Get presence status for a role."""
    if role not in ["red", "blue", "gm", "audience"]:
        raise HTTPException(status_code=400, detail="Invalid role")
    
    now = datetime.utcnow()
    players = []
    
    if role in _presence_data:
        for player_name, presence in _presence_data[role].items():
            # Check if player is still online (within timeout)
            time_since_seen = (now - presence.last_seen).total_seconds()
            is_online = time_since_seen < PRESENCE_TIMEOUT_SECONDS
            
            players.append(PlayerPresence(
                player_name=presence.player_name,
                role=presence.role,
                is_online=is_online,
                last_seen=presence.last_seen,
                current_activity=presence.current_activity if is_online else None,
            ))
    
    return PresenceStatus(
        role=role,
        players=players,
    )


@router.post("/heartbeat")
async def heartbeat(player_name: str, role: str) -> dict:
    """Send a heartbeat to keep presence active."""
    try:
        await update_presence(player_name, role, current_activity="active")
        return {"success": True}
    except Exception as e:
        # Log error but don't fail - heartbeat is best effort
        print(f"[Presence] Heartbeat error for {player_name} ({role}): {e}")
        return {"success": False, "error": str(e)}


def clear_presence():
    """Clear presence data (called on game reset)."""
    global _presence_data
    _presence_data = {
        "red": {},
        "blue": {},
        "gm": {},
        "audience": {},
    }


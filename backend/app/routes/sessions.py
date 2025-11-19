"""Session management routes (only used if FEATURE_JOIN_CODES is True)."""
from fastapi import APIRouter, HTTPException, Depends, status, Request
from typing import Optional
from datetime import datetime, timedelta
import secrets
import string
import time
from app.models import (
    GameSession,
    SessionCreateResponse,
    JoinRequest,
    JoinResponse,
    AuthToken,
)
from app.settings import settings
from app.services.auth import create_access_token
from app.routes.auth import require_role, get_current_user, get_client_ip

router = APIRouter(prefix="/api/sessions", tags=["sessions"])

# In-memory session store (for MVP)
_sessions: dict[str, GameSession] = {}
_code_to_session: dict[str, tuple[str, str]] = {}  # code -> (session_id, role)
# Lock for session creation to prevent race conditions
import asyncio
_session_lock = asyncio.Lock()


async def cleanup_expired_sessions():
    """Clean up expired sessions and their WebSocket rooms."""
    if not settings.FEATURE_JOIN_CODES:
        return
    
    now = datetime.utcnow()
    expired_sessions = [
        session_id for session_id, session in _sessions.items()
        if session.expires_at and session.expires_at < now
    ]
    
    for session_id in expired_sessions:
        session = _sessions[session_id]
        # Remove codes from mapping
        if session.red_code in _code_to_session:
            del _code_to_session[session.red_code]
        if session.blue_code in _code_to_session:
            del _code_to_session[session.blue_code]
        if session.audience_code in _code_to_session:
            del _code_to_session[session.audience_code]
        # Remove session
        del _sessions[session_id]
        print(f"[SESSIONS] Removed expired session {session_id}")
        
        # Clean up WebSocket session rooms for expired session
        try:
            from app.ws import broadcaster
            if session_id in broadcaster.session_rooms:
                # Leave all Socket.IO rooms for this session
                for role, sids in list(broadcaster.session_rooms[session_id].items()):
                    for sid in sids:
                        room_name = f"session:{session_id}:{role}"
                        await broadcaster.sio.leave_room(sid, room_name)
                # Remove from tracking
                del broadcaster.session_rooms[session_id]
                print(f"[SESSIONS] Cleaned up WebSocket rooms for expired session {session_id}")
        except Exception as e:
            print(f"[SESSIONS] Error cleaning up WebSocket rooms for expired session {session_id}: {e}")


def update_session_state_by_game_status(game_status: str, gm_user_id: Optional[str] = None):
    """
    Update session states based on game status.
    
    This is called from game routes to keep session state in sync with game state.
    - When game is RUNNING: mark all "lobby"/"paused" sessions as "running"
    - When game is PAUSED: mark all "running" sessions as "paused"
    - When game is FINISHED: mark all "running"/"paused" sessions as "ended"
    - When game is reset (LOBBY): mark all "running"/"paused"/"ended" sessions as "lobby" (for reuse)
    
    Args:
        game_status: The new game status
        gm_user_id: Optional GM user ID to filter sessions (only update sessions created by this GM)
                    If None, updates all sessions (legacy behavior for backward compatibility)
    """
    if not settings.FEATURE_JOIN_CODES:
        return
    
    # Clean up expired sessions first (synchronous cleanup for expired sessions)
    # Note: WebSocket room cleanup is async and will be handled separately
    now = datetime.utcnow()
    expired_sessions = [
        session_id for session_id, session in _sessions.items()
        if session.expires_at and session.expires_at < now
    ]
    for session_id in expired_sessions:
        session = _sessions[session_id]
        # Remove codes from mapping
        if session.red_code in _code_to_session:
            del _code_to_session[session.red_code]
        if session.blue_code in _code_to_session:
            del _code_to_session[session.blue_code]
        if session.audience_code in _code_to_session:
            del _code_to_session[session.audience_code]
        # Remove session
        del _sessions[session_id]
        print(f"[SESSIONS] Removed expired session {session_id}")
    
    # Filter sessions by GM if provided
    sessions_to_update = list(_sessions.values())  # Convert to list to avoid modification during iteration
    if gm_user_id:
        sessions_to_update = [s for s in sessions_to_update if s.created_by == gm_user_id]
    
    if game_status == "running":
        # Mark all "lobby"/"paused" sessions as "running"
        for session in sessions_to_update:
            if session.id in _sessions and session.state in ["lobby", "paused"]:
                old_state = session.state
                session.state = "running"
                print(f"[SESSIONS] Updated session {session.id} state: {old_state} -> running")
    elif game_status == "paused":
        # Mark all "running" sessions as "paused"
        for session in sessions_to_update:
            if session.id in _sessions and session.state == "running":
                old_state = session.state
                session.state = "paused"
                print(f"[SESSIONS] Updated session {session.id} state: running -> paused")
    elif game_status == "finished":
        # Mark all "running"/"paused" sessions as "ended"
        for session in sessions_to_update:
            if session.id in _sessions and session.state in ["running", "paused"]:
                old_state = session.state
                session.state = "ended"
                print(f"[SESSIONS] Updated session {session.id} state: {old_state} -> ended")
    elif game_status == "lobby":
        # Mark all "running"/"paused"/"ended" sessions as "lobby" for reuse
        for session in sessions_to_update:
            if session.id in _sessions and session.state in ["running", "paused", "ended"]:
                old_state = session.state
                session.state = "lobby"
                print(f"[SESSIONS] Updated session {session.id} state: {old_state} -> lobby")

# Simple rate limiting (in-memory, per IP)
_rate_limit_store: dict[str, list[float]] = {}
RATE_LIMIT_WINDOW = 60  # 1 minute
RATE_LIMIT_MAX_REQUESTS = 10  # Increased from 5 to 10 for better multi-device support


def check_rate_limit(ip: str) -> bool:
    """Check if IP is within rate limit."""
    now = time.time()
    if ip not in _rate_limit_store:
        _rate_limit_store[ip] = []
    
    # Remove old requests outside window
    _rate_limit_store[ip] = [
        req_time for req_time in _rate_limit_store[ip]
        if now - req_time < RATE_LIMIT_WINDOW
    ]
    
    # Check if limit exceeded
    if len(_rate_limit_store[ip]) >= RATE_LIMIT_MAX_REQUESTS:
        return False
    
    # Add current request
    _rate_limit_store[ip].append(now)
    return True


def generate_join_code(prefix: str = "") -> str:
    """Generate a random 6-8 character join code."""
    # Use alphanumeric characters, excluding confusing ones (0, O, I, l)
    chars = string.ascii_uppercase + string.digits
    chars = chars.replace("0", "").replace("O", "").replace("I", "").replace("1", "")
    
    code = prefix + "".join(secrets.choice(chars) for _ in range(6))
    return code


@router.get("/active")
async def get_active_session(
    user: AuthToken = Depends(require_role("GM"))
):
    """
    Get the most recent active session (lobby, running, or paused) for the GM.
    
    Returns the most recent session that is not ended, or None if no active session exists.
    Only available if FEATURE_JOIN_CODES is True.
    """
    if not settings.FEATURE_JOIN_CODES:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Join codes are not enabled"
        )
    
    # Find the most recent active session (not ended) for this GM
    active_sessions = [
        session for session in _sessions.values()
        if session.created_by == user.sub 
        and session.state in ["lobby", "running", "paused"]
        and (not session.expires_at or session.expires_at > datetime.utcnow())
    ]
    
    if not active_sessions:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active session found"
        )
    
    # Return the most recent session (by created_at)
    most_recent = max(active_sessions, key=lambda s: s.created_at)
    
    return SessionCreateResponse(
        id=most_recent.id,
        red_code=most_recent.red_code,
        blue_code=most_recent.blue_code,
        audience_code=most_recent.audience_code,
        state=most_recent.state
    )


@router.post("", response_model=SessionCreateResponse)
async def create_session(
    user: AuthToken = Depends(require_role("GM")),
    http_request: Request = None
):
    """
    Create a new game session with join codes (GM only).
    
    If an active session already exists, returns that session instead of creating a new one.
    Only available if FEATURE_JOIN_CODES is True.
    """
    if not settings.FEATURE_JOIN_CODES:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Join codes are not enabled"
        )
    
    # Use lock to prevent race conditions when checking/creating sessions
    async with _session_lock:
        # Clean up expired sessions first (before checking for active ones)
        now = datetime.utcnow()
        expired_sessions = [
            session_id for session_id, session in _sessions.items()
            if session.expires_at and session.expires_at < now
        ]
        for session_id in expired_sessions:
            session = _sessions[session_id]
            # Remove codes from mapping
            if session.red_code in _code_to_session:
                del _code_to_session[session.red_code]
            if session.blue_code in _code_to_session:
                del _code_to_session[session.blue_code]
            if session.audience_code in _code_to_session:
                del _code_to_session[session.audience_code]
            # Remove session
            del _sessions[session_id]
            print(f"[SESSIONS] Removed expired session {session_id}")
            
            # Clean up WebSocket session rooms for expired session
            try:
                from app.ws import broadcaster
                if session_id in broadcaster.session_rooms:
                    # Leave all Socket.IO rooms for this session
                    for role, sids in list(broadcaster.session_rooms[session_id].items()):
                        for sid in sids:
                            room_name = f"session:{session_id}:{role}"
                            await broadcaster.sio.leave_room(sid, room_name)
                    # Remove from tracking
                    del broadcaster.session_rooms[session_id]
                    print(f"[SESSIONS] Cleaned up WebSocket rooms for expired session {session_id}")
            except Exception as e:
                print(f"[SESSIONS] Error cleaning up WebSocket rooms for expired session {session_id}: {e}")
        
        # Check if there's already an active session for this GM
        active_sessions = [
            session for session in _sessions.values()
            if session.created_by == user.sub 
            and session.state in ["lobby", "running", "paused"]
            and (not session.expires_at or session.expires_at > datetime.utcnow())
        ]
        
        if active_sessions:
            # Return the most recent active session instead of creating a new one
            most_recent = max(active_sessions, key=lambda s: s.created_at)
            print(f"[SESSIONS] Reusing existing active session {most_recent.id} (state: {most_recent.state})")
            return SessionCreateResponse(
                id=most_recent.id,
                red_code=most_recent.red_code,
                blue_code=most_recent.blue_code,
                audience_code=most_recent.audience_code,
                state=most_recent.state
            )
        
        # No active session found, create a new one
        print(f"[SESSIONS] Creating new session for GM {user.sub}")
        
        # Generate unique codes
        red_code = generate_join_code("R")
        blue_code = generate_join_code("B")
        audience_code = generate_join_code("A")
        
        # Ensure codes are unique
        while red_code in _code_to_session:
            red_code = generate_join_code("R")
        while blue_code in _code_to_session:
            blue_code = generate_join_code("B")
        while audience_code in _code_to_session:
            audience_code = generate_join_code("A")
        
        # Create session
        session_id = f"sess_{secrets.token_urlsafe(8)}"
        session = GameSession(
            id=session_id,
            state="lobby",
            red_code=red_code,
            blue_code=blue_code,
            audience_code=audience_code,
            created_at=datetime.utcnow(),
            created_by=user.sub,
            expires_at=datetime.utcnow() + timedelta(hours=24)  # 24 hour expiry
        )
        
        # Store session
        _sessions[session_id] = session
        _code_to_session[red_code] = (session_id, "RED")
        _code_to_session[blue_code] = (session_id, "BLUE")
        _code_to_session[audience_code] = (session_id, "AUDIENCE")
        
        print(f"[SESSIONS] Created new session {session_id} for GM {user.sub}")
        
        return SessionCreateResponse(
            id=session_id,
            red_code=red_code,
            blue_code=blue_code,
            audience_code=audience_code,
            state=session.state
        )


@router.post("/rotate-codes", response_model=SessionCreateResponse)
async def rotate_codes(
    session_id: str,
    user: AuthToken = Depends(require_role("GM"))
):
    """
    Rotate join codes for a session (GM only).
    
    Only available if FEATURE_JOIN_CODES is True.
    """
    if not settings.FEATURE_JOIN_CODES:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Join codes are not enabled"
        )
    
    if session_id not in _sessions:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )
    
    session = _sessions[session_id]
    
    # Remove old codes
    if session.red_code in _code_to_session:
        del _code_to_session[session.red_code]
    if session.blue_code in _code_to_session:
        del _code_to_session[session.blue_code]
    if session.audience_code in _code_to_session:
        del _code_to_session[session.audience_code]
    
    # Generate new codes
    red_code = generate_join_code("R")
    blue_code = generate_join_code("B")
    audience_code = generate_join_code("A")
    
    # Ensure codes are unique
    while red_code in _code_to_session:
        red_code = generate_join_code("R")
    while blue_code in _code_to_session:
        blue_code = generate_join_code("B")
    while audience_code in _code_to_session:
        audience_code = generate_join_code("A")
    
    # Update session
    session.red_code = red_code
    session.blue_code = blue_code
    session.audience_code = audience_code
    
    # Store new codes
    _code_to_session[red_code] = (session_id, "RED")
    _code_to_session[blue_code] = (session_id, "BLUE")
    _code_to_session[audience_code] = (session_id, "AUDIENCE")
    
    return SessionCreateResponse(
        id=session_id,
        red_code=red_code,
        blue_code=blue_code,
        audience_code=audience_code,
        state=session.state
    )


@router.post("/join", response_model=JoinResponse)
async def join_by_code(
    request: JoinRequest,
    http_request: Request
):
    """
    Join a game session by access code.
    
    Returns JWT token with role and session_id claims.
    Only available if FEATURE_JOIN_CODES is True.
    """
    if not settings.FEATURE_JOIN_CODES:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Join codes are not enabled"
        )
    
    # Get client IP
    client_ip = get_client_ip(http_request)
    
    # Rate limiting
    if not check_rate_limit(client_ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many join attempts. Please try again later."
        )
    
    # Normalize code to uppercase for lookup (codes are stored in uppercase)
    normalized_code = request.code.upper().strip()
    
    print(f"[SESSIONS] Join attempt: code='{request.code}' (normalized: '{normalized_code}') from IP {client_ip}")
    print(f"[SESSIONS] Available codes: {list(_code_to_session.keys())[:5]}... ({len(_code_to_session)} total)")
    
    # Look up code (case-insensitive)
    if normalized_code not in _code_to_session:
        print(f"[SESSIONS] Code '{normalized_code}' not found in {len(_code_to_session)} available codes")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Invalid join code: {request.code}. Please check the code and try again."
        )
    
    session_id, role = _code_to_session[normalized_code]
    print(f"[SESSIONS] Code '{normalized_code}' matched to session {session_id}, role {role}")
    
    # Verify session exists
    if session_id not in _sessions:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )
    
    session = _sessions[session_id]
    
    # Check if session expired
    if session.expires_at and session.expires_at < datetime.utcnow():
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Session has expired"
        )
    
    # Create token
    expires_delta = timedelta(minutes=settings.JWT_EXPIRES_MIN)
    token_data = {
        "sub": f"{role.lower()}_player",  # Generic subject for players
        "role": role,
        "session_id": session_id,
    }
    access_token = create_access_token(token_data, expires_delta)
    exp_timestamp = int((time.time() + expires_delta.total_seconds()))
    
    return JoinResponse(
        access_token=access_token,
        token_type="bearer",
        role=role,
        session_id=session_id,
        exp=exp_timestamp
    )


@router.get("/{session_id}")
async def get_session(
    session_id: str,
    user: AuthToken = Depends(get_current_user)
):
    """
    Get session details (GM or session member only).
    
    Only available if FEATURE_JOIN_CODES is True.
    """
    if not settings.FEATURE_JOIN_CODES:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Join codes are not enabled"
        )
    
    if session_id not in _sessions:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )
    
    # Check access: GM can access any session, players can only access their own
    if user.role != "GM" and user.session_id != session_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )
    
    return _sessions[session_id]


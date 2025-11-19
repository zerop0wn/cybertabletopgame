"""FastAPI main application."""
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.applications import Starlette
from starlette.routing import Mount
from app.routes import game, scenarios, attacks, actions, score, voting, chat, activity, presence, players
from app.ws import broadcaster
from app.database import init_db
from app.settings import settings
from app.services.timer import start_timer
import os
import asyncio

# Initialize database
os.makedirs("data", exist_ok=True)
init_db()

# Create FastAPI app
fastapi_app = FastAPI(
    title="PewPew Tabletop API",
    description="Cyber defense tabletop game backend",
    version="1.0.0",
)

# CORS middleware
fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
fastapi_app.include_router(game.router)
fastapi_app.include_router(scenarios.router)
fastapi_app.include_router(attacks.router)
fastapi_app.include_router(actions.router)
fastapi_app.include_router(score.router)
from app.routes import scans
fastapi_app.include_router(scans.router)
fastapi_app.include_router(voting.router)
fastapi_app.include_router(chat.router)
fastapi_app.include_router(activity.router)
fastapi_app.include_router(presence.router)
fastapi_app.include_router(players.router)

# Include auth and sessions routers only if features are enabled
if settings.FEATURE_AUTH_GM or settings.FEATURE_JOIN_CODES:
    from app.routes import auth, sessions
    fastapi_app.include_router(auth.router)
    fastapi_app.include_router(sessions.router)

# Include scenario_v2 router only if advanced scenarios feature is enabled
if settings.FEATURE_ADV_SCENARIOS:
    try:
        from app.routes import scenario_v2
        fastapi_app.include_router(scenario_v2.router)
    except ImportError as e:
        print(f"[main] Warning: Could not import scenario_v2 router: {e}")
        print("[main] Advanced scenarios feature is disabled due to import error")

# Include timeline router only if snapshot feature is enabled
if settings.FEATURE_WS_SNAPSHOT:
    from app.routes import timeline
    fastapi_app.include_router(timeline.router)

# Integrate Socket.IO with FastAPI
# Mount Socket.IO ASGI app directly - it handles its own routing
app = Starlette(
    routes=[
        Mount("/socket.io", app=broadcaster.app),
        Mount("/", app=fastapi_app),
    ]
)


@fastapi_app.get("/")
async def root():
    """Root endpoint."""
    return {"message": "PewPew Tabletop API", "docs": "/docs"}


@fastapi_app.get("/health")
async def health():
    """Health check."""
    return {"status": "ok"}


@fastapi_app.post("/api/seed")
async def seed():
    """Seed database (dev only)."""
    from app.services.seed import create_default_scenarios
    from app.routes.scenarios import scenarios_cache
    from app.routes.game import scenarios as game_scenarios
    
    global scenarios_cache, game_scenarios
    
    scenarios_data = create_default_scenarios()
    scenarios_cache.update(scenarios_data)
    game_scenarios.update(scenarios_data)
    
    return {"status": "seeded", "count": len(scenarios_data)}


# WebSocket connection handlers
@broadcaster.sio.on("connect")
async def connect(sid, environ):
    """Handle WebSocket connection."""
    print(f"Client connected: {sid}")


@broadcaster.sio.on("disconnect")
async def disconnect(sid):
    """Handle WebSocket disconnection."""
    print(f"Client disconnected: {sid}")
    # Clean up role rooms
    for role in list(broadcaster.rooms.keys()):
        if sid in broadcaster.rooms[role]:
            broadcaster.rooms[role].remove(sid)
            # Also leave the Socket.IO room
            await broadcaster.sio.leave_room(sid, role)
    
    # Clean up session-scoped rooms
    if settings.FEATURE_JOIN_CODES and broadcaster.session_rooms:
        for session_id, roles in list(broadcaster.session_rooms.items()):
            for role, sids in list(roles.items()):
                if sid in sids:
                    # Leave the Socket.IO room
                    room_name = f"session:{session_id}:{role}"
                    try:
                        await broadcaster.sio.leave_room(sid, room_name)
                    except Exception as e:
                        print(f"[WS] Error leaving room {room_name} for {sid}: {e}")
                    # Remove from tracking
                    sids.remove(sid)
                    # Clean up empty rooms
                    if not sids:
                        del broadcaster.session_rooms[session_id][role]
                    if not broadcaster.session_rooms[session_id]:
                        del broadcaster.session_rooms[session_id]
                    print(f"[WS] Cleaned up session room for disconnected client {sid}: session={session_id}, role={role}")


@broadcaster.sio.on("join")
async def join(sid, data):
    """Handle client joining a role room."""
    from app.routes.game import game_state as game_state_module
    from app.services.auth import decode_access_token
    
    # If auth/join codes are enabled, try to use JWT token, but fallback to legacy if not provided
    if settings.FEATURE_AUTH_GM or settings.FEATURE_JOIN_CODES:
        token = data.get("token")
        if token:
            # Decode and verify token
            payload = decode_access_token(token)
            if payload:
                # Use role from token
                role = payload.get("role", "audience").lower()
                session_id = payload.get("session_id")
                
                # If join codes enabled and session_id is provided, validate and join session-scoped room
                if settings.FEATURE_JOIN_CODES and session_id:
                    # Validate session exists and is not expired
                    from app.routes.sessions import _sessions
                    from datetime import datetime
                    
                    # Clean up expired sessions before checking
                    now = datetime.utcnow()
                    expired_sessions = [
                        sid for sid, sess in _sessions.items()
                        if sess.expires_at and sess.expires_at < now
                    ]
                    if expired_sessions:
                        print(f"[WS] Found {len(expired_sessions)} expired sessions during join")
                    
                    if session_id in _sessions:
                        session = _sessions[session_id]
                        if session.expires_at and session.expires_at < now:
                            print(f"[WS] Session {session_id} expired for client {sid}")
                            # Don't join session room if expired, but allow role room join
                            session_id = None
                        else:
                            # Join both role room and session-scoped room
                            try:
                                await broadcaster.join_session_room(sid, session_id, role)
                            except Exception as e:
                                print(f"[WS] Error joining session room for {sid}: {e}")
                                session_id = None
                    else:
                        print(f"[WS] Session {session_id} not found for client {sid} (available sessions: {list(_sessions.keys())[:5]})")
                        # Session not found - don't join session room, but allow role room join
                        session_id = None
            else:
                # Invalid token - fallback to legacy behavior
                print(f"[WS] Invalid token for {sid}, falling back to legacy behavior")
                role = data.get("role", "audience")
                session_id = None
        else:
            # No token provided - allow legacy behavior for backward compatibility
            # This allows pages to connect before auth is complete
            print(f"[WS] No token provided for {sid}, using legacy behavior")
            role = data.get("role", "audience")
            session_id = None
    else:
        # Legacy behavior: use role from data
        role = data.get("role", "audience")
        session_id = None
    
    print(f"Client {sid} joining room: {role}" + (f" (session: {session_id})" if session_id else ""))
    await broadcaster.join_room(sid, role)
    await broadcaster.sio.emit("joined", {"status": "joined", "role": role}, room=sid)
    
    # Emit snapshot state if feature flag is enabled (for fast reconnection)
    if settings.FEATURE_WS_SNAPSHOT:
        from app.store import get_recent_events
        
        # Get recent events (in-memory for MVP, last 50)
        recent_events = get_recent_events(50)
        
        # Prepare minimal game state
        game_state_dict = {
            "status": game_state_module.game_state.status.value if hasattr(game_state_module.game_state.status, "value") else str(game_state_module.game_state.status),
            "round": game_state_module.game_state.round,
            "current_scenario_id": game_state_module.game_state.current_scenario_id,
            "mode": game_state_module.game_state.mode,
            "audience_enabled": game_state_module.game_state.audience_enabled,
            "timer": game_state_module.game_state.timer,
            "current_turn": game_state_module.game_state.current_turn,
        }
        
        await broadcaster.emit_snapshot_state(sid, game_state_dict, recent_events)
    
    return {"status": "joined", "role": role}


# Startup event: Start timer background task
@fastapi_app.on_event("startup")
async def startup_event():
    """Start background tasks on application startup."""
    print("[APP] Starting background tasks...")
    try:
        # Get the event loop and create the task
        loop = asyncio.get_event_loop()
        from app.services.timer import timer_loop
        task = loop.create_task(timer_loop())
        print("[APP] Background tasks started")
    except Exception as e:
        print(f"[APP] Error starting background tasks: {e}")


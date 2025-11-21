"""Game management routes."""
from fastapi import APIRouter, HTTPException
from app.models import (
    GameState,
    GameStatus,
    GameStartRequest,
    Event,
    EventKind,
)
from app.services.seed import load_scenarios_from_yaml, create_default_scenarios
from app.routes.scenarios import scenarios_cache
from app.ws import broadcaster, create_event
from app.settings import settings
from app.services.timer import start_timer, stop_timer
from datetime import datetime
import uuid

router = APIRouter(prefix="/api/game", tags=["game"])

# In-memory game state (for MVP)
game_state = GameState()


@router.get("/state")
async def get_game_state() -> GameState:
    """Get current game state."""
    # Update timer if game is running and start_time is set
    if game_state.status == GameStatus.RUNNING and game_state.start_time:
        from datetime import datetime
        from app.services.timer import SCENARIO_DURATION_LIMIT
        
        now = datetime.utcnow()
        elapsed = int((now - game_state.start_time).total_seconds())
        # Ensure non-negative and cap at limit (handle timezone issues)
        if elapsed < 0:
            # If start_time is in the future, reset timer to 0
            print(f"[GAME] Warning: start_time is in the future, resetting timer")
            game_state.timer = 0
        else:
            game_state.timer = min(max(0, elapsed), SCENARIO_DURATION_LIMIT)
    
    return game_state


@router.post("/start")
async def start_game(request: GameStartRequest) -> GameState:
    """Start a new game round with a scenario."""
    global game_state
    
    print(f"[GAME] Start request: scenario_id={request.scenario_id}")
    print(f"[GAME] Current game state before start: status={game_state.status}, round={game_state.round}, scenario={game_state.current_scenario_id}")
    print(f"[GAME] Available scenarios: {list(scenarios_cache.keys())}")
    
    # Validate scenario exists
    if request.scenario_id not in scenarios_cache:
        print(f"[GAME] ERROR: Scenario not found: {request.scenario_id}")
        raise HTTPException(status_code=404, detail=f"Scenario not found: {request.scenario_id}. Available: {list(scenarios_cache.keys())}")
    
    # If game is already running, stop it first before starting a new one
    if game_state.status == GameStatus.RUNNING or game_state.status == GameStatus.PAUSED:
        print(f"[GAME] Game is already {game_state.status}, stopping it first before starting new game")
        # Stop the timer
        stop_timer()
        
        # Save the old scenario ID for the event
        old_scenario_id = game_state.current_scenario_id
        
        # Set status to finished and clear scenario to prevent conflicts
        game_state.status = GameStatus.FINISHED
        game_state.current_scenario_id = None  # Clear scenario when stopping
        
        # Update session state to "ended" if join codes are enabled
        if settings.FEATURE_JOIN_CODES:
            from app.routes.sessions import update_session_state_by_game_status
            try:
                update_session_state_by_game_status("finished")
            except Exception as e:
                print(f"[GAME] Error updating session state: {e}")
        
        # Emit round_ended event
        event = create_event(
            EventKind.ROUND_ENDED,
            {
                "reason": "new_game_starting",
                "elapsed_seconds": game_state.timer or 0,
                "previous_scenario_id": old_scenario_id,  # Include old scenario for reference
            }
        )
        await broadcaster.emit_to_all(event)
        
        # Store event if snapshot feature is enabled
        if settings.FEATURE_WS_SNAPSHOT:
            from app.store import add_event
            add_event(event)
        
        # Wait a brief moment to ensure the round_ended event propagates
        import asyncio
        await asyncio.sleep(0.1)
        
        print(f"[GAME] Stopped previous game before starting new one (cleared scenario: {old_scenario_id})")
    
    # Reset score when starting a new game
    from app.routes.score import current_score
    current_score.red = 0
    current_score.blue = 0
    current_score.mttd = None
    current_score.mttc = None
    current_score.round_breakdown = []
    
    # Clear previous round data
    from app.routes.attacks import launched_attacks
    from app.routes.actions import blue_actions
    from app.routes.voting import clear_voting_data
    from app.routes.chat import clear_chat_history
    from app.routes.activity import clear_activity_history
    from app.routes.presence import clear_presence
    launched_attacks.clear()
    blue_actions.clear()
    clear_voting_data()
    clear_chat_history()
    clear_activity_history()
    clear_presence()
    
    # Note: We don't clear names here - names are session-scoped and should persist
    # across multiple games in the same session. Players keep their assigned names
    # even when a new game starts, which is the expected behavior.
    
    # Update game state
    game_state.status = GameStatus.RUNNING
    game_state.round += 1
    game_state.current_scenario_id = request.scenario_id
    game_state.timer = 0
    # Don't set start_time until Red team dismisses briefing
    game_state.start_time = None
    game_state.current_turn = "red"  # Red team starts first
    # Don't set turn_start_time until Red team dismisses briefing
    game_state.turn_start_time = None
    game_state.turn_time_limit = 300  # 5 minutes per turn
    # Initialize turn counters
    game_state.red_turn_count = 0
    game_state.blue_turn_count = 0
    # Get scenario to check for turn limit
    scenario = scenarios_cache.get(request.scenario_id)
    if scenario and scenario.max_turns_per_side:
        game_state.max_turns_per_side = scenario.max_turns_per_side
    else:
        game_state.max_turns_per_side = None  # Unlimited
    # Reset scan state
    game_state.red_scan_completed = False
    game_state.red_scan_tool = None
    game_state.red_scan_success = False
    game_state.red_scan_results = []  # Clear all scan results
    game_state.red_vulnerability_identified = False
    game_state.red_vulnerability_votes = {}  # Clear all votes
    game_state.blue_ip_identified = False
    game_state.blue_ip_votes = {}  # Clear Blue team IP votes
    game_state.blue_action_identified = False
    game_state.blue_action_votes = {}  # Clear Blue team action votes
    game_state.blue_investigation_completed = False
    game_state.blue_investigation_votes = {}  # Clear Blue team investigation votes
    game_state.red_pivot_strategy_selected = False
    game_state.red_pivot_votes = {}  # Clear Red team pivot votes
    game_state.red_attack_selected = False
    game_state.red_attack_votes = {}  # Clear Red team attack votes
    game_state.red_scan_ips = []  # Clear scan IPs
    game_state.blocked_ips = []  # Clear blocked IPs
    # Reset briefing dismissed flag
    game_state.red_briefing_dismissed = False
    # Reset per-turn action limits
    # Note: Removed red_scan_this_turn - scans no longer restricted by turn
    game_state.red_attack_this_turn = False
    game_state.blue_action_this_turn = False
    
    # Update session state to "running" if join codes are enabled
    if settings.FEATURE_JOIN_CODES:
        from app.routes.sessions import update_session_state_by_game_status
        try:
            update_session_state_by_game_status("running")
        except Exception as e:
            print(f"[GAME] Error updating session state: {e}")
    
    # Stop any existing timer first (in case we're restarting after a stop)
    stop_timer()
    # Start the timer background task (but it won't count until start_time is set)
    start_timer()
    
    print(f"[GAME] Game state after update: status={game_state.status}, round={game_state.round}, scenario={game_state.current_scenario_id}")
    print(f"[GAME] Game state object: {game_state.model_dump()}")
    
    # Emit round_started event
    event = create_event(
        EventKind.ROUND_STARTED,
        {
            "round": game_state.round,
            "scenario_id": request.scenario_id,
            "scenario_name": scenarios_cache[request.scenario_id].name,
        },
    )
    await broadcaster.emit_to_all(event)
    
    # Store event if snapshot feature is enabled
    if settings.FEATURE_WS_SNAPSHOT:
        from app.store import add_event
        add_event(event)
    
    # Emit score reset event
    score_event = create_event(
        EventKind.SCORE_UPDATE,
        {
            "red": 0,
            "blue": 0,
            "mttd": None,
            "mttc": None,
        },
    )
    await broadcaster.emit_to_all(score_event)
    
    # Store event if snapshot feature is enabled
    if settings.FEATURE_WS_SNAPSHOT:
        from app.store import add_event
        add_event(score_event)
    
    print(f"[GAME] Returning game state: status={game_state.status}")
    return game_state


@router.post("/dismiss-briefing")
async def dismiss_briefing() -> GameState:
    """Dismiss the Red team briefing and start the game timer."""
    global game_state
    
    if game_state.status != GameStatus.RUNNING:
        raise HTTPException(status_code=400, detail="Game is not running")
    
    if game_state.red_briefing_dismissed:
        # Already dismissed, just return current state
        return game_state
    
    # Mark briefing as dismissed
    game_state.red_briefing_dismissed = True
    
    # Now set the actual start times
    game_state.start_time = datetime.utcnow()
    game_state.turn_start_time = datetime.utcnow()
    game_state.timer = 0
    
    print(f"[GAME] Red team briefing dismissed. Starting timer at {game_state.start_time.isoformat()}")
    
    # Emit event to notify all clients that timer has started
    event = create_event(
        EventKind.TIMER_UPDATE,
        {
            "timer": 0,
            "timer_limit": 1800,
            "time_remaining": 1800,
            "briefing_dismissed": True,
        },
    )
    await broadcaster.emit_to_all(event)
    
    if settings.FEATURE_WS_SNAPSHOT:
        from app.store import add_event
        add_event(event)
    
    return game_state


@router.post("/pause")
async def pause_game() -> GameState:
    """Pause the game."""
    global game_state
    
    if game_state.status != GameStatus.RUNNING:
        raise HTTPException(status_code=400, detail="Game is not running")
    
    game_state.status = GameStatus.PAUSED
    
    # Update session state to "paused" if join codes are enabled
    if settings.FEATURE_JOIN_CODES:
        from app.routes.sessions import update_session_state_by_game_status
        try:
            update_session_state_by_game_status("paused")
        except Exception as e:
            print(f"[GAME] Error updating session state: {e}")
    
    # Note: Timer continues running but game is paused
    return game_state


@router.post("/resume")
async def resume_game() -> GameState:
    """Resume the game."""
    global game_state
    
    if game_state.status != GameStatus.PAUSED:
        raise HTTPException(status_code=400, detail="Game is not paused")
    
    game_state.status = GameStatus.RUNNING
    
    # Update session state to "running" if join codes are enabled
    if settings.FEATURE_JOIN_CODES:
        from app.routes.sessions import update_session_state_by_game_status
        try:
            update_session_state_by_game_status("running")
        except Exception as e:
            print(f"[GAME] Error updating session state: {e}")
    
    return game_state


@router.post("/stop")
async def stop_game() -> GameState:
    """Stop/end the current game session."""
    global game_state
    
    if game_state.status != GameStatus.RUNNING and game_state.status != GameStatus.PAUSED:
        raise HTTPException(status_code=400, detail="No active game to stop")
    
    # Stop the timer
    stop_timer()
    
    # Save the old scenario ID for the event
    old_scenario_id = game_state.current_scenario_id
    
    # Set status to finished and clear scenario to prevent conflicts
    game_state.status = GameStatus.FINISHED
    game_state.current_scenario_id = None  # Clear scenario when stopping
    
    # Update session state to "ended" if join codes are enabled
    if settings.FEATURE_JOIN_CODES:
        from app.routes.sessions import update_session_state_by_game_status
        try:
            update_session_state_by_game_status("finished")
        except Exception as e:
            print(f"[GAME] Error updating session state: {e}")
    
    print(f"[GAME] Stopping game session (status: {game_state.status})")
    
    # Emit round_ended event
    event = create_event(
        EventKind.ROUND_ENDED,
        {
            "reason": "gm_stopped",
            "elapsed_seconds": game_state.timer or 0,
            "previous_scenario_id": old_scenario_id,  # Include old scenario for reference
        }
    )
    await broadcaster.emit_to_all(event)
    
    # Store event if snapshot feature is enabled
    if settings.FEATURE_WS_SNAPSHOT:
        from app.store import add_event
        add_event(event)
    
    print(f"[GAME] Game stopped: status={game_state.status}")
    return game_state


@router.post("/reset")
async def reset_game() -> GameState:
    """Reset the game to lobby. Also stops the game session if it's running."""
    global game_state
    
    # Save old status before resetting
    old_status = game_state.status
    old_timer = game_state.timer
    
    # If game is running or paused, stop it first
    if old_status == GameStatus.RUNNING or old_status == GameStatus.PAUSED:
        # Stop the timer
        stop_timer()
        
        # Set status to finished
        game_state.status = GameStatus.FINISHED
        
        # Update session state to "ended" if join codes are enabled
        if settings.FEATURE_JOIN_CODES:
            from app.routes.sessions import update_session_state_by_game_status
            try:
                update_session_state_by_game_status("finished")
            except Exception as e:
                print(f"[GAME] Error updating session state: {e}")
        
        # Emit round_ended event to notify all clients
        event = create_event(
            EventKind.ROUND_ENDED,
            {
                "reason": "reset",
                "elapsed_seconds": old_timer or 0,
            }
        )
        await broadcaster.emit_to_all(event)
        
        # Store event if snapshot feature is enabled
        if settings.FEATURE_WS_SNAPSHOT:
            from app.store import add_event
            add_event(event)
        
        print(f"[GAME] Stopping game session before reset (status: {old_status})")
    
    # Stop the timer (in case it wasn't already stopped)
    stop_timer()
    
    # Reset game state
    game_state = GameState()
    
    # Update session state to "lobby" for reuse if join codes are enabled
    if settings.FEATURE_JOIN_CODES:
        from app.routes.sessions import update_session_state_by_game_status
        try:
            update_session_state_by_game_status("lobby")
        except Exception as e:
            print(f"[GAME] Error updating session state: {e}")
    # Ensure scan state is reset
    game_state.red_scan_completed = False
    game_state.red_scan_tool = None
    game_state.red_scan_success = False
    game_state.red_scan_results = []  # Clear all scan results
    game_state.red_vulnerability_identified = False
    game_state.red_vulnerability_votes = {}  # Clear all votes
    game_state.blue_ip_identified = False
    game_state.blue_ip_votes = {}  # Clear Blue team IP votes
    game_state.blue_action_identified = False
    game_state.blue_action_votes = {}  # Clear Blue team action votes
    game_state.blue_investigation_completed = False
    game_state.blue_investigation_votes = {}  # Clear Blue team investigation votes
    game_state.red_pivot_strategy_selected = False
    game_state.red_pivot_votes = {}  # Clear Red team pivot votes
    game_state.red_attack_selected = False
    game_state.red_attack_votes = {}  # Clear Red team attack votes
    game_state.red_scan_ips = []  # Clear scan IPs
    game_state.blocked_ips = []  # Clear blocked IPs
    # Reset briefing dismissed flag
    game_state.red_briefing_dismissed = False
    # Reset per-turn action limits
    # Note: Removed red_scan_this_turn - scans no longer restricted by turn
    game_state.red_attack_this_turn = False
    game_state.blue_action_this_turn = False
    
    # Reset score
    from app.routes.score import current_score
    current_score.red = 0
    current_score.blue = 0
    current_score.mttd = None
    current_score.mttc = None
    current_score.round_breakdown = []
    
    # Reset launched attacks and blue actions
    from app.routes.attacks import launched_attacks
    from app.routes.actions import blue_actions
    from app.routes.voting import clear_voting_data
    from app.services.name_assignment import clear_session_names
    launched_attacks.clear()
    blue_actions.clear()
    clear_voting_data()
    
    # Clear names for all sessions (or specific session if we have session_id)
    # For now, clear all - could be improved to clear specific session
    if settings.FEATURE_JOIN_CODES:
        # Get current session ID if available
        # For now, we'll clear all names on reset
        pass  # Names will be cleared per-session when sessions end
    
    # Clear event store if snapshot feature is enabled
    if settings.FEATURE_WS_SNAPSHOT:
        from app.store import clear_events
        clear_events()
    
    print(f"[GAME] Resetting game to lobby state")
    
    # Note: We already emitted ROUND_ENDED event above if game was running/paused
    # Only emit another one if the game wasn't running/paused
    if old_status != GameStatus.RUNNING and old_status != GameStatus.PAUSED:
        event = create_event(EventKind.ROUND_ENDED, {"reason": "reset"})
        await broadcaster.emit_to_all(event)
        
        # Store event if snapshot feature is enabled
        if settings.FEATURE_WS_SNAPSHOT:
            from app.store import add_event
            add_event(event)
    
    # Emit score reset event
    score_event = create_event(
        EventKind.SCORE_UPDATE,
        {
            "red": 0,
            "blue": 0,
            "mttd": None,
            "mttc": None,
        },
    )
    await broadcaster.emit_to_all(score_event)
    
    # Store event if snapshot feature is enabled
    if settings.FEATURE_WS_SNAPSHOT:
        from app.store import add_event
        add_event(score_event)
    
    print(f"[GAME] Game reset complete: status={game_state.status}, round={game_state.round}, scenario={game_state.current_scenario_id}")
    
    return game_state


@router.post("/inject")
async def inject_event(event_type: str, target: str, note: str):
    """Inject a GM event."""
    event = create_event(
        EventKind.GM_INJECT,
        {"type": event_type, "target": target, "note": note},
    )
    await broadcaster.emit_to_all(event)
    
    # Store event if snapshot feature is enabled
    if settings.FEATURE_WS_SNAPSHOT:
        from app.store import add_event
        add_event(event)
    
    return {"status": "injected"}


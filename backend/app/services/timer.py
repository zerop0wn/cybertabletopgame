"""Game timer service - handles periodic timer updates and 30-minute limit."""
import asyncio
from datetime import datetime, timedelta
from app.models import GameStatus, EventKind
from app.settings import settings

# Game duration limit: 30 minutes = 1800 seconds
SCENARIO_DURATION_LIMIT = 1800  # 30 minutes in seconds

# Background task reference
_timer_task: asyncio.Task | None = None


async def timer_loop():
    """Background task that updates the game timer every second."""
    global _timer_task
    
    # Lazy import to avoid circular dependency - import once at function start
    from app.routes.game import game_state
    from app.ws import broadcaster, create_event
    
    while True:
        try:
            await asyncio.sleep(1)  # Update every second
            
            # Only update timer if game is running and briefing has been dismissed (start_time is set)
            if game_state.status == GameStatus.RUNNING and game_state.start_time and game_state.red_briefing_dismissed:
                # Calculate elapsed time
                elapsed = int((datetime.utcnow() - game_state.start_time).total_seconds())
                game_state.timer = elapsed
                
                # Check for turn timeout
                if game_state.current_turn and game_state.turn_start_time:
                    turn_elapsed = int((datetime.utcnow() - game_state.turn_start_time).total_seconds())
                    turn_remaining = max(0, game_state.turn_time_limit - turn_elapsed)
                    
                    # Check if turn time has expired (>= to catch exactly at limit and any overshoot)
                    # This check happens every second, so it will trigger immediately when time expires
                    if turn_elapsed >= game_state.turn_time_limit:
                        print(f"[TIMER] Turn timeout reached for {game_state.current_turn} team (elapsed: {turn_elapsed}s, limit: {game_state.turn_time_limit}s)")
                        
                        # Auto-advance turn immediately
                        old_turn = game_state.current_turn
                        new_turn = "blue" if old_turn == "red" else "red"
                        game_state.current_turn = new_turn
                        game_state.turn_start_time = datetime.utcnow()  # Reset timer for new turn
                        # Reset per-turn action limits
                        # Note: Removed red_scan_this_turn reset - scans no longer restricted by turn
                        game_state.red_attack_this_turn = False
                        game_state.blue_action_this_turn = False
                        
                        print(f"[TIMER] Turn switched from {old_turn} to {new_turn} at {game_state.turn_start_time.isoformat()}")
                        
                        # Emit turn timeout event first
                        timeout_event = create_event(
                            EventKind.TURN_TIMEOUT,
                            {
                                "expired_turn": old_turn,
                                "new_turn": new_turn,
                                "reason": "time_limit",
                                "elapsed_seconds": turn_elapsed,
                                "turn_start_time": game_state.turn_start_time.isoformat() if game_state.turn_start_time else None,
                            }
                        )
                        print(f"[TIMER] Emitting TURN_TIMEOUT event: expired={old_turn}, new={new_turn}")
                        await broadcaster.emit_to_all(timeout_event)
                        
                        # Emit turn changed event with updated state
                        turn_event = create_event(
                            EventKind.TURN_CHANGED,
                            {
                                "turn": new_turn,
                                "reason": "turn_timeout",
                                "previous_turn": old_turn,
                                "turn_start_time": game_state.turn_start_time.isoformat() if game_state.turn_start_time else None,
                            }
                        )
                        print(f"[TIMER] Emitting TURN_CHANGED event: turn={new_turn}, reason=turn_timeout")
                        await broadcaster.emit_to_all(turn_event)
                        
                        # Store events if snapshot feature is enabled
                        if settings.FEATURE_WS_SNAPSHOT:
                            from app.store import add_event
                            add_event(timeout_event)
                            add_event(turn_event)
                else:
                    # Log when turn timeout check is skipped
                    if game_state.current_turn and not game_state.turn_start_time:
                        # Only log this occasionally to avoid spam (every 30 seconds)
                        if game_state.timer and game_state.timer % 30 == 0:
                            print(f"[TIMER] Turn timeout check skipped: current_turn={game_state.current_turn}, turn_start_time={game_state.turn_start_time}")
                
                # Check if we've exceeded the 20-minute limit
                if elapsed >= SCENARIO_DURATION_LIMIT:
                    print(f"[TIMER] Scenario duration limit ({SCENARIO_DURATION_LIMIT}s) reached. Ending round.")
                    
                    # End the round
                    game_state.status = GameStatus.FINISHED
                    
                    # Emit round_ended event
                    end_event = create_event(
                        EventKind.ROUND_ENDED,
                        {
                            "reason": "time_limit",
                            "elapsed_seconds": elapsed,
                            "limit_seconds": SCENARIO_DURATION_LIMIT,
                        }
                    )
                    await broadcaster.emit_to_all(end_event)
                    
                    # Store event if snapshot feature is enabled
                    if settings.FEATURE_WS_SNAPSHOT:
                        from app.store import add_event
                        add_event(end_event)
                    
                    # Emit timer update with final time
                    timer_event = create_event(
                        EventKind.TIMER_UPDATE,
                        {
                            "timer": elapsed,
                            "timer_limit": SCENARIO_DURATION_LIMIT,
                            "time_remaining": 0,
                        }
                    )
                    await broadcaster.emit_to_all(timer_event)
                else:
                    # Emit timer update event (every 5 seconds to reduce WebSocket traffic)
                    if elapsed % 5 == 0:
                        timer_event = create_event(
                            EventKind.TIMER_UPDATE,
                            {
                                "timer": elapsed,
                                "timer_limit": SCENARIO_DURATION_LIMIT,
                                "time_remaining": SCENARIO_DURATION_LIMIT - elapsed,
                            }
                        )
                        await broadcaster.emit_to_all(timer_event)
            
        except Exception as e:
            print(f"[TIMER] Error in timer loop: {e}")
            await asyncio.sleep(1)  # Continue on error


def start_timer():
    """Start the background timer task."""
    global _timer_task
    
    if _timer_task is None or _timer_task.done():
        print("[TIMER] Starting game timer background task")
        _timer_task = asyncio.create_task(timer_loop())


def stop_timer():
    """Stop the background timer task."""
    global _timer_task
    
    if _timer_task and not _timer_task.done():
        print("[TIMER] Stopping game timer background task")
        _timer_task.cancel()
        _timer_task = None


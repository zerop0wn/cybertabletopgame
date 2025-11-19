"""Blue team action routes."""
from fastapi import APIRouter, HTTPException
from app.models import ActionRequest, BlueAction, Event, EventKind, GameStatus
from app.routes.game import game_state
from app.routes.scenarios import scenarios_cache
from app.routes.attacks import launched_attacks
from app.services.resolver import resolve_outcome
from app.ws import broadcaster, create_event
from app.settings import settings
from datetime import datetime
import uuid

router = APIRouter(prefix="/api/actions", tags=["actions"])

# Store blue actions for the current round
blue_actions: list[BlueAction] = []


@router.post("")
async def submit_action(request: ActionRequest):
    """Submit a blue team action."""
    global game_state, blue_actions
    
    try:
        print(f"[ACTION] Submit request: type={request.type}, target={request.target}")
        print(f"[ACTION] Game state: status={game_state.status}, scenario={game_state.current_scenario_id}, turn={game_state.current_turn}")
        
        if game_state.status != GameStatus.RUNNING:
            raise HTTPException(
                status_code=400, 
                detail=f"Game is not running. Current status: {game_state.status}. Please start the game first."
            )
        
        # Check if it's Blue team's turn
        if game_state.current_turn != "blue":
            print(f"[ACTION] Error: Not Blue team's turn. Current turn: {game_state.current_turn}")
            raise HTTPException(
                status_code=403,
                detail=f"It's not Blue team's turn. Current turn: {game_state.current_turn}. Please wait for your turn."
            )
        
        # Check if Blue team has already acted this turn
        if game_state.blue_action_this_turn:
            raise HTTPException(
                status_code=400,
                detail="You have already submitted an action this turn. Only one action is allowed per turn."
            )
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        # Catch any other exceptions and return 500 with detailed error
        print(f"[ACTION] Unexpected error in submit_action validation: {e}")
        import traceback
        error_trace = traceback.format_exc()
        print(f"[ACTION] Full traceback:\n{error_trace}")
        raise HTTPException(
            status_code=500,
            detail=f"Internal server error: {str(e)}. Check server logs for details."
        )
    
    try:
        action = BlueAction(
            id=str(uuid.uuid4()),
            actor="blue",
            type=request.type,
            target=request.target,
            note=request.note,
            timestamp=datetime.utcnow(),
            player_name=request.player_name,
        )
        
        # Mark that Blue has acted this turn
        game_state.blue_action_this_turn = True
        
        blue_actions.append(action)
    except Exception as e:
        print(f"[ACTION] Error creating action: {e}")
        import traceback
        error_trace = traceback.format_exc()
        print(f"[ACTION] Full traceback:\n{error_trace}")
        raise HTTPException(
            status_code=500,
            detail=f"Error creating action: {str(e)}. Check server logs for details."
        )
    
    # Emit action_taken event to all (so timeline shows it for all roles)
    # Include action effectiveness context if available
    action_payload = action.model_dump()
    # Ensure timestamp is serialized as ISO string
    if isinstance(action_payload.get("timestamp"), datetime):
        action_payload["timestamp"] = action_payload["timestamp"].isoformat()
    
    event = create_event(
        EventKind.ACTION_TAKEN,
        action_payload,
    )
    await broadcaster.emit_to_all(event)
    
    # Store event if snapshot feature is enabled
    if settings.FEATURE_WS_SNAPSHOT:
        from app.store import add_event
        add_event(event)
    
    print(f"[ACTION] Emitted action_taken event: {action.id}, type: {action.type}, target: {action.target}")
    
    # Debug: Log launched_attacks status
    print(f"[ACTION] Checking for active attacks. launched_attacks count: {len(launched_attacks)}")
    if launched_attacks:
        print(f"[ACTION] Found {len(launched_attacks)} active attack(s). Most recent: {launched_attacks[-1].get('attack_id', 'unknown')}")
    else:
        print(f"[ACTION] WARNING: No active attacks found. Action submitted but cannot resolve any attack.")
    
    # If we have an active attack, resolve final outcome
    # This is simplified - in full implementation, track active attacks
    if launched_attacks:
        # Get the most recent attack
        attack_info = launched_attacks[-1]
        scenario = scenarios_cache.get(game_state.current_scenario_id)
        
        if scenario:
            # Find attack in scenario
            attack = None
            for a in scenario.attacks:
                if a.id == attack_info["attack_id"]:
                    attack = a
                    break
            
            if attack:
                print(f"[ACTION] Resolving attack {attack.id} with {len(blue_actions)} blue actions")
                print(f"[ACTION] Attack details: type={attack.attack_type}, from={attack.from_node}, to={attack.to_node}")
                for i, action in enumerate(blue_actions):
                    print(f"[ACTION] Blue action {i}: type={action.type}, target={action.target}, note={action.note}")
                
                # Get alerts from attack launch (for tiered resolution)
                alerts = attack_info.get("alerts", [])
                
                try:
                    outcome = resolve_outcome(
                        attack,
                        blue_actions,
                        scenario.initial_posture,
                        (datetime.utcnow() - attack_info["timestamp"]).total_seconds(),
                        alerts=alerts,
                    )
                except Exception as e:
                    print(f"[ACTION] Error resolving outcome: {e}")
                    import traceback
                    error_trace = traceback.format_exc()
                    print(f"[ACTION] Full traceback:\n{error_trace}")
                    raise HTTPException(
                        status_code=500,
                        detail=f"Error resolving attack outcome: {str(e)}. Check server logs for details."
                    )
                
                print(f"[ACTION] Resolution outcome: {outcome}")
                
                # Calculate score explanation
                score_explanation = []
                if outcome["result"] == "blocked":
                    score_explanation.append("Blocked attack (+8)")
                if outcome["result"] != "hit" and len(blue_actions) > 0:
                    time_diff = (datetime.utcnow() - attack_info["timestamp"]).total_seconds()
                    if time_diff < 300:  # 5 minutes
                        score_explanation.append("Quick response (+5)")
                # Attribution check
                for action in blue_actions:
                    if action.note:
                        note_lower = action.note.lower()
                        attack_type_lower = attack.attack_type.value.lower()
                        if any(term in note_lower for term in [attack_type_lower, "attack", "rce", "sqli", "sql", "brute", "phish", "lateral", "exfil"]):
                            score_explanation.append("Correct attribution (+2)")
                            break
                        else:
                            score_explanation.append("Wrong attribution (-1)")
                            break
                
                # Emit updated attack_resolved event with final result
                print(f"[ACTION] Resolving attack {attack.id}: result={outcome['result']}, blue_score={outcome['score_deltas']['blue']}, red_score={outcome['score_deltas']['red']}")
                
                # Include tiered resolution data if available
                # Serialize blue actions (convert datetime to ISO string)
                blue_actions_serialized = []
                for a in blue_actions:
                    action_dict = a.model_dump()
                    if isinstance(action_dict.get("timestamp"), datetime):
                        action_dict["timestamp"] = action_dict["timestamp"].isoformat()
                    blue_actions_serialized.append(action_dict)
                
                resolve_payload = {
                    "attack_id": attack.id,
                    "attack_type": attack.attack_type.value,
                    "from": attack.from_node,  # Include from/to for map display
                    "to": attack.to_node,
                    "result": outcome["result"],
                    "preliminary": False,  # This is the final resolution
                    "blue_actions_count": len(blue_actions),
                    "blue_actions": blue_actions_serialized,  # Include action details (serialized)
                    "score_deltas": outcome["score_deltas"],
                    "score_explanation": ", ".join(score_explanation) if score_explanation else "No score change",
                }
                
                # Add tiered resolution fields if available
                if "attack_succeeded" in outcome:
                    resolve_payload["attack_succeeded"] = outcome["attack_succeeded"]
                if "success_indicators" in outcome:
                    resolve_payload["success_indicators"] = outcome["success_indicators"]
                if "action_evaluations" in outcome:
                    # Serialize action_evaluations (may contain datetime objects)
                    action_evaluations_serialized = []
                    for eval_item in outcome["action_evaluations"]:
                        eval_dict = eval_item.copy() if isinstance(eval_item, dict) else eval_item.model_dump() if hasattr(eval_item, 'model_dump') else eval_item
                        # Convert any datetime objects to ISO strings
                        for key, value in eval_dict.items():
                            if isinstance(value, datetime):
                                eval_dict[key] = value.isoformat()
                        action_evaluations_serialized.append(eval_dict)
                    resolve_payload["action_evaluations"] = action_evaluations_serialized
                
                # Serialize emitted_alerts if present (contains datetime objects in timestamps)
                if "emitted_alerts" in outcome:
                    alerts_serialized = []
                    for alert in outcome["emitted_alerts"]:
                        alert_dict = alert.copy() if isinstance(alert, dict) else alert.model_dump() if hasattr(alert, 'model_dump') else alert
                        # Convert datetime timestamp to ISO string
                        if isinstance(alert_dict.get("timestamp"), datetime):
                            alert_dict["timestamp"] = alert_dict["timestamp"].isoformat()
                        alerts_serialized.append(alert_dict)
                    resolve_payload["emitted_alerts"] = alerts_serialized
                
                # Legacy effectiveness field (for backward compatibility)
                resolve_payload["effectiveness"] = {
                    "blocked": outcome["result"] in ["successful_block", "blocked"],
                    "detected": outcome["result"] != "hit",
                    "quick_response": len(blue_actions) > 0 and (datetime.utcnow() - attack_info["timestamp"]).total_seconds() < 300,
                    "correct_attribution": any(
                        action.note and any(term in action.note.lower() for term in [attack.attack_type.value.lower(), "rce", "sqli", "sql", "brute", "phish", "lateral", "exfil"])
                        for action in blue_actions
                    ),
                }
                
                resolve_event = create_event(
                    EventKind.ATTACK_RESOLVED,
                    resolve_payload,
                )
                await broadcaster.emit_to_all(resolve_event)
                
                # Store event if snapshot feature is enabled
                if settings.FEATURE_WS_SNAPSHOT:
                    from app.store import add_event
                    add_event(resolve_event)
                
                # Update score (simplified - in full implementation, maintain score state)
                # Import score module
                from app.routes.score import current_score
                
                # Update cumulative score (ensure non-negative)
                current_score.red = max(0, current_score.red + outcome["score_deltas"]["red"])
                current_score.blue = max(0, current_score.blue + outcome["score_deltas"]["blue"])
                
                # Emit score_update event with current cumulative score
                score_event = create_event(
                    EventKind.SCORE_UPDATE,
                    {
                        "red": current_score.red,
                        "blue": current_score.blue,
                        "mttd": current_score.mttd,
                        "mttc": current_score.mttc,
                    },
                )
                await broadcaster.emit_to_all(score_event)
                
                # Store event if snapshot feature is enabled
                if settings.FEATURE_WS_SNAPSHOT:
                    from app.store import add_event
                    add_event(score_event)
                
                # Change turn back to Red after Blue action
                old_turn = game_state.current_turn
                if game_state.current_turn == "blue":
                    game_state.current_turn = "red"
                    game_state.turn_start_time = datetime.utcnow()  # Start Red's turn timer
                    # Reset Red's action limits for the new turn
                    # Note: Removed red_scan_this_turn reset - scans no longer restricted by turn
                    game_state.red_attack_this_turn = False
                    print(f"[ACTION] Turn changed from {old_turn} to Red after blue action at {game_state.turn_start_time.isoformat()}")
                    
                    # Emit turn_changed event
                    turn_event = create_event(
                        EventKind.TURN_CHANGED,
                        {
                            "turn": "red",
                            "reason": "blue_action_taken",
                            "previous_turn": old_turn,
                            "turn_start_time": game_state.turn_start_time.isoformat() if game_state.turn_start_time else None,
                        }
                    )
                    print(f"[ACTION] Emitting TURN_CHANGED event: turn=red, reason=blue_action_taken")
                    await broadcaster.emit_to_all(turn_event)
                    
                    # Store event if snapshot feature is enabled
                    if settings.FEATURE_WS_SNAPSHOT:
                        from app.store import add_event
                        add_event(turn_event)
                else:
                    print(f"[ACTION] WARNING: Turn is already {game_state.current_turn}, not changing to Red")
                
    return {"status": "acknowledged", "action_id": action.id}


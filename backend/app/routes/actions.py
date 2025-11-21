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


@router.post("/investigate-attack")
async def investigate_attack(request: dict) -> dict:
    """Submit a vote for whether the attack succeeded or was blocked."""
    from app.routes.score import current_score
    from app.routes.attacks import launched_attacks
    from app.routes.scenarios import scenarios_cache
    
    player_name = request.get("player_name")
    attack_status = request.get("attack_status")  # "succeeded" or "blocked"
    
    if not player_name or not attack_status:
        raise HTTPException(status_code=400, detail="player_name and attack_status are required")
    
    if game_state.status != GameStatus.RUNNING:
        raise HTTPException(status_code=400, detail="Game is not running")
    
    if game_state.current_turn != "blue":
        raise HTTPException(status_code=400, detail="It's not Blue team's turn")
    
    # Check if there's a resolved attack
    if not launched_attacks:
        raise HTTPException(status_code=400, detail="No attack to investigate")
    
    # Get the most recent attack
    attack_info = launched_attacks[-1]
    scenario = scenarios_cache.get(game_state.current_scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    
    # Find attack in scenario
    attack = None
    for a in scenario.attacks:
        if a.id == attack_info["attack_id"]:
            attack = a
            break
    
    if not attack:
        raise HTTPException(status_code=404, detail="Attack not found")
    
    # Determine correct answer based on actual attack resolution outcome
    # Check if attack was resolved and what the result was
    # If attack was blocked (result == "blocked" or "successful_block"), correct answer is "blocked"
    # If attack succeeded (result == "hit"), correct answer is "succeeded"
    correct_status = "blocked"  # Default assumption
    
    # Check if attack was resolved by looking at attack_info
    # The attack_info may have resolution data, or we can check if Blue team blocked the IP
    # For RCE attacks that were blocked, the correct answer is "blocked"
    # If the attack source IP was blocked, the attack was likely blocked
    attack_source_ip = attack_info.get("source_ip")
    if attack_source_ip and hasattr(game_state, 'blocked_ips') and game_state.blocked_ips:
        if attack_source_ip in game_state.blocked_ips:
            correct_status = "blocked"
        else:
            # IP not blocked, attack may have succeeded
            correct_status = "succeeded"
    
    # Also check if attack was resolved with a result
    # If we have resolution info, use that
    if "is_blocked" in attack_info and attack_info["is_blocked"]:
        correct_status = "blocked"
    elif "result" in attack_info:
        if attack_info["result"] in ["blocked", "successful_block"]:
            correct_status = "blocked"
        elif attack_info["result"] == "hit":
            correct_status = "succeeded"
    
    is_correct = (attack_status == correct_status)
    
    # Initialize votes dict if needed
    if not hasattr(game_state, 'blue_investigation_votes') or game_state.blue_investigation_votes is None:
        game_state.blue_investigation_votes = {}
    
    # Store the vote
    game_state.blue_investigation_votes[player_name] = attack_status
    
    # Calculate vote counts
    vote_counts = {}
    for status in game_state.blue_investigation_votes.values():
        vote_counts[status] = vote_counts.get(status, 0) + 1
    
    # Determine majority vote
    total_votes = len(game_state.blue_investigation_votes)
    majority_status = None
    majority_count = 0
    for status, count in vote_counts.items():
        if count > majority_count:
            majority_count = count
            majority_status = status
    
    # Check if majority has been reached (more than 50% of votes)
    has_majority = majority_count > (total_votes / 2) if total_votes > 0 else False
    majority_is_correct = (majority_status == correct_status) if correct_status and majority_status else False
    
    # Award points for correct identification (only once, when majority is reached)
    identification_points = 0
    if has_majority and majority_is_correct and not game_state.blue_investigation_completed:
        identification_points = 5  # Bonus points for correct investigation
        current_score.blue = max(0, current_score.blue + identification_points)
        game_state.blue_investigation_completed = True
        
        # Emit score update
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
        
        if settings.FEATURE_WS_SNAPSHOT:
            from app.store import add_event
            add_event(score_event)
    
    # Emit investigation completed event
    ident_event = create_event(
        EventKind.INVESTIGATION_COMPLETED,
        {
            "player_name": player_name,
            "attack_status": attack_status,
            "is_correct": is_correct,
            "total_votes": total_votes,
            "vote_counts": vote_counts,
            "votes": game_state.blue_investigation_votes.copy(),
            "majority_status": majority_status,
            "has_majority": has_majority,
            "majority_is_correct": majority_is_correct,
            "points_awarded": identification_points,
            "attack_id": attack.id,
        },
    )
    await broadcaster.emit_to_all(ident_event)
    
    if settings.FEATURE_WS_SNAPSHOT:
        from app.store import add_event
        add_event(ident_event)
    
    # Switch turn to Red team after Blue team completes Turn 4 (investigation)
    if has_majority and game_state.current_turn == "blue":
        # Initialize turn counters if needed
        if not hasattr(game_state, 'red_turn_count'):
            game_state.red_turn_count = 0
        if not hasattr(game_state, 'blue_turn_count'):
            game_state.blue_turn_count = 0
        
        # Increment Blue's turn count (Turn 4 complete)
        game_state.blue_turn_count += 1
        print(f"[ACTION] Blue team turn count: {game_state.blue_turn_count}")
        
        # Check if both teams have completed their turns
        max_turns = getattr(game_state, 'max_turns_per_side', None)
        if max_turns:
            red_turn_count = getattr(game_state, 'red_turn_count', 0)
            blue_turn_count = getattr(game_state, 'blue_turn_count', 0)
            red_done = red_turn_count >= max_turns
            blue_done = blue_turn_count >= max_turns
            
            if red_done and blue_done:
                print(f"[ACTION] Both teams have completed their turns ({max_turns} each). Ending round.")
                game_state.status = GameStatus.FINISHED
                
                # Emit round_ended event
                end_event = create_event(
                    EventKind.ROUND_ENDED,
                    {
                        "reason": "turn_limit_reached",
                        "elapsed_seconds": game_state.timer or 0,
                        "red_turns": red_turn_count,
                        "blue_turns": blue_turn_count,
                        "max_turns_per_side": max_turns,
                    }
                )
                await broadcaster.emit_to_all(end_event)
                
                if settings.FEATURE_WS_SNAPSHOT:
                    from app.store import add_event
                    add_event(end_event)
            else:
                # Switch to Red team
                old_turn = game_state.current_turn
                game_state.current_turn = "red"
                game_state.turn_start_time = datetime.utcnow()
                game_state.red_attack_this_turn = False
                print(f"[ACTION] Turn changed from {old_turn} to Red after investigation at {game_state.turn_start_time.isoformat()}")
                
                # Emit turn_changed event
                turn_event = create_event(
                    EventKind.TURN_CHANGED,
                    {
                        "turn": "red",
                        "reason": "investigation_completed",
                        "previous_turn": old_turn,
                        "turn_start_time": game_state.turn_start_time.isoformat() if game_state.turn_start_time else None,
                    }
                )
                print(f"[ACTION] Emitting TURN_CHANGED event: turn=red, reason=investigation_completed")
                await broadcaster.emit_to_all(turn_event)
                
                if settings.FEATURE_WS_SNAPSHOT:
                    from app.store import add_event
                    add_event(turn_event)
        else:
            # No turn limit, proceed normally
            old_turn = game_state.current_turn
            game_state.current_turn = "red"
            game_state.turn_start_time = datetime.utcnow()
            game_state.red_attack_this_turn = False
            print(f"[ACTION] Turn changed from {old_turn} to Red after investigation at {game_state.turn_start_time.isoformat()}")
            
            # Emit turn_changed event
            turn_event = create_event(
                EventKind.TURN_CHANGED,
                {
                    "turn": "red",
                    "reason": "investigation_completed",
                    "previous_turn": old_turn,
                    "turn_start_time": game_state.turn_start_time.isoformat() if game_state.turn_start_time else None,
                }
            )
            print(f"[ACTION] Emitting TURN_CHANGED event: turn=red, reason=investigation_completed")
            await broadcaster.emit_to_all(turn_event)
            
            if settings.FEATURE_WS_SNAPSHOT:
                from app.store import add_event
                add_event(turn_event)
    
    return {
        "success": True,
        "message": "Investigation vote recorded",
        "is_correct": is_correct,
        "total_votes": total_votes,
        "vote_counts": vote_counts,
        "majority_status": majority_status,
        "has_majority": has_majority,
        "majority_is_correct": majority_is_correct,
        "points_awarded": identification_points,
        "correct_status": correct_status,
    }


@router.post("/identify-action")
async def identify_action(request: dict) -> dict:
    """Submit a vote for which action to take in response to an attack."""
    from app.routes.score import current_score
    from app.routes.attacks import launched_attacks
    from app.routes.scenarios import scenarios_cache
    
    player_name = request.get("player_name")
    action_type = request.get("action_type")  # The action type they think is correct
    
    if not player_name or not action_type:
        raise HTTPException(status_code=400, detail="player_name and action_type are required")
    
    if game_state.status != GameStatus.RUNNING:
        raise HTTPException(status_code=400, detail="Game is not running")
    
    if game_state.current_turn != "blue":
        raise HTTPException(status_code=400, detail="It's not Blue team's turn")
    
    # Check if there's an active attack
    if not launched_attacks:
        raise HTTPException(status_code=400, detail="No active attack to respond to")
    
    # Get the most recent attack
    attack_info = launched_attacks[-1]
    scenario = scenarios_cache.get(game_state.current_scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    
    # Find attack in scenario
    attack = None
    for a in scenario.attacks:
        if a.id == attack_info["attack_id"]:
            attack = a
            break
    
    if not attack:
        raise HTTPException(status_code=404, detail="Attack not found")
    
    # Determine correct action based on attack type
    # For RCE attacks: UPDATE_WAF is optimal (pre-exploitation)
    # For SQLI attacks: UPDATE_WAF is optimal
    # For network attacks: BLOCK_IP is optimal
    # For brute force: BLOCK_IP or UPDATE_WAF
    correct_action = None
    if attack.attack_type.value == "RCE":
        correct_action = "update_waf"  # Optimal for pre-exploitation RCE
    elif attack.attack_type.value == "SQLI":
        correct_action = "update_waf"
    elif attack.attack_type.value == "LATERALMOVE":
        correct_action = "block_ip"
    elif attack.attack_type.value == "BRUTEFORCE":
        correct_action = "block_ip"
    else:
        correct_action = "block_ip"  # Default
    
    is_correct = (action_type == correct_action)
    
    # Initialize votes dict if needed
    if not hasattr(game_state, 'blue_action_votes') or game_state.blue_action_votes is None:
        game_state.blue_action_votes = {}
    
    # Store the vote
    game_state.blue_action_votes[player_name] = action_type
    
    # Calculate vote counts
    vote_counts = {}
    for action in game_state.blue_action_votes.values():
        vote_counts[action] = vote_counts.get(action, 0) + 1
    
    # Determine majority vote
    total_votes = len(game_state.blue_action_votes)
    majority_action = None
    majority_count = 0
    for action, count in vote_counts.items():
        if count > majority_count:
            majority_count = count
            majority_action = action
    
    # Check if majority has been reached (more than 50% of votes)
    has_majority = majority_count > (total_votes / 2) if total_votes > 0 else False
    majority_is_correct = (majority_action == correct_action) if correct_action and majority_action else False
    
    # Award points for correct identification (only once, when majority is reached)
    identification_points = 0
    if has_majority and majority_is_correct and not game_state.blue_action_identified:
        identification_points = 5  # Bonus points for correct team identification
        current_score.blue = max(0, current_score.blue + identification_points)
        game_state.blue_action_identified = True
        
        # Emit score update
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
        
        if settings.FEATURE_WS_SNAPSHOT:
            from app.store import add_event
            add_event(score_event)
    
    # Emit action identification event
    ident_event = create_event(
        EventKind.ACTION_IDENTIFIED,
        {
            "player_name": player_name,
            "action_type": action_type,
            "is_correct": is_correct,
            "total_votes": total_votes,
            "vote_counts": vote_counts,
            "votes": game_state.blue_action_votes.copy(),  # Full votes dict (player_name -> action_type)
            "majority_action": majority_action,
            "has_majority": has_majority,
            "majority_is_correct": majority_is_correct,
            "points_awarded": identification_points,
            "attack_id": attack.id,
            "attack_type": attack.attack_type.value,
        },
    )
    await broadcaster.emit_to_all(ident_event)
    
    if settings.FEATURE_WS_SNAPSHOT:
        from app.store import add_event
        add_event(ident_event)
    
    return {
        "success": True,
        "message": "Vote recorded",
        "is_correct": is_correct,
        "total_votes": total_votes,
        "vote_counts": vote_counts,
        "majority_action": majority_action,
        "has_majority": has_majority,
        "majority_is_correct": majority_is_correct,
        "points_awarded": identification_points,
        "correct_action": correct_action,
    }


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
        
        # Handle IP blocking
        if action.type == "block_ip":
            # Initialize blocked IPs list if needed
            if not hasattr(game_state, 'blocked_ips') or game_state.blocked_ips is None:
                game_state.blocked_ips = []
            if not hasattr(game_state, 'red_scan_ips') or game_state.red_scan_ips is None:
                game_state.red_scan_ips = []
            
            # Add IP to blocked list if not already blocked
            blocked_ip = action.target
            if blocked_ip not in game_state.blocked_ips:
                game_state.blocked_ips.append(blocked_ip)
                print(f"[ACTION] IP {blocked_ip} added to blocked list. Total blocked IPs: {len(game_state.blocked_ips)}")
            
            # Check if blocked IP matches a scan IP (for scoring)
            if blocked_ip in game_state.red_scan_ips:
                print(f"[ACTION] Blocked IP {blocked_ip} matches a scan IP. Blue team correctly identified scan source.")
                # Award bonus points for correctly identifying scan IP
                from app.routes.score import current_score
                current_score.blue = max(0, current_score.blue + 3)  # Bonus for identifying scan IP
                
                # Emit score update
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
                
                if settings.FEATURE_WS_SNAPSHOT:
                    from app.store import add_event
                    add_event(score_event)
        
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
        print(f"[ACTION] No active attacks found. Action submitted but cannot resolve any attack.")
    
    # If no active attack, handle turn switching for defensive actions (like IP blocking)
    if not launched_attacks:
        # For Turn 2, Blue team should identify and block scan IPs
        # After blocking IP (or other defensive actions), switch turn to Red
        old_turn = game_state.current_turn
        if game_state.current_turn == "blue":
            # Initialize turn counters if needed
            if not hasattr(game_state, 'red_turn_count'):
                game_state.red_turn_count = 0
            if not hasattr(game_state, 'blue_turn_count'):
                game_state.blue_turn_count = 0
            
            # Increment Blue's turn counter
            game_state.blue_turn_count += 1
            print(f"[ACTION] Blue team turn count: {game_state.blue_turn_count}")
            
            # Check if both teams have completed their turns
            max_turns = getattr(game_state, 'max_turns_per_side', None)
            if max_turns:
                red_turn_count = getattr(game_state, 'red_turn_count', 0)
                blue_turn_count = getattr(game_state, 'blue_turn_count', 0)
                red_done = red_turn_count >= max_turns
                blue_done = blue_turn_count >= max_turns
                
                if red_done and blue_done:
                    print(f"[ACTION] Both teams have completed their turns ({max_turns} each). Ending round.")
                    game_state.status = GameStatus.FINISHED
                    
                    # Emit round_ended event
                    end_event = create_event(
                        EventKind.ROUND_ENDED,
                        {
                            "reason": "turn_limit_reached",
                            "elapsed_seconds": game_state.timer or 0,
                            "red_turns": red_turn_count,
                            "blue_turns": blue_turn_count,
                            "max_turns_per_side": max_turns,
                        }
                    )
                    await broadcaster.emit_to_all(end_event)
                    
                    if settings.FEATURE_WS_SNAPSHOT:
                        from app.store import add_event
                        add_event(end_event)
                else:
                    # Switch to Red team
                    game_state.current_turn = "red"
                    game_state.turn_start_time = datetime.utcnow()
                    game_state.red_attack_this_turn = False
                    print(f"[ACTION] Turn changed from {old_turn} to Red after blue action (no active attack) at {game_state.turn_start_time.isoformat()}")
                    
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
                    
                    if settings.FEATURE_WS_SNAPSHOT:
                        from app.store import add_event
                        add_event(turn_event)
            else:
                # No turn limit, proceed normally
                game_state.current_turn = "red"
                game_state.turn_start_time = datetime.utcnow()
                game_state.red_attack_this_turn = False
                print(f"[ACTION] Turn changed from {old_turn} to Red after blue action (no active attack) at {game_state.turn_start_time.isoformat()}")
                
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
                
                if settings.FEATURE_WS_SNAPSHOT:
                    from app.store import add_event
                    add_event(turn_event)
        
        return {"status": "acknowledged", "action_id": action.id}
    
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
                    # Initialize turn counters if they don't exist (defensive check for backwards compatibility)
                    if not hasattr(game_state, 'red_turn_count'):
                        game_state.red_turn_count = 0
                    if not hasattr(game_state, 'blue_turn_count'):
                        game_state.blue_turn_count = 0
                    
                    # Increment Blue's turn counter
                    game_state.blue_turn_count += 1
                    print(f"[ACTION] Blue team turn count: {game_state.blue_turn_count}")
                    
                    # Check if both teams have completed their turns
                    max_turns = getattr(game_state, 'max_turns_per_side', None)
                    if max_turns:
                        red_turn_count = getattr(game_state, 'red_turn_count', 0)
                        blue_turn_count = getattr(game_state, 'blue_turn_count', 0)
                        red_done = red_turn_count >= max_turns
                        blue_done = blue_turn_count >= max_turns
                        
                        if red_done and blue_done:
                            print(f"[ACTION] Both teams have completed their turns ({max_turns} each). Ending round.")
                            game_state.status = GameStatus.FINISHED
                            
                            # Emit round_ended event
                            end_event = create_event(
                                EventKind.ROUND_ENDED,
                                {
                                    "reason": "turn_limit_reached",
                                    "elapsed_seconds": game_state.timer or 0,
                                    "red_turns": red_turn_count,
                                    "blue_turns": blue_turn_count,
                                    "max_turns_per_side": max_turns,
                                }
                            )
                            await broadcaster.emit_to_all(end_event)
                            
                            if settings.FEATURE_WS_SNAPSHOT:
                                from app.store import add_event
                                add_event(end_event)
                            
                            # Don't advance turn, game is over
                        else:
                            # Continue with turn change
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
                        # No turn limit, proceed normally
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


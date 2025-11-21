"""Scan routes for reconnaissance phase."""
from fastapi import APIRouter, HTTPException
from app.models import ScanRequest, ScanResult, ScanToolType, EventKind, GameStatus
from app.routes import game
from app.routes.scenarios import scenarios_cache
from app.ws import broadcaster, create_event
from app.settings import settings
from datetime import datetime
import uuid
import random

router = APIRouter(prefix="/api/scans", tags=["scans"])


@router.post("/identify-ip")
async def identify_ip(request: dict) -> dict:
    """Submit a vote for which IP address was used for scanning."""
    from app.routes.game import game_state
    from app.routes.score import current_score
    
    player_name = request.get("player_name")
    ip_address = request.get("ip_address")  # The IP address they think was used for scanning
    
    if not player_name or not ip_address:
        raise HTTPException(status_code=400, detail="player_name and ip_address are required")
    
    if game_state.status != GameStatus.RUNNING:
        raise HTTPException(status_code=400, detail="Game is not running")
    
    if game_state.current_turn != "blue":
        raise HTTPException(status_code=400, detail="It's not Blue team's turn")
    
    # Initialize votes dict if needed
    if not hasattr(game_state, 'blue_ip_votes') or game_state.blue_ip_votes is None:
        game_state.blue_ip_votes = {}
    
    # Initialize scan IPs list if needed
    if not hasattr(game_state, 'red_scan_ips') or game_state.red_scan_ips is None:
        game_state.red_scan_ips = []
    
    # Store the vote
    game_state.blue_ip_votes[player_name] = ip_address
    
    # Check if this is the correct answer (any scan IP is correct, but we'll use the first one as the "primary" scan IP)
    # In Turn 2, Blue team should identify which IP was used for scanning
    correct_ips = game_state.red_scan_ips if game_state.red_scan_ips else []
    is_correct = ip_address in correct_ips
    
    # Calculate vote counts
    vote_counts = {}
    for ip in game_state.blue_ip_votes.values():
        vote_counts[ip] = vote_counts.get(ip, 0) + 1
    
    # Determine majority vote
    total_votes = len(game_state.blue_ip_votes)
    majority_ip = None
    majority_count = 0
    for ip, count in vote_counts.items():
        if count > majority_count:
            majority_count = count
            majority_ip = ip
    
    # Check if majority has been reached (more than 50% of votes)
    has_majority = majority_count > (total_votes / 2) if total_votes > 0 else False
    majority_is_correct = (majority_ip in correct_ips) if correct_ips and majority_ip else False
    
    # Award points for correct identification (only once, when majority is reached)
    identification_points = 0
    if has_majority and majority_is_correct and not game_state.blue_ip_identified:
        identification_points = 5  # Bonus points for correct team identification
        current_score.blue = max(0, current_score.blue + identification_points)
        game_state.blue_ip_identified = True
        
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
    
    # Emit IP identification event
    ident_event = create_event(
        EventKind.IP_IDENTIFIED,
        {
            "player_name": player_name,
            "ip_address": ip_address,
            "is_correct": is_correct,
            "total_votes": total_votes,
            "vote_counts": vote_counts,
            "votes": game_state.blue_ip_votes.copy(),  # Full votes dict (player_name -> ip)
            "majority_ip": majority_ip,
            "has_majority": has_majority,
            "majority_is_correct": majority_is_correct,
            "points_awarded": identification_points,
        },
    )
    await broadcaster.emit_to_all(ident_event)
    
    if settings.FEATURE_WS_SNAPSHOT:
        from app.store import add_event
        add_event(ident_event)
    
    # Switch turn to Red team after Blue team completes Turn 2 (IP identification)
    # Only switch if we have a majority vote (correct or incorrect) and it's still Blue's turn
    if has_majority and game_state.current_turn == "blue":
        from datetime import datetime
        
        # Initialize turn counters if needed
        if not hasattr(game_state, 'red_turn_count'):
            game_state.red_turn_count = 0
        if not hasattr(game_state, 'blue_turn_count'):
            game_state.blue_turn_count = 0
        
        # Increment Blue's turn count (Turn 2 complete)
        game_state.blue_turn_count += 1
        print(f"[SCAN] Blue team turn count: {game_state.blue_turn_count}")
        
        # Check if both teams have completed their turns
        max_turns = getattr(game_state, 'max_turns_per_side', None)
        if max_turns:
            red_turn_count = getattr(game_state, 'red_turn_count', 0)
            blue_turn_count = getattr(game_state, 'blue_turn_count', 0)
            red_done = red_turn_count >= max_turns
            blue_done = blue_turn_count >= max_turns
            
            if red_done and blue_done:
                print(f"[SCAN] Both teams have completed their turns ({max_turns} each). Ending round.")
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
                print(f"[SCAN] Turn changed from {old_turn} to Red after IP identification at {game_state.turn_start_time.isoformat()}")
                
                # Emit turn_changed event
                turn_event = create_event(
                    EventKind.TURN_CHANGED,
                    {
                        "turn": "red",
                        "reason": "ip_identified",
                        "previous_turn": old_turn,
                        "turn_start_time": game_state.turn_start_time.isoformat() if game_state.turn_start_time else None,
                    }
                )
                print(f"[SCAN] Emitting TURN_CHANGED event: turn=red, reason=ip_identified")
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
            print(f"[SCAN] Turn changed from {old_turn} to Red after IP identification at {game_state.turn_start_time.isoformat()}")
            
            # Emit turn_changed event
            turn_event = create_event(
                EventKind.TURN_CHANGED,
                {
                    "turn": "red",
                    "reason": "ip_identified",
                    "previous_turn": old_turn,
                    "turn_start_time": game_state.turn_start_time.isoformat() if game_state.turn_start_time else None,
                }
            )
            print(f"[SCAN] Emitting TURN_CHANGED event: turn=red, reason=ip_identified")
            await broadcaster.emit_to_all(turn_event)
            
            if settings.FEATURE_WS_SNAPSHOT:
                from app.store import add_event
                add_event(turn_event)
    
    return {
        "success": True,
        "message": "Vote recorded",
        "is_correct": is_correct,
        "total_votes": total_votes,
        "vote_counts": vote_counts,
        "majority_ip": majority_ip,
        "has_majority": has_majority,
        "majority_is_correct": majority_is_correct,
        "points_awarded": identification_points,
    }


@router.post("/select-pivot-strategy")
async def select_pivot_strategy(request: dict) -> dict:
    """Submit a vote for Red team's pivot strategy after attack."""
    from app.routes.game import game_state
    from app.routes.score import current_score
    
    player_name = request.get("player_name")
    pivot_strategy = request.get("pivot_strategy")  # "lateral", "alternative", or "persistence"
    
    if not player_name or not pivot_strategy:
        raise HTTPException(status_code=400, detail="player_name and pivot_strategy are required")
    
    if game_state.status != GameStatus.RUNNING:
        raise HTTPException(status_code=400, detail="Game is not running")
    
    if game_state.current_turn != "red":
        raise HTTPException(status_code=400, detail="It's not Red team's turn")
    
    # Validate pivot strategy
    valid_strategies = ["lateral", "alternative", "persistence"]
    if pivot_strategy not in valid_strategies:
        raise HTTPException(status_code=400, detail=f"Invalid pivot_strategy. Must be one of: {valid_strategies}")
    
    # For Turn 4, all strategies are valid choices
    # The "correct" strategy depends on whether the attack succeeded
    # If attack was blocked: "alternative" is best (try different approach)
    # If attack succeeded: "lateral" or "persistence" are good (exploit success)
    # For now, we'll make "alternative" the default correct choice (assuming attack was blocked)
    correct_strategy = "alternative"  # Can be enhanced based on actual attack outcome
    is_correct = (pivot_strategy == correct_strategy)
    
    # Initialize votes dict if needed
    if not hasattr(game_state, 'red_pivot_votes') or game_state.red_pivot_votes is None:
        game_state.red_pivot_votes = {}
    
    # Store the vote
    game_state.red_pivot_votes[player_name] = pivot_strategy
    
    # Calculate vote counts
    vote_counts = {}
    for strategy in game_state.red_pivot_votes.values():
        vote_counts[strategy] = vote_counts.get(strategy, 0) + 1
    
    # Determine majority vote
    total_votes = len(game_state.red_pivot_votes)
    majority_strategy = None
    majority_count = 0
    for strategy, count in vote_counts.items():
        if count > majority_count:
            majority_count = count
            majority_strategy = strategy
    
    # Check if majority has been reached (more than 50% of votes)
    has_majority = majority_count > (total_votes / 2) if total_votes > 0 else False
    majority_is_correct = (majority_strategy == correct_strategy) if correct_strategy and majority_strategy else False
    
    # Award points for correct strategy selection (only once, when majority is reached)
    identification_points = 0
    if has_majority and majority_is_correct and not game_state.red_pivot_strategy_selected:
        identification_points = 5  # Bonus points for correct strategy
        current_score.red = max(0, current_score.red + identification_points)
        game_state.red_pivot_strategy_selected = True
        
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
    
    # Emit pivot strategy selected event
    ident_event = create_event(
        EventKind.PIVOT_STRATEGY_SELECTED,
        {
            "player_name": player_name,
            "pivot_strategy": pivot_strategy,
            "is_correct": is_correct,
            "total_votes": total_votes,
            "vote_counts": vote_counts,
            "votes": game_state.red_pivot_votes.copy(),
            "majority_strategy": majority_strategy,
            "has_majority": has_majority,
            "majority_is_correct": majority_is_correct,
            "points_awarded": identification_points,
        },
    )
    await broadcaster.emit_to_all(ident_event)
    
    if settings.FEATURE_WS_SNAPSHOT:
        from app.store import add_event
        add_event(ident_event)
    
    # Switch turn to Blue team after Red team completes Turn 4 (pivot strategy selection)
    if has_majority and game_state.current_turn == "red":
        from datetime import datetime
        
        # Initialize turn counters if needed
        if not hasattr(game_state, 'red_turn_count'):
            game_state.red_turn_count = 0
        if not hasattr(game_state, 'blue_turn_count'):
            game_state.blue_turn_count = 0
        
        # Increment Red's turn count (Turn 4 complete)
        game_state.red_turn_count += 1
        print(f"[SCAN] Red team turn count: {game_state.red_turn_count}")
        
        # Check if both teams have completed their turns
        max_turns = getattr(game_state, 'max_turns_per_side', None)
        if max_turns:
            red_turn_count = getattr(game_state, 'red_turn_count', 0)
            blue_turn_count = getattr(game_state, 'blue_turn_count', 0)
            red_done = red_turn_count >= max_turns
            blue_done = blue_turn_count >= max_turns
            
            if red_done and blue_done:
                print(f"[SCAN] Both teams have completed their turns ({max_turns} each). Ending round.")
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
                # Switch to Blue team
                old_turn = game_state.current_turn
                game_state.current_turn = "blue"
                game_state.turn_start_time = datetime.utcnow()
                game_state.blue_action_this_turn = False
                print(f"[SCAN] Turn changed from {old_turn} to Blue after pivot strategy selection at {game_state.turn_start_time.isoformat()}")
                
                # Emit turn_changed event
                turn_event = create_event(
                    EventKind.TURN_CHANGED,
                    {
                        "turn": "blue",
                        "reason": "pivot_strategy_selected",
                        "previous_turn": old_turn,
                        "turn_start_time": game_state.turn_start_time.isoformat() if game_state.turn_start_time else None,
                    }
                )
                print(f"[SCAN] Emitting TURN_CHANGED event: turn=blue, reason=pivot_strategy_selected")
                await broadcaster.emit_to_all(turn_event)
                
                if settings.FEATURE_WS_SNAPSHOT:
                    from app.store import add_event
                    add_event(turn_event)
        else:
            # No turn limit, proceed normally
            old_turn = game_state.current_turn
            game_state.current_turn = "blue"
            game_state.turn_start_time = datetime.utcnow()
            game_state.blue_action_this_turn = False
            print(f"[SCAN] Turn changed from {old_turn} to Blue after pivot strategy selection at {game_state.turn_start_time.isoformat()}")
            
            # Emit turn_changed event
            turn_event = create_event(
                EventKind.TURN_CHANGED,
                {
                    "turn": "blue",
                    "reason": "pivot_strategy_selected",
                    "previous_turn": old_turn,
                    "turn_start_time": game_state.turn_start_time.isoformat() if game_state.turn_start_time else None,
                }
            )
            print(f"[SCAN] Emitting TURN_CHANGED event: turn=blue, reason=pivot_strategy_selected")
            await broadcaster.emit_to_all(turn_event)
            
            if settings.FEATURE_WS_SNAPSHOT:
                from app.store import add_event
                add_event(turn_event)
    
    return {
        "success": True,
        "message": "Pivot strategy vote recorded",
        "is_correct": is_correct,
        "total_votes": total_votes,
        "vote_counts": vote_counts,
        "majority_strategy": majority_strategy,
        "has_majority": has_majority,
        "majority_is_correct": majority_is_correct,
        "points_awarded": identification_points,
        "correct_strategy": correct_strategy,
    }


@router.post("/select-attack")
async def select_attack(request: dict) -> dict:
    """Submit a vote for which attack Red team should launch (Turn 3)."""
    from app.routes.game import game_state
    from app.routes.score import current_score
    
    player_name = request.get("player_name")
    attack_id = request.get("attack_id")  # The attack ID they want to launch
    
    if not player_name or not attack_id:
        raise HTTPException(status_code=400, detail="player_name and attack_id are required")
    
    if game_state.status != GameStatus.RUNNING:
        raise HTTPException(status_code=400, detail="Game is not running")
    
    if game_state.current_turn != "red":
        raise HTTPException(status_code=400, detail="It's not Red team's turn")
    
    # Check if it's Turn 3 (red_turn_count should be 1, meaning they've completed Turn 1 and are on Turn 2, which is actually Turn 3)
    # Actually, let's check: Turn 1 = red_turn_count 0, Turn 2 = red_turn_count 1, Turn 3 = red_turn_count 2
    # So for Turn 3, we want red_turn_count == 1 (they've completed 1 turn, so they're on their 2nd turn, which is Turn 3)
    red_turn_count = getattr(game_state, 'red_turn_count', 0)
    if red_turn_count != 1:
        raise HTTPException(status_code=400, detail=f"Attack selection voting is only available in Turn 3. Current turn count: {red_turn_count + 1}")
    
    # Validate attack exists in scenario
    if not game_state.current_scenario_id:
        raise HTTPException(status_code=400, detail="No scenario selected")
    
    scenario = scenarios_cache.get(game_state.current_scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail=f"Scenario not found: {game_state.current_scenario_id}")
    
    # Find the attack in the scenario
    attack = None
    for a in scenario.attacks:
        if a.id == attack_id:
            attack = a
            break
    
    if not attack:
        raise HTTPException(status_code=404, detail=f"Attack not found: {attack_id}")
    
    # Check if attack requires scan and if scan was completed
    if attack.requires_scan:
        scan_results = getattr(game_state, 'red_scan_results', [])
        print(f"[SELECT-ATTACK] Attack requires scan. Scan results count: {len(scan_results)}")
        if not scan_results:
            raise HTTPException(status_code=400, detail="This attack requires a scan, but no scans have been completed")
        
        # Check if required scan tool was used
        if attack.required_scan_tool:
            # Get the string value from the enum (e.g., "OWASP ZAP")
            # ScanToolType is a string enum, so .value gives us the string
            normalized_required_tool = attack.required_scan_tool.value
            print(f"[SELECT-ATTACK] Required tool: {normalized_required_tool} (type: {type(normalized_required_tool)})")
            
            # Check each scan result
            found_tools = []
            for scan in scan_results:
                scan_tool = scan.get('tool')
                found_tools.append(str(scan_tool))
                print(f"[SELECT-ATTACK] Checking scan tool: {scan_tool} (type: {type(scan_tool)})")
            
            has_matching_scan = any(str(scan.get('tool')) == normalized_required_tool for scan in scan_results)
            print(f"[SELECT-ATTACK] Has matching scan: {has_matching_scan}")
            
            if not has_matching_scan:
                raise HTTPException(status_code=400, detail=f"This attack requires a {normalized_required_tool} scan, but no matching scan was found. Available scans: {', '.join(found_tools)}")
    
    # Determine correct attack (the one with is_correct_choice=True)
    correct_attack_id = None
    for a in scenario.attacks:
        if a.is_correct_choice:
            correct_attack_id = a.id
            break
    
    is_correct = (attack_id == correct_attack_id) if correct_attack_id else False
    
    # Initialize votes dict if needed
    if not hasattr(game_state, 'red_attack_votes') or game_state.red_attack_votes is None:
        game_state.red_attack_votes = {}
    
    # Store the vote
    game_state.red_attack_votes[player_name] = attack_id
    
    # Calculate vote counts
    vote_counts = {}
    for voted_attack_id in game_state.red_attack_votes.values():
        vote_counts[voted_attack_id] = vote_counts.get(voted_attack_id, 0) + 1
    
    # Determine majority vote
    total_votes = len(game_state.red_attack_votes)
    majority_attack_id = None
    majority_count = 0
    for voted_attack_id, count in vote_counts.items():
        if count > majority_count:
            majority_count = count
            majority_attack_id = voted_attack_id
    
    # Check if majority has been reached (more than 50% of votes)
    has_majority = majority_count > (total_votes / 2) if total_votes > 0 else False
    majority_is_correct = (majority_attack_id == correct_attack_id) if correct_attack_id and majority_attack_id else False
    
    # Set red_attack_selected to True when majority is reached (allows launching the selected attack)
    # This should happen regardless of whether it's the correct attack
    was_already_selected = game_state.red_attack_selected
    if has_majority and not game_state.red_attack_selected:
        game_state.red_attack_selected = True
    
    # Award points for correct attack selection (only once, when majority is reached and it's correct)
    # Only award if this is the first time we're setting red_attack_selected to True with the correct answer
    identification_points = 0
    if has_majority and majority_is_correct and not was_already_selected:
        identification_points = 5  # Bonus points for correct attack selection
        current_score.red = max(0, current_score.red + identification_points)
        
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
    
    # Emit attack selected event
    ident_event = create_event(
        EventKind.ATTACK_SELECTED,
        {
            "player_name": player_name,
            "attack_id": attack_id,
            "is_correct": is_correct,
            "total_votes": total_votes,
            "vote_counts": vote_counts,
            "votes": game_state.red_attack_votes.copy(),
            "majority_attack_id": majority_attack_id,
            "has_majority": has_majority,
            "majority_is_correct": majority_is_correct,
            "points_awarded": identification_points,
        },
    )
    await broadcaster.emit_to_all(ident_event)
    
    if settings.FEATURE_WS_SNAPSHOT:
        from app.store import add_event
        add_event(ident_event)
    
    return {
        "success": True,
        "player_name": player_name,
        "attack_id": attack_id,
        "is_correct": is_correct,
        "total_votes": total_votes,
        "vote_counts": vote_counts,
        "votes": game_state.red_attack_votes.copy(),
        "majority_attack_id": majority_attack_id,
        "has_majority": has_majority,
        "majority_is_correct": majority_is_correct,
        "points_awarded": identification_points,
    }


@router.post("/identify-vulnerability")
async def identify_vulnerability(request: dict) -> dict:
    """Submit a vote for which scan tool identified the vulnerability."""
    from app.routes.game import game_state
    from app.routes.score import current_score
    from app.routes.scenarios import scenarios_cache
    
    player_name = request.get("player_name")
    scan_tool = request.get("scan_tool")  # The scan tool they think found the vulnerability
    
    if not player_name or not scan_tool:
        raise HTTPException(status_code=400, detail="player_name and scan_tool are required")
    
    if game_state.status != GameStatus.RUNNING:
        raise HTTPException(status_code=400, detail="Game is not running")
    
    if game_state.current_turn != "red":
        raise HTTPException(status_code=400, detail="It's not Red team's turn")
    
    if not game_state.current_scenario_id:
        raise HTTPException(status_code=400, detail="No scenario selected")
    
    scenario = scenarios_cache.get(game_state.current_scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    
    # Initialize votes dict if needed
    if not hasattr(game_state, 'red_vulnerability_votes') or game_state.red_vulnerability_votes is None:
        game_state.red_vulnerability_votes = {}
    
    # Store the vote
    game_state.red_vulnerability_votes[player_name] = scan_tool
    
    # Check if this is the correct answer
    correct_tool = scenario.required_scan_tool.value if scenario.required_scan_tool else None
    is_correct = (scan_tool == correct_tool) if correct_tool else False
    
    # Calculate vote counts
    vote_counts = {}
    for tool in game_state.red_vulnerability_votes.values():
        vote_counts[tool] = vote_counts.get(tool, 0) + 1
    
    # Determine majority vote
    total_votes = len(game_state.red_vulnerability_votes)
    majority_tool = None
    majority_count = 0
    for tool, count in vote_counts.items():
        if count > majority_count:
            majority_count = count
            majority_tool = tool
    
    # Check if majority has been reached (more than 50% of votes)
    has_majority = majority_count > (total_votes / 2) if total_votes > 0 else False
    majority_is_correct = (majority_tool == correct_tool) if correct_tool and majority_tool else False
    
    # Award points for correct identification (only once, when majority is reached)
    identification_points = 0
    if has_majority and majority_is_correct and not game_state.red_vulnerability_identified:
        identification_points = 5  # Bonus points for correct team identification
        current_score.red = max(0, current_score.red + identification_points)
        game_state.red_vulnerability_identified = True
        
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
    
    # Emit vulnerability identification event
    ident_event = create_event(
        EventKind.VULNERABILITY_IDENTIFIED,
        {
            "player_name": player_name,
            "scan_tool": scan_tool,
            "is_correct": is_correct,
            "total_votes": total_votes,
            "vote_counts": vote_counts,
            "votes": game_state.red_vulnerability_votes.copy(),  # Full votes dict (player_name -> tool)
            "majority_tool": majority_tool,
            "has_majority": has_majority,
            "majority_is_correct": majority_is_correct,
            "points_awarded": identification_points,
        },
    )
    await broadcaster.emit_to_all(ident_event)
    
    if settings.FEATURE_WS_SNAPSHOT:
        from app.store import add_event
        add_event(ident_event)
    
    # Switch turn to Blue team after Red team completes Turn 1 (vulnerability identification)
    # Only switch if we have a majority vote (correct or incorrect) and it's still Red's turn
    if has_majority and game_state.current_turn == "red":
        from datetime import datetime
        
        # Initialize turn counters if needed
        if not hasattr(game_state, 'red_turn_count'):
            game_state.red_turn_count = 0
        if not hasattr(game_state, 'blue_turn_count'):
            game_state.blue_turn_count = 0
        
        # Increment Red's turn count (Turn 1 complete)
        game_state.red_turn_count += 1
        print(f"[SCAN] Red team turn count: {game_state.red_turn_count}")
        
        # Check if both teams have completed their turns
        max_turns = getattr(game_state, 'max_turns_per_side', None)
        if max_turns:
            red_turn_count = getattr(game_state, 'red_turn_count', 0)
            blue_turn_count = getattr(game_state, 'blue_turn_count', 0)
            red_done = red_turn_count >= max_turns
            blue_done = blue_turn_count >= max_turns
            
            if red_done and blue_done:
                print(f"[SCAN] Both teams have completed their turns ({max_turns} each). Ending round.")
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
                # Switch to Blue team
                old_turn = game_state.current_turn
                game_state.current_turn = "blue"
                game_state.turn_start_time = datetime.utcnow()
                game_state.blue_action_this_turn = False
                print(f"[SCAN] Turn changed from {old_turn} to Blue after vulnerability identification at {game_state.turn_start_time.isoformat()}")
                
                # Emit turn_changed event
                turn_event = create_event(
                    EventKind.TURN_CHANGED,
                    {
                        "turn": "blue",
                        "reason": "vulnerability_identified",
                        "previous_turn": old_turn,
                        "turn_start_time": game_state.turn_start_time.isoformat() if game_state.turn_start_time else None,
                    }
                )
                print(f"[SCAN] Emitting TURN_CHANGED event: turn=blue, reason=vulnerability_identified")
                await broadcaster.emit_to_all(turn_event)
                
                if settings.FEATURE_WS_SNAPSHOT:
                    from app.store import add_event
                    add_event(turn_event)
        else:
            # No turn limit, proceed normally
            old_turn = game_state.current_turn
            game_state.current_turn = "blue"
            game_state.turn_start_time = datetime.utcnow()
            game_state.blue_action_this_turn = False
            print(f"[SCAN] Turn changed from {old_turn} to Blue after vulnerability identification at {game_state.turn_start_time.isoformat()}")
            
            # Emit turn_changed event
            turn_event = create_event(
                EventKind.TURN_CHANGED,
                {
                    "turn": "blue",
                    "reason": "vulnerability_identified",
                    "previous_turn": old_turn,
                    "turn_start_time": game_state.turn_start_time.isoformat() if game_state.turn_start_time else None,
                }
            )
            print(f"[SCAN] Emitting TURN_CHANGED event: turn=blue, reason=vulnerability_identified")
            await broadcaster.emit_to_all(turn_event)
            
            if settings.FEATURE_WS_SNAPSHOT:
                from app.store import add_event
                add_event(turn_event)
    
    return {
        "success": True,
        "message": "Vote recorded",
        "is_correct": is_correct,
        "total_votes": total_votes,
        "vote_counts": vote_counts,
        "majority_tool": majority_tool,
        "has_majority": has_majority,
        "majority_is_correct": majority_is_correct,
        "points_awarded": identification_points,
    }


@router.post("/scan")
async def run_scan(request: ScanRequest) -> ScanResult:
    """Run a reconnaissance scan."""
    game_state = game.game_state
    
    print(f"[SCAN] Scan request: tool={request.tool}, target={request.target_node}, scenario={request.scenario_id}")
    print(f"[SCAN] Game state: scenario={game_state.current_scenario_id}, status={game_state.status}")
    
    if game_state.status != GameStatus.RUNNING:
        raise HTTPException(
            status_code=400,
            detail=f"Game is not running. Current status: {game_state.status}. Please start the game first."
        )
    
    # Removed turn restriction - scans can be performed at any time during the game
    # Removed per-turn scan limit - multiple scans allowed per turn
    
    if not game_state.current_scenario_id:
        raise HTTPException(
            status_code=400,
            detail="No scenario selected. Please start a game with a scenario first."
        )
    
    if request.scenario_id != game_state.current_scenario_id:
        raise HTTPException(
            status_code=400,
            detail=f"Scenario mismatch. Current scenario: {game_state.current_scenario_id}, Requested: {request.scenario_id}"
        )
    
    scenario = scenarios_cache.get(request.scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail=f"Scenario not found: {request.scenario_id}")
    
    # Determine if this is the correct scan tool (matches scenario's required_scan_tool)
    is_correct_tool = False
    if scenario.required_scan_tool:
        is_correct_tool = scenario.required_scan_tool == request.tool
    
    # Check if this scan tool is linked to any attack
    is_linked_to_attack = False
    if scenario.attacks:
        for attack in scenario.attacks:
            if attack.requires_scan and attack.required_scan_tool == request.tool:
                is_linked_to_attack = True
                break
    
    # Generate a random source IP address for this scan
    # Use realistic private/public IP ranges
    scan_source_ip = f"{random.randint(198, 203)}.{random.randint(51, 99)}.{random.randint(100, 255)}.{random.randint(1, 254)}"
    
    # Initialize scan IPs list if needed
    if not hasattr(game_state, 'red_scan_ips') or game_state.red_scan_ips is None:
        game_state.red_scan_ips = []
    
    # Add IP to scan IPs list if not already there (avoid duplicates)
    if scan_source_ip not in game_state.red_scan_ips:
        game_state.red_scan_ips.append(scan_source_ip)
    
    # Get scan results based on tool
    scan_results = get_scan_results(request.tool, scenario, is_correct_tool)
    
    # Create scan result
    scan_id = str(uuid.uuid4())
    scan_result = ScanResult(
        scan_id=scan_id,
        tool=request.tool,
        target_node=request.target_node,
        success=is_correct_tool,
        results=scan_results,
        timestamp=datetime.utcnow(),
        message=get_scan_message(request.tool, is_correct_tool, scenario),
        player_name=request.player_name,
    )
    
    # Update game state - store all scan results
    game_state.red_scan_completed = True
    # Keep legacy fields for backward compatibility
    game_state.red_scan_tool = request.tool  # This is a ScanToolType enum, Pydantic will serialize it as the string value
    game_state.red_scan_success = is_correct_tool
    
    # Append scan result to the list (store as dict for serialization)
    scan_result_dict = {
        "scan_id": scan_id,
        "tool": request.tool.value,  # Store as string
        "target_node": request.target_node,
        "success": is_correct_tool,
        "results": scan_results,
        "timestamp": datetime.utcnow().isoformat(),
        "message": get_scan_message(request.tool, is_correct_tool, scenario),
        "player_name": request.player_name,
        "source_ip": scan_source_ip,  # Store source IP for this scan
    }
    
    # Initialize list if it doesn't exist
    if not hasattr(game_state, 'red_scan_results') or game_state.red_scan_results is None:
        game_state.red_scan_results = []
    
    # Only add if this scan_id doesn't already exist (prevent duplicates)
    existing_scan_ids = [s.get("scan_id") for s in game_state.red_scan_results if isinstance(s, dict)]
    if scan_id not in existing_scan_ids:
        game_state.red_scan_results.append(scan_result_dict)
    
    print(f"[SCAN] Updated game state: red_scan_completed={game_state.red_scan_completed}, total_scans={len(game_state.red_scan_results)}")
    # Note: Removed red_scan_this_turn flag - multiple scans allowed per turn
    
    # Award/penalize points for scan choice
    from app.routes.score import current_score
    scan_points = 0
    
    if is_correct_tool:
        # Correct scan tool chosen (matches scenario's required_scan_tool) - award points
        scan_points = 2
        print(f"[SCAN] Correct scan tool chosen: +{scan_points} points")
        current_score.red = max(0, current_score.red + scan_points)
    elif is_linked_to_attack:
        # Wrong scan tool chosen but it's linked to an attack - minor penalty
        scan_points = -1
        print(f"[SCAN] Wrong scan tool chosen (linked to attack): {scan_points} points")
        current_score.red = max(0, current_score.red + scan_points)
    else:
        # Informational scan (not linked to any attack) - no points awarded or penalized
        print(f"[SCAN] Informational scan (not linked to attack) - no points awarded or penalized")
    
    # Emit score update if points changed
    if scan_points != 0:
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
    
    print(f"[SCAN] Scan completed: tool={request.tool}, success={is_correct_tool}, points={scan_points}, source_ip={scan_source_ip}")
    
    # Generate scan alert for Blue team to see scan activity
    from app.models import Alert
    from datetime import timedelta
    scan_alert = Alert(
        id=f"scan-alert-{scan_id}",
        timestamp=datetime.utcnow(),
        source="WAF",
        severity="medium",
        summary=f"Suspicious scanning activity detected from {scan_source_ip}",
        details=f"Multiple requests from {scan_source_ip} detected. Scanning tool: {request.tool.value}. Target: {request.target_node}. Review WAF logs for details.",
        ioc={"source_ip": scan_source_ip, "target": request.target_node, "tool": request.tool.value},
        confidence=0.7,
    )
    
    # Emit scan alert event
    scan_alert_event = create_event(
        EventKind.ALERT_EMITTED,
        {
            "alert_id": scan_alert.id,
            "timestamp": scan_alert.timestamp.isoformat(),
            "source": scan_alert.source,
            "severity": scan_alert.severity,
            "summary": scan_alert.summary,
            "details": scan_alert.details,
            "ioc": scan_alert.ioc,
            "confidence": scan_alert.confidence,
        },
    )
    await broadcaster.emit_to_all(scan_alert_event)
    
    # Emit scan_completed event with full scan result data
    scan_event = create_event(
        EventKind.SCAN_COMPLETED,
        {
            "scan_id": scan_id,
            "tool": request.tool.value,
            "target_node": request.target_node,
            "success": is_correct_tool,
            "scenario_id": request.scenario_id,
            "points": scan_points,
            "player_name": request.player_name,
            "results": scan_results,
            "message": get_scan_message(request.tool, is_correct_tool, scenario),
            "timestamp": datetime.utcnow().isoformat(),
            "source_ip": scan_source_ip,  # Include source IP in event
        },
    )
    await broadcaster.emit_to_all(scan_event)
    
    # Store event if snapshot feature is enabled
    if settings.FEATURE_WS_SNAPSHOT:
        from app.store import add_event
        add_event(scan_event)
    
    return scan_result


def get_scan_results(tool: ScanToolType, scenario, is_correct: bool) -> dict:
    """Generate scan results based on tool and scenario."""
    # Check if scenario has specific scan artifacts defined
    if scenario.scan_artifacts and tool.value in scenario.scan_artifacts:
        return scenario.scan_artifacts[tool.value]
    
    # Default scan results based on tool
    if tool == ScanToolType.OWASP_ZAP:
        if is_correct:
            # Correct scan - reveal vulnerability details
            return {
                "vulnerability": "CVE-2019-11043 (PHP-FPM RCE)",
                "severity": "Critical",
                "target": "/plugins/legacy.php",
                "php_version": "5.6.40",
                "confidence": "High",
                "recommendation": "Exploit available for this vulnerability",
                "zap": "PHP 5.6.40 detected on /plugins/legacy.php\nVulnerability: CVE-2019-11043 (PHP-FPM RCE)\nConfidence: High\nPath: /plugins/legacy.php\nMethod: POST"
            }
        else:
            return {
                "status": "Scan complete",
                "note": "No critical vulnerabilities detected in this scan."
            }
    
    elif tool == ScanToolType.NMAP:
        if is_correct:
            # Correct scan - reveal network vulnerability details
            return {
                "ports": "80/tcp open http, 443/tcp open https, 22/tcp filtered ssh, 8080/tcp open http-proxy",
                "service_detection": "Apache/2.4.41, Proxy service on 8080",
                "vulnerability": "Exposed proxy service on non-standard port",
                "severity": "Medium",
                "target": "web-1:8080",
                "confidence": "High",
                "recommendation": "Proxy service may allow unauthorized access",
                "nmap": "PORT     STATE SERVICE\n80/tcp   open  http\n443/tcp  open  https\n22/tcp   filtered ssh\n8080/tcp open  http-proxy\n\nService: Apache/2.4.41\nProxy detected on port 8080"
            }
        else:
            return {
                "ports": "80/tcp open http, 443/tcp open https, 22/tcp filtered ssh",
                "service_detection": "Apache/2.4.41",
                "vulnerability": "None identified",
                "note": "Network scan complete. No application-level vulnerabilities detected.",
                "nmap": "PORT     STATE SERVICE\n80/tcp   open  http\n443/tcp  open  https\n22/tcp   filtered ssh"
            }
    
    elif tool == ScanToolType.SQLMAP:
        if is_correct:
            # Correct scan - reveal SQL injection vulnerability
            return {
                "target": "/api/user.php?id=1",
                "sql_injection": "Detected",
                "vulnerability": "SQL Injection in id parameter",
                "severity": "High",
                "database": "MySQL 5.7",
                "confidence": "High",
                "recommendation": "SQL injection exploit available for this endpoint",
                "sqlmap": "Parameter: id (GET)\nType: boolean-based blind\nTitle: AND boolean-based blind - WHERE or HAVING clause\nPayload: id=1 AND 1234=1234"
            }
        else:
            return {
                "target": "/plugins/legacy.php",
                "sql_injection": "Not detected",
                "note": "SQL injection scan complete. This endpoint does not appear vulnerable to SQL injection.",
                "status": "No SQL injection vulnerabilities found"
            }
    
    elif tool == ScanToolType.NIKTO:
        if is_correct:
            # Correct scan - reveal web server vulnerability
            return {
                "server": "Apache/2.4.41",
                "vulnerability": "CVE-2021-41773 (Path Traversal)",
                "severity": "High",
                "target": "/cgi-bin/",
                "issues": "Path traversal vulnerability in Apache mod_cgi",
                "confidence": "High",
                "recommendation": "Exploit available for path traversal vulnerability",
                "nikto": "Apache/2.4.41 detected\nCVE-2021-41773: Path Traversal in mod_cgi\nTarget: /cgi-bin/\nConfidence: High"
            }
        else:
            return {
                "server": "Apache/2.4.41",
                "issues": "Outdated server headers detected",
                "vulnerability": "No critical vulnerabilities found",
                "note": "Web server scan complete. Some minor issues detected, but no exploitable vulnerabilities identified.",
                "status": "Scan complete - minor issues only"
            }
    
    elif tool == ScanToolType.HAVEIBEENPWNED:
        if is_correct:
            # Correct scan - reveal data breach information
            return {
                "breach_data": "Multiple corporate email addresses found in data breaches",
                "severity": "Medium",
                "target": "Corporate email domain",
                "breaches": "LinkedIn (2012), Adobe (2013), Dropbox (2012), Yahoo (2013-2014)",
                "confidence": "High",
                "recommendation": "Corporate email addresses exposed in historical breaches. Credentials may be reused or compromised.",
                "haveibeenpwned": "Domain: example.com\nBreaches found: 4\nTotal accounts exposed: 1,247\n\nBreach Details:\n- LinkedIn (2012): 542 accounts\n- Adobe (2013): 312 accounts\n- Dropbox (2012): 289 accounts\n- Yahoo (2013-2014): 104 accounts\n\nRisk: High probability of credential reuse. Phishing campaigns targeting exposed accounts likely to succeed."
            }
        else:
            return {
                "breach_data": "No significant breaches found",
                "severity": "None",
                "target": "Corporate email domain",
                "breaches": "None",
                "confidence": "High",
                "recommendation": "No major data breaches found for this domain. Focus on other attack vectors.",
                "haveibeenpwned": "Domain: example.com\nBreaches found: 0\nTotal accounts exposed: 0\n\nNote: No significant data breaches found for this domain. Historical breach data does not indicate credential exposure risk."
            }
    
    return {"status": "Scan complete", "note": "No significant findings."}


def get_scan_message(tool: ScanToolType, is_correct: bool, scenario=None) -> str:
    """Get user-friendly message about scan results.
    
    Note: Messages are intentionally neutral to require team analysis.
    The actual vulnerability information is in the scan results data.
    """
    # Return neutral messages for all scans - teams must analyze results to identify vulnerabilities
    if tool == ScanToolType.OWASP_ZAP:
        return "Web application security scan complete. Review results for findings."
    elif tool == ScanToolType.NMAP:
        return "Network port scan complete. Review results for open ports and services."
    elif tool == ScanToolType.SQLMAP:
        return "SQL injection scan complete. Review results for database vulnerabilities."
    elif tool == ScanToolType.NIKTO:
        return "Web server scan complete. Review results for server configuration issues."
    elif tool == ScanToolType.HAVEIBEENPWNED:
        return "Data breach check complete. Review results for credential exposure information."
    return f"{tool.value} scan complete. Review results for findings."


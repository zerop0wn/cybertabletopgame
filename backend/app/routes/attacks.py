"""Attack launch routes."""
from fastapi import APIRouter, HTTPException
from app.models import AttackLaunchRequest, Event, EventKind, GameStatus
from app.services.resolver import resolve_outcome
from app.services.alerts import generate_alerts
from app.ws import broadcaster, create_event
from app.settings import settings
from app.routes import game
from app.routes.scenarios import scenarios_cache
from datetime import datetime
import random
# Import at module level to avoid circular imports
try:
    from app.routes.score import current_score
except ImportError:
    # Fallback if score module not loaded yet
    current_score = None

router = APIRouter(prefix="/api/attacks", tags=["attacks"])

# Track launched attacks for resolution
launched_attacks = []


@router.post("/launch")
async def launch_attack(request: AttackLaunchRequest):
    """Launch an attack and generate alerts."""
    global launched_attacks
    
    # Get current game state from game module (always fresh)
    game_state = game.game_state
    
    print(f"[ATTACK] Launch request: attack_id={request.attack_id}, from={request.from_node}, to={request.to_node}")
    print(f"[ATTACK] Game state: scenario={game_state.current_scenario_id}, status={game_state.status}")
    print(f"[ATTACK] Available scenarios: {list(scenarios_cache.keys())}")
    
    if game_state.status != GameStatus.RUNNING:
        print(f"[ATTACK] Error: Game is not running. Current status: {game_state.status}")
        raise HTTPException(
            status_code=400,
            detail=f"Game is not running. Current status: {game_state.status}. Please start the game first."
        )
    
    # Check if it's Red team's turn
    if game_state.current_turn != "red":
        print(f"[ATTACK] Error: Not Red team's turn. Current turn: {game_state.current_turn}")
        raise HTTPException(
            status_code=403,
            detail=f"It's not Red team's turn. Current turn: {game_state.current_turn}. Please wait for your turn."
        )
    
    # Check if Red team has already attacked this turn
    if game_state.red_attack_this_turn:
        raise HTTPException(
            status_code=400,
            detail="You have already launched an attack this turn. Only one attack is allowed per turn."
        )
    
    if not game_state.current_scenario_id:
        print(f"[ATTACK] Error: No scenario selected")
        raise HTTPException(
            status_code=400,
            detail="No scenario selected. Please start a game with a scenario first."
        )
    
    scenario = scenarios_cache.get(game_state.current_scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail=f"Scenario not found: {game_state.current_scenario_id}")
    
    print(f"[ATTACK] Scenario loaded: {scenario.id}, attacks: {[a.id for a in scenario.attacks]}")
    
    # Find the attack
    attack = None
    available_attack_ids = [a.id for a in scenario.attacks]
    for a in scenario.attacks:
        if a.id == request.attack_id:
            attack = a
            break
    
    if not attack:
        print(f"[ATTACK] Attack {request.attack_id} not found in scenario {scenario.id}")
        raise HTTPException(
            status_code=404,
            detail=f"Attack not found: {request.attack_id}. Available attacks: {available_attack_ids}"
        )
    
    print(f"[ATTACK] Attack found: {attack.id}, type: {attack.attack_type}")
    
    # Generate a new source IP for the attack (different from scan IPs)
    # Initialize blocked IPs list if needed
    if not hasattr(game_state, 'blocked_ips') or game_state.blocked_ips is None:
        game_state.blocked_ips = []
    if not hasattr(game_state, 'red_scan_ips') or game_state.red_scan_ips is None:
        game_state.red_scan_ips = []
    
    # Generate attack source IP (ensure it's different from scan IPs)
    attack_source_ip = None
    max_attempts = 10
    for _ in range(max_attempts):
        candidate_ip = f"{random.randint(198, 203)}.{random.randint(51, 99)}.{random.randint(100, 255)}.{random.randint(1, 254)}"
        if candidate_ip not in game_state.red_scan_ips:
            attack_source_ip = candidate_ip
            break
    
    # Fallback if we couldn't generate a unique IP
    if not attack_source_ip:
        attack_source_ip = f"{random.randint(198, 203)}.{random.randint(51, 99)}.{random.randint(100, 255)}.{random.randint(1, 254)}"
    
    # Check if attack source IP is blocked
    is_blocked = attack_source_ip in game_state.blocked_ips
    if is_blocked:
        print(f"[ATTACK] Attack source IP {attack_source_ip} is blocked. Attack will be blocked.")
        # Award points to Blue team for blocking the attack
        from app.routes.score import current_score
        current_score.blue = max(0, current_score.blue + 8)  # Blocked pre-detonation
        
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
        
        # Emit attack_resolved event immediately for blocked attacks
        resolve_event = create_event(
            EventKind.ATTACK_RESOLVED,
            {
                "attack_id": attack.id,
                "attack_type": attack.attack_type.value,
                "from": request.from_node,
                "to": request.to_node,
                "result": "blocked",
                "reason": "source_ip_blocked",
                "source_ip": attack_source_ip,
                "score_deltas": {"red": 0, "blue": 8},
            },
        )
        await broadcaster.emit_to_all(resolve_event)
        
        if settings.FEATURE_WS_SNAPSHOT:
            from app.store import add_event
            add_event(resolve_event)
        
        # Still change turn to Blue and return
        old_turn = game_state.current_turn
        if game_state.current_turn == "red":
            if not hasattr(game_state, 'red_turn_count'):
                game_state.red_turn_count = 0
            game_state.red_turn_count += 1
            game_state.current_turn = "blue"
            game_state.turn_start_time = datetime.utcnow()
            game_state.blue_action_this_turn = False
            game_state.red_attack_this_turn = True
            
            turn_event = create_event(
                EventKind.TURN_CHANGED,
                {
                    "turn": "blue",
                    "reason": "attack_blocked",
                    "previous_turn": old_turn,
                    "turn_start_time": game_state.turn_start_time.isoformat() if game_state.turn_start_time else None,
                }
            )
            await broadcaster.emit_to_all(turn_event)
            
            if settings.FEATURE_WS_SNAPSHOT:
                from app.store import add_event
                add_event(turn_event)
        
        # Return success response indicating attack was blocked
        return {
            "status": "blocked",
            "attack_id": attack.id,
            "message": f"Attack launched but blocked: Source IP {attack_source_ip} is blocked. Blue team receives +8 points for blocking the attack.",
            "source_ip": attack_source_ip,
            "is_blocked": True,
        }
    
    # Check if attack requires scan
    # Note: We allow attacks even with wrong scans - players will be penalized for wrong choices
    # But they still need to have completed a scan first
    if attack.requires_scan:
        if not game_state.red_scan_completed:
            raise HTTPException(
                status_code=400,
                detail="This attack requires reconnaissance scanning first. Please run a scan before launching the attack."
            )
        # Note: We no longer require the scan tool to match - players can launch attacks with wrong scans
        # They'll be penalized for wrong scan/attack choices via the scoring system
    
    attack_time = datetime.utcnow()
    
    # Generate alerts first (needed for tiered resolution)
    base_time = attack_time
    alerts = generate_alerts(
        attack,
        scenario,
        base_time,
        include_noise=True,
    )
    
    # Update alerts to include attack source IP
    for alert in alerts:
        if alert.ioc:
            alert.ioc["source_ip"] = attack_source_ip
            alert.ioc["blocked"] = is_blocked
    
    # Track this attack (store alerts for tiered resolution)
    launched_attacks.append({
        "attack_id": attack.id,
        "attack": attack,
        "timestamp": attack_time,
        "alerts": alerts,  # Store alerts for tiered resolution
        "player_name": request.player_name,
        "source_ip": attack_source_ip,
        "is_blocked": is_blocked,
    })
    
    # Emit attack_launched event (use create_event from ws module)
    launch_event = create_event(
        EventKind.ATTACK_LAUNCHED,
        {
            "attack_id": attack.id,
            "attack_type": attack.attack_type.value,
            "from": request.from_node,
            "to": request.to_node,
            "player_name": request.player_name,
            "source_ip": attack_source_ip,
            "is_blocked": is_blocked,
        },
    )
    print(f"[ATTACK] Emitting attack_launched event: attack_id={attack.id}, type={attack.attack_type.value}, from={request.from_node}, to={request.to_node}")
    # emit_to_all now handles all broadcasting (broadcast + role rooms + session-scoped rooms)
    await broadcaster.emit_to_all(launch_event)
    
    # Store event if snapshot feature is enabled
    if settings.FEATURE_WS_SNAPSHOT:
        from app.store import add_event
        add_event(launch_event)
    
    # Mark that Red has attacked this turn
    game_state.red_attack_this_turn = True
    
    # Change turn to Blue IMMEDIATELY after attack launch (before emitting events)
    # This ensures Blue team can respond right away
    old_turn = game_state.current_turn
    if game_state.current_turn == "red":
        # Initialize turn counters if they don't exist (defensive check for backwards compatibility)
        if not hasattr(game_state, 'red_turn_count'):
            game_state.red_turn_count = 0
        if not hasattr(game_state, 'blue_turn_count'):
            game_state.blue_turn_count = 0
        
        # Increment Red's turn counter
        game_state.red_turn_count += 1
        print(f"[ATTACK] Red team turn count: {game_state.red_turn_count}")
        
        # Check if both teams have completed their turns
        max_turns = getattr(game_state, 'max_turns_per_side', None)
        if max_turns:
            red_turn_count = getattr(game_state, 'red_turn_count', 0)
            blue_turn_count = getattr(game_state, 'blue_turn_count', 0)
            red_done = red_turn_count >= max_turns
            blue_done = blue_turn_count >= max_turns
            
            if red_done and blue_done:
                print(f"[ATTACK] Both teams have completed their turns ({max_turns} each). Ending round.")
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
                # But still emit the attack event and return normally
            else:
                # Continue with turn change
                game_state.current_turn = "blue"
                game_state.turn_start_time = datetime.utcnow()  # Start Blue's turn timer
                # Reset Blue's action limit for the new turn
                game_state.blue_action_this_turn = False
                print(f"[ATTACK] Turn changed from {old_turn} to Blue after attack launch at {game_state.turn_start_time.isoformat()}")
                
                # Emit turn_changed event FIRST so Blue team knows it's their turn
                turn_event = create_event(
                    EventKind.TURN_CHANGED,
                    {
                        "turn": "blue",
                        "reason": "attack_launched",
                        "previous_turn": old_turn,
                        "turn_start_time": game_state.turn_start_time.isoformat() if game_state.turn_start_time else None,
                    }
                )
                print(f"[ATTACK] Emitting TURN_CHANGED event: turn=blue, reason=attack_launched")
                await broadcaster.emit_to_all(turn_event)
                
                # Store event if snapshot feature is enabled
                if settings.FEATURE_WS_SNAPSHOT:
                    from app.store import add_event
                    add_event(turn_event)
        else:
            # No turn limit, proceed normally
            game_state.current_turn = "blue"
            game_state.turn_start_time = datetime.utcnow()  # Start Blue's turn timer
            # Reset Blue's action limit for the new turn
            game_state.blue_action_this_turn = False
            print(f"[ATTACK] Turn changed from {old_turn} to Blue after attack launch at {game_state.turn_start_time.isoformat()}")
            
            # Emit turn_changed event FIRST so Blue team knows it's their turn
            turn_event = create_event(
                EventKind.TURN_CHANGED,
                {
                    "turn": "blue",
                    "reason": "attack_launched",
                    "previous_turn": old_turn,
                    "turn_start_time": game_state.turn_start_time.isoformat() if game_state.turn_start_time else None,
                }
            )
            print(f"[ATTACK] Emitting TURN_CHANGED event: turn=blue, reason=attack_launched")
            await broadcaster.emit_to_all(turn_event)
            
            # Store event if snapshot feature is enabled
            if settings.FEATURE_WS_SNAPSHOT:
                from app.store import add_event
                add_event(turn_event)
    else:
        print(f"[ATTACK] WARNING: Turn is already {game_state.current_turn}, not changing to Blue")
    
    # Emit alerts (to blue and audience, not red)
    # Convert alerts to JSON-serializable format
    alerts_json = []
    for alert in alerts:
        # Ensure timestamp is serialized as ISO string
        alert_dict = alert.model_dump()
        if isinstance(alert_dict.get("timestamp"), datetime):
            alert_dict["timestamp"] = alert_dict["timestamp"].isoformat()
        
        alerts_json.append(alert_dict)
        
        alert_event = create_event(
            EventKind.ALERT_EMITTED,
            alert_dict,
        )
        await broadcaster.emit_to_roles(["blue", "audience", "gm"], alert_event)
        
        # Store event if snapshot feature is enabled
        if settings.FEATURE_WS_SNAPSHOT:
            from app.store import add_event
            add_event(alert_event)
        
        print(f"[ATTACK] Emitted alert: {alert.id}, source: {alert.source}, severity: {alert.severity}")
    
    print(f"[ATTACK] Generated {len(alerts)} alerts for attack {attack.id}")
    
    # Check if attack is correct for the scenario immediately
    # This determines if the attack can succeed (correct choice) or will miss (incorrect choice)
    is_correct_attack = getattr(attack, 'is_correct_choice', False)
    
    # Award/penalize points for attack choice
    from app.routes.score import current_score
    attack_choice_points = 0
    if is_correct_attack:
        # Correct attack chosen - award points
        attack_choice_points = 3
        print(f"[ATTACK] Correct attack chosen: +{attack_choice_points} points")
    else:
        # Wrong attack chosen - minor penalty
        attack_choice_points = -2
        print(f"[ATTACK] Wrong attack chosen: {attack_choice_points} points")
    
    # Update score immediately for attack choice
    current_score.red = max(0, current_score.red + attack_choice_points)
    
    # Emit score update if points changed
    if attack_choice_points != 0:
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
    
    # If attack is incorrect, it's a miss - no need to wait for Blue
    if not is_correct_attack:
        print(f"[ATTACK] Attack {attack.id} is not the correct choice - will result in miss")
        
        # Emit attack_resolved event immediately for incorrect attacks
        resolve_event = create_event(
            EventKind.ATTACK_RESOLVED,
            {
                "attack_id": attack.id,
                "attack_type": attack.attack_type.value,
                "from": attack.from_node,
                "to": attack.to_node,
                "result": "miss",  # Incorrect attack choice = miss
                "preliminary": False,  # This is final for incorrect attacks
                "reason": "Attack does not match scenario artifacts",
                "score_deltas": {"red": attack_choice_points, "blue": 0},  # Include attack choice points
            },
        )
        await broadcaster.emit_to_all(resolve_event)
        
        # Store event if snapshot feature is enabled
        if settings.FEATURE_WS_SNAPSHOT:
            from app.store import add_event
            add_event(resolve_event)
        
        return {
            "attack_id": attack.id,
            "result": "miss",  # Incorrect attack = miss
            "alerts_count": len(alerts),
            "alerts": alerts_json,
        }
    
    # Correct attack - proceed normally, will be resolved when Blue responds
    print(f"[ATTACK] Attack {attack.id} is the correct choice - waiting for Blue response")
    
    return {
        "attack_id": attack.id,
        "result": "pending",  # Will be resolved when Blue responds
        "alerts_count": len(alerts),
        "alerts": alerts_json,  # Include alerts in response for fallback
    }

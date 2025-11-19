"""Attack resolution logic."""
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime, timedelta
from app.models import (
    Attack,
    BlueAction,
    AttackType,
    BlueActionType,
    GameState,
    AttackInstance,
    Alert,
    ActionEvaluation,
)
from app.settings import settings


def resolve_outcome_legacy(
    attack: Attack,
    blue_actions: List[BlueAction],
    posture: Dict[str, Any],
    clock: float,  # seconds since round start
) -> Dict[str, Any]:
    """
    Legacy resolution logic (unchanged for backward compatibility).
    
    Returns:
        {
            'result': 'hit' | 'blocked' | 'miss',
            'score_deltas': {'red': int, 'blue': int},
            'emitted_alerts': List[Dict]
        }
    """
    # Note: Attack correctness is now checked at launch time in routes/attacks.py
    # If we reach here, the attack is correct (or was launched before the fix)
    # We still check for completeness, but this should rarely trigger
    
    # Check if this is the correct attack choice for the scenario
    is_correct_attack = getattr(attack, 'is_correct_choice', False)
    
    # If attack is not the correct choice, it's a miss (should have been caught at launch)
    if not is_correct_attack:
        result = "miss"
        score_deltas = {"red": 0, "blue": 0}
        
        print(f"[RESOLVER] Attack {attack.id} is not the correct choice - result: miss (should have been caught at launch)")
        
        return {
            "result": result,
            "score_deltas": score_deltas,
            "emitted_alerts": [],
        }
    
    # Correct attack - proceed with normal resolution
    result = "hit"
    score_deltas = {"red": 0, "blue": 0}
    
    # Check if any blue action blocks this attack
    blocked = False
    detected = False
    correct_attribution = False
    contained_quickly = False
    
    print(f"[RESOLVER] Resolving attack: {attack.id}, type: {attack.attack_type}, from: {attack.from_node}, to: {attack.to_node}")
    print(f"[RESOLVER] Blue actions: {len(blue_actions)}")
    for i, action in enumerate(blue_actions):
        print(f"[RESOLVER] Action {i}: type={action.type}, target={action.target}, note={action.note}")
    
    for action in blue_actions:
        # Check for blocking actions - match target node or related nodes
        # Also check if action type matches attack type
        action_targets_node = (attack.to_node == action.target or attack.from_node == action.target)
        
        print(f"[RESOLVER] Checking action: type={action.type}, target={action.target} against attack to={attack.to_node}, from={attack.from_node}")
        print(f"[RESOLVER] Action targets node: {action_targets_node}")
        
        if action_targets_node:
            print(f"[RESOLVER] Action targets node, checking blocking rules...")
            
            # Host isolation blocks most attacks (including lateral movement and exfil)
            if action.type in [BlueActionType.ISOLATE_HOST, BlueActionType.BLOCK_IP]:
                blockable_attacks = [AttackType.RCE, AttackType.SQLI, AttackType.BRUTEFORCE, AttackType.PHISHING, AttackType.LATERALMOVE, AttackType.EXFIL]
                if attack.attack_type in blockable_attacks:
                    if not blocked:  # Only add points once
                        blocked = True
                        result = "blocked"
                        score_deltas["blue"] += 8  # Blocked pre-detonation
                        print(f"[RESOLVER] ✓ Attack BLOCKED by {action.type} on {action.target}")
                    else:
                        print(f"[RESOLVER] Attack already blocked by previous action")
                else:
                    print(f"[RESOLVER] {action.type} does not block {attack.attack_type}")
            
            # WAF update blocks web attacks
            elif action.type == BlueActionType.UPDATE_WAF:
                blockable_attacks = [AttackType.SQLI, AttackType.RCE, AttackType.BRUTEFORCE]
                if attack.attack_type in blockable_attacks:
                    if not blocked:  # Only add points once
                        blocked = True
                        result = "blocked"
                        score_deltas["blue"] += 8
                        print(f"[RESOLVER] ✓ Attack BLOCKED by WAF update on {action.target}")
                    else:
                        print(f"[RESOLVER] Attack already blocked by previous action")
                else:
                    print(f"[RESOLVER] WAF update does not block {attack.attack_type}")
            
            # Block domain/IP can block certain attacks
            elif action.type == BlueActionType.BLOCK_DOMAIN:
                blockable_attacks = [AttackType.PHISHING, AttackType.EXFIL]
                if attack.attack_type in blockable_attacks:
                    if not blocked:  # Only add points once
                        blocked = True
                        result = "blocked"
                        score_deltas["blue"] += 6
                        print(f"[RESOLVER] ✓ Attack BLOCKED by domain block on {action.target}")
                    else:
                        print(f"[RESOLVER] Attack already blocked by previous action")
                else:
                    print(f"[RESOLVER] Domain block does not block {attack.attack_type}")
            else:
                print(f"[RESOLVER] Action type {action.type} does not have blocking rules (may be informational or other action)")
        
        # Check attribution - more lenient matching
        if action.note:
            note_lower = action.note.lower()
            attack_type_lower = attack.attack_type.value.lower()
            if any(term in note_lower for term in [attack_type_lower, "attack", "rce", "sqli", "sql", "brute", "phish", "lateral", "exfil"]):
                correct_attribution = True
                print(f"[RESOLVER] ✓ Correct attribution detected in note: {action.note}")
    
    # Check containment timing
    if blue_actions and clock > 0:
        action_times = [(datetime.utcnow() - action.timestamp).total_seconds() for action in blue_actions]
        if min(action_times) < 300:  # 5 minutes
            contained_quickly = True
            print(f"[RESOLVER] ✓ Quick containment detected: {min(action_times):.1f}s")
    
    print(f"[RESOLVER] Final result: {result}, blocked: {blocked}")
    
    # Red team scoring - only if attack hits (not blocked)
    if result == "hit":
        if attack.attack_type == AttackType.RCE:
            score_deltas["red"] += 10
        elif attack.attack_type == AttackType.SQLI:
            score_deltas["red"] += 8
        elif attack.attack_type == AttackType.BRUTEFORCE:
            score_deltas["red"] += 5
        elif attack.attack_type == AttackType.PHISHING:
            score_deltas["red"] += 3
        elif attack.attack_type == AttackType.LATERALMOVE:
            score_deltas["red"] += 3
        elif attack.attack_type == AttackType.EXFIL:
            score_deltas["red"] += 5
    else:
        # If blocked, Red gets no points
        score_deltas["red"] = 0
    
    # Blue team scoring adjustments
    if blocked:
        # Base points for blocking
        if not any(score_deltas["blue"] > 0 for _ in [1]):  # If no blocking points added yet
            score_deltas["blue"] += 8  # Ensure blocking gives points
        
    if contained_quickly and result != "hit":
        score_deltas["blue"] += 5
    
    # Attribution bonus/penalty (only if actions were taken)
    if blue_actions:
        if correct_attribution:
            score_deltas["blue"] += 2
        else:
            # Only penalize if they took action but got attribution wrong
            # Don't penalize for not taking action
            score_deltas["blue"] -= 1  # Reduced penalty
    
    # Penalties for excessive response
    if len(blue_actions) > 3 and result != "hit":
        score_deltas["blue"] -= 5
    
    # Ensure minimum blue points for taking action (even if wrong)
    if blue_actions and score_deltas["blue"] <= 0 and not blocked:
        score_deltas["blue"] = 1  # At least 1 point for attempting
    
    # Ensure blue score doesn't go below 0 (cap penalties)
    # Note: This prevents negative scores, but we'll still track deltas
    # The actual score enforcement happens at the score update level
    
    # Generate alerts (simplified)
    emitted_alerts = []
    if not blocked:
        # Attack would generate alerts
        emitted_alerts.append({
            "source": "IDS",
            "severity": "high",
            "summary": f"Potential {attack.attack_type.value} detected",
        })
    
    final_result = {
        "result": result,
        "score_deltas": score_deltas,
        "emitted_alerts": emitted_alerts,
    }
    print(f"[RESOLVER] Returning outcome: {final_result}")
    return final_result


def resolve_outcome_with_sla(
    attack: Attack,
    blue_actions: List[BlueAction],
    posture: Dict[str, Any],
    clock: float,
    attack_instance: Optional[AttackInstance] = None,
) -> Dict[str, Any]:
    """
    SLA-aware resolution logic (only used when FEATURE_TIMELINE_SLA=True).
    
    Includes timing-based bonuses/penalties and SLA compliance tracking.
    
    Returns:
        {
            'result': 'hit' | 'blocked' | 'detected',
            'score_deltas': {'red': int, 'blue': int},
            'emitted_alerts': List[Dict],
            'sla_compliance': Dict[str, bool],
            'timing_bonuses': Dict[str, float]
        }
    """
    # Start with legacy resolution for base logic
    base_outcome = resolve_outcome_legacy(attack, blue_actions, posture, clock)
    
    if not attack_instance:
        # No timing data available, return legacy result
        return base_outcome
    
    sla_compliance = {
        "detection_sla_met": False,
        "containment_sla_met": False,
    }
    timing_bonuses = {}
    
    # Calculate detection time
    if attack_instance.first_alert_at:
        detection_time = (attack_instance.first_alert_at - attack_instance.launched_at).total_seconds()
        if detection_time <= attack_instance.sla_seconds_detection:
            sla_compliance["detection_sla_met"] = True
            # Bonus for fast detection (0-5 points, scales with speed)
            detection_bonus = max(0, 5 * (1 - detection_time / attack_instance.sla_seconds_detection))
            timing_bonuses["fast_detection"] = detection_bonus
            base_outcome["score_deltas"]["blue"] += int(detection_bonus)
    
    # Calculate containment time
    if attack_instance.contained_at and attack_instance.first_alert_at:
        containment_time = (attack_instance.contained_at - attack_instance.first_alert_at).total_seconds()
        if containment_time <= attack_instance.sla_seconds_containment:
            sla_compliance["containment_sla_met"] = True
            # Bonus for fast containment (0-10 points)
            containment_bonus = max(0, 10 * (1 - containment_time / attack_instance.sla_seconds_containment))
            timing_bonuses["fast_containment"] = containment_bonus
            base_outcome["score_deltas"]["blue"] += int(containment_bonus)
        else:
            # Penalty for missing containment SLA
            base_outcome["score_deltas"]["blue"] -= 3
    
    # Penalty for missing detection SLA (if alert exists but was slow)
    if attack_instance.first_alert_at and not sla_compliance["detection_sla_met"]:
        base_outcome["score_deltas"]["blue"] -= 2
    
    base_outcome["sla_compliance"] = sla_compliance
    base_outcome["timing_bonuses"] = timing_bonuses
    
    return base_outcome


def determine_attack_success(attack: Attack, alerts: List[Alert]) -> Tuple[bool, List[str]]:
    """
    Determine if attack has succeeded based on alerts.
    
    Returns:
        (success: bool, indicators: List[str])
    """
    indicators = []
    success = False
    
    if attack.attack_type == AttackType.RCE:
        # RCE succeeded if we see command execution or reverse shell
        for alert in alerts:
            summary_lower = alert.summary.lower()
            if "command execution" in summary_lower or "spawned" in summary_lower:
                success = True
                indicators.append(alert.summary)
            elif "reverse shell" in summary_lower or "outbound network connection" in summary_lower:
                success = True
                indicators.append(alert.summary)
            elif "backdoor" in summary_lower or "file system write" in summary_lower:
                success = True
                indicators.append(alert.summary)
    
    elif attack.attack_type == AttackType.SQLI:
        # SQLI succeeded if we see anomalous DB query
        for alert in alerts:
            if "anomalous database query" in alert.summary.lower() or "database" in alert.source.lower():
                success = True
                indicators.append(alert.summary)
    
    elif attack.attack_type == AttackType.BRUTEFORCE:
        # Bruteforce succeeded if we see successful login (not just failed attempts)
        for alert in alerts:
            if "successful login" in alert.summary.lower() or "authentication success" in alert.summary.lower():
                success = True
                indicators.append(alert.summary)
    
    elif attack.attack_type == AttackType.PHISHING:
        # Phishing succeeded if we see macro execution
        for alert in alerts:
            if "macro execution" in alert.summary.lower() or "macro" in alert.summary.lower():
                success = True
                indicators.append(alert.summary)
    
    elif attack.attack_type == AttackType.LATERALMOVE:
        # Lateral movement succeeded if we see privilege escalation
        for alert in alerts:
            if "privilege escalation" in alert.summary.lower() or "lateral movement" in alert.summary.lower():
                success = True
                indicators.append(alert.summary)
    
    elif attack.attack_type == AttackType.EXFIL:
        # Exfil succeeded if we see large data transfer
        for alert in alerts:
            if "large data transfer" in alert.summary.lower() or "data transfer" in alert.summary.lower():
                success = True
                indicators.append(alert.summary)
    
    return success, indicators


def get_scoring_matrix(attack_type: AttackType, attack_succeeded: bool) -> Dict[Tuple[BlueActionType, bool], Dict[str, Any]]:
    """
    Get scoring matrix for attack type and success state.
    
    Returns:
        Dict[(action_type, target_correct), tier_info]
    """
    matrix = {}
    
    if attack_type == AttackType.RCE:
        if attack_succeeded:
            # Post-exploitation: prioritize containment
            matrix[(BlueActionType.ISOLATE_HOST, True)] = {
                "effectiveness": "optimal",
                "points": 10,
                "reason": "Optimal post-exploitation containment. Isolates compromised host to prevent lateral movement and data exfiltration.",
                "result": "successful_block"
            }
            matrix[(BlueActionType.BLOCK_IP, True)] = {
                "effectiveness": "effective",
                "points": 6,
                "reason": "Effective containment. Cuts off reverse shell connection, but backdoor may still be active.",
                "result": "successful_mitigation"
            }
            matrix[(BlueActionType.UPDATE_WAF, True)] = {
                "effectiveness": "partial",
                "points": 3,
                "reason": "Partial mitigation. Too late for current attack, but prevents future similar attacks.",
                "result": "successful_mitigation"
            }
            matrix[(BlueActionType.BLOCK_DOMAIN, True)] = {
                "effectiveness": "ineffective",
                "points": -2,
                "reason": "Ineffective action. Domain blocking does not help with RCE attacks.",
                "result": "unsuccessful_mitigation"
            }
            matrix[(BlueActionType.ISOLATE_HOST, False)] = {
                "effectiveness": "wrong_target",
                "points": -3,
                "reason": "Wrong target. Isolating the wrong host wastes resources and doesn't contain the threat.",
                "result": "unsuccessful_block"
            }
        else:
            # Pre-exploitation: prioritize prevention
            matrix[(BlueActionType.UPDATE_WAF, True)] = {
                "effectiveness": "optimal",
                "points": 10,
                "reason": "Optimal preventive blocking. Updates WAF rules to prevent RCE exploit from succeeding.",
                "result": "successful_block"
            }
            matrix[(BlueActionType.ISOLATE_HOST, True)] = {
                "effectiveness": "effective",
                "points": 6,
                "reason": "Effective defense in depth. Isolates host before exploit can execute.",
                "result": "successful_mitigation"
            }
            matrix[(BlueActionType.BLOCK_IP, True)] = {
                "effectiveness": "partial",
                "points": 3,
                "reason": "Partial prevention. Blocks attacker IP but may not prevent all attack vectors.",
                "result": "successful_mitigation"
            }
            matrix[(BlueActionType.BLOCK_DOMAIN, True)] = {
                "effectiveness": "ineffective",
                "points": -2,
                "reason": "Ineffective action. Domain blocking does not help with RCE attacks.",
                "result": "unsuccessful_mitigation"
            }
            matrix[(BlueActionType.UPDATE_WAF, False)] = {
                "effectiveness": "wrong_target",
                "points": -3,
                "reason": "Wrong target. Updating WAF on wrong node doesn't prevent the attack.",
                "result": "unsuccessful_block"
            }
    
    elif attack_type == AttackType.SQLI:
        if attack_succeeded:
            matrix[(BlueActionType.ISOLATE_HOST, True)] = {
                "effectiveness": "optimal",
                "points": 10,
                "reason": "Optimal containment. Isolates database server to prevent further data access.",
                "result": "successful_block"
            }
            matrix[(BlueActionType.UPDATE_WAF, True)] = {
                "effectiveness": "effective",
                "points": 6,
                "reason": "Effective mitigation. Updates WAF to prevent future SQL injection attempts.",
                "result": "successful_mitigation"
            }
        else:
            matrix[(BlueActionType.UPDATE_WAF, True)] = {
                "effectiveness": "optimal",
                "points": 10,
                "reason": "Optimal preventive blocking. Updates WAF rules to block SQL injection patterns.",
                "result": "successful_block"
            }
            matrix[(BlueActionType.ISOLATE_HOST, True)] = {
                "effectiveness": "effective",
                "points": 6,
                "reason": "Effective defense in depth. Isolates database server before data is accessed.",
                "result": "successful_mitigation"
            }
    
    elif attack_type == AttackType.BRUTEFORCE:
        if attack_succeeded:
            matrix[(BlueActionType.DISABLE_ACCOUNT, True)] = {
                "effectiveness": "optimal",
                "points": 10,
                "reason": "Optimal containment. Disables compromised account immediately.",
                "result": "successful_block"
            }
            matrix[(BlueActionType.ISOLATE_HOST, True)] = {
                "effectiveness": "effective",
                "points": 6,
                "reason": "Effective containment. Isolates host to prevent further access.",
                "result": "successful_mitigation"
            }
        else:
            matrix[(BlueActionType.DISABLE_ACCOUNT, True)] = {
                "effectiveness": "optimal",
                "points": 10,
                "reason": "Optimal preventive action. Disables account before successful compromise.",
                "result": "successful_block"
            }
            matrix[(BlueActionType.ISOLATE_HOST, True)] = {
                "effectiveness": "effective",
                "points": 6,
                "reason": "Effective defense. Isolates host to prevent brute force attempts.",
                "result": "successful_mitigation"
            }
    
    elif attack_type == AttackType.PHISHING:
        if attack_succeeded:
            matrix[(BlueActionType.ISOLATE_HOST, True)] = {
                "effectiveness": "optimal",
                "points": 10,
                "reason": "Optimal containment. Isolates compromised endpoint to prevent further damage.",
                "result": "successful_block"
            }
            matrix[(BlueActionType.BLOCK_DOMAIN, True)] = {
                "effectiveness": "effective",
                "points": 6,
                "reason": "Effective mitigation. Blocks malicious domain to prevent C2 communication.",
                "result": "successful_mitigation"
            }
        else:
            matrix[(BlueActionType.BLOCK_DOMAIN, True)] = {
                "effectiveness": "optimal",
                "points": 10,
                "reason": "Optimal preventive action. Blocks malicious domain before payload executes.",
                "result": "successful_block"
            }
            matrix[(BlueActionType.ISOLATE_HOST, True)] = {
                "effectiveness": "effective",
                "points": 6,
                "reason": "Effective defense. Isolates endpoint to prevent phishing payload execution.",
                "result": "successful_mitigation"
            }
    
    elif attack_type == AttackType.LATERALMOVE:
        if attack_succeeded:
            matrix[(BlueActionType.ISOLATE_HOST, True)] = {
                "effectiveness": "optimal",
                "points": 10,
                "reason": "Optimal containment. Isolates compromised host to prevent further lateral movement.",
                "result": "successful_block"
            }
            matrix[(BlueActionType.BLOCK_IP, True)] = {
                "effectiveness": "effective",
                "points": 6,
                "reason": "Effective containment. Blocks attacker IP to limit lateral movement.",
                "result": "successful_mitigation"
            }
        else:
            matrix[(BlueActionType.ISOLATE_HOST, True)] = {
                "effectiveness": "optimal",
                "points": 10,
                "reason": "Optimal preventive action. Isolates host before lateral movement occurs.",
                "result": "successful_block"
            }
            matrix[(BlueActionType.BLOCK_IP, True)] = {
                "effectiveness": "effective",
                "points": 6,
                "reason": "Effective defense. Blocks attacker IP to prevent lateral movement.",
                "result": "successful_mitigation"
            }
    
    elif attack_type == AttackType.EXFIL:
        if attack_succeeded:
            matrix[(BlueActionType.ISOLATE_HOST, True)] = {
                "effectiveness": "optimal",
                "points": 10,
                "reason": "Optimal containment. Isolates host to stop ongoing data exfiltration.",
                "result": "successful_block"
            }
            matrix[(BlueActionType.BLOCK_IP, True)] = {
                "effectiveness": "effective",
                "points": 6,
                "reason": "Effective containment. Blocks exfiltration destination IP.",
                "result": "successful_mitigation"
            }
            matrix[(BlueActionType.BLOCK_DOMAIN, True)] = {
                "effectiveness": "partial",
                "points": 3,
                "reason": "Partial mitigation. Blocks domain but may not stop IP-based exfiltration.",
                "result": "successful_mitigation"
            }
        else:
            matrix[(BlueActionType.BLOCK_IP, True)] = {
                "effectiveness": "optimal",
                "points": 10,
                "reason": "Optimal preventive action. Blocks exfiltration destination before data transfer.",
                "result": "successful_block"
            }
            matrix[(BlueActionType.ISOLATE_HOST, True)] = {
                "effectiveness": "effective",
                "points": 6,
                "reason": "Effective defense. Isolates host to prevent data exfiltration.",
                "result": "successful_mitigation"
            }
            matrix[(BlueActionType.BLOCK_DOMAIN, True)] = {
                "effectiveness": "partial",
                "points": 3,
                "reason": "Partial prevention. Blocks domain but may not prevent IP-based exfiltration.",
                "result": "successful_mitigation"
            }
    
    return matrix


def evaluate_action_tiered(
    action: BlueAction,
    attack: Attack,
    attack_succeeded: bool,
    alerts: List[Alert]
) -> ActionEvaluation:
    """Evaluate a single action and assign tiered points."""
    
    # Check if target is correct
    target_correct = (action.target == attack.to_node or action.target == attack.from_node)
    
    # Get scoring matrix
    scoring_matrix = get_scoring_matrix(attack.attack_type, attack_succeeded)
    
    # Find matching tier
    tier = scoring_matrix.get((action.type, target_correct))
    
    if not tier:
        # Default: ineffective action
        return ActionEvaluation(
            action_id=action.id,
            action_type=action.type,
            target=action.target,
            effectiveness="ineffective",
            points=-2,
            reason=f"{action.type.value} is not effective against {attack.attack_type.value} attack.",
            result="unsuccessful_mitigation"
        )
    
    return ActionEvaluation(
        action_id=action.id,
        action_type=action.type,
        target=action.target,
        effectiveness=tier["effectiveness"],
        points=tier["points"],
        reason=tier["reason"],
        result=tier["result"]
    )


def resolve_outcome_tiered(
    attack: Attack,
    blue_actions: List[BlueAction],
    posture: Dict[str, Any],
    clock: float,
    alerts: List[Alert],
    attack_instance: Optional[AttackInstance] = None,
) -> Dict[str, Any]:
    """New tiered resolution logic with explicit attack success tracking."""
    
    # Determine if attack has succeeded
    attack_succeeded, success_indicators = determine_attack_success(attack, alerts)
    
    print(f"[RESOLVER] Attack {attack.id} success state: {attack_succeeded}, indicators: {success_indicators}")
    
    # Evaluate each action
    action_evaluations = []
    total_blue_points = 0
    
    for action in blue_actions:
        evaluation = evaluate_action_tiered(action, attack, attack_succeeded, alerts)
        action_evaluations.append(evaluation)
        total_blue_points += evaluation.points
        print(f"[RESOLVER] Action {action.id}: {evaluation.effectiveness}, {evaluation.points} points - {evaluation.reason}")
    
    # Determine overall result
    optimal_actions = [e for e in action_evaluations if e.effectiveness == "optimal"]
    effective_actions = [e for e in action_evaluations if e.effectiveness == "effective"]
    
    if optimal_actions:
        overall_result = "successful_block"
    elif effective_actions:
        overall_result = "successful_mitigation"
    elif any(e.points > 0 for e in action_evaluations):
        overall_result = "unsuccessful_mitigation"
    elif not blue_actions:
        overall_result = "hit"  # No actions taken, attack succeeded
    else:
        # All actions were ineffective or wrong
        overall_result = "unsuccessful_block"
    
    # Red team scoring
    # Note: Attack choice points (+3 correct, -2 wrong) are already awarded when attack is launched
    # Scan choice points (+2 correct, -1 wrong) are already awarded when scan is completed
    # Here we only award points for successful attack execution
    red_points = 0
    if attack_succeeded and overall_result in ["hit", "unsuccessful_block", "unsuccessful_mitigation"]:
        # Red gets points only if attack succeeded and wasn't effectively contained
        # These are execution points, separate from choice points
        if attack.attack_type == AttackType.RCE:
            red_points = 10
        elif attack.attack_type == AttackType.SQLI:
            red_points = 8
        elif attack.attack_type == AttackType.BRUTEFORCE:
            red_points = 5
        elif attack.attack_type == AttackType.PHISHING:
            red_points = 3
        elif attack.attack_type == AttackType.LATERALMOVE:
            red_points = 3
        elif attack.attack_type == AttackType.EXFIL:
            red_points = 5
    
    print(f"[RESOLVER] Final result: {overall_result}, red execution points: {red_points}, blue: {total_blue_points}")
    
    return {
        "result": overall_result,
        "attack_succeeded": attack_succeeded,
        "success_indicators": success_indicators,
        "score_deltas": {"red": red_points, "blue": total_blue_points},
        "action_evaluations": [e.model_dump() for e in action_evaluations],
        "emitted_alerts": [a.model_dump() if hasattr(a, 'model_dump') else a for a in alerts],
    }


def resolve_outcome(
    attack: Attack,
    blue_actions: List[BlueAction],
    posture: Dict[str, Any],
    clock: float,
    attack_instance: Optional[AttackInstance] = None,
    alerts: Optional[List[Alert]] = None,
) -> Dict[str, Any]:
    """
    Main resolution function with feature flag routing.
    
    Now uses tiered resolution by default (unless FEATURE_TIMELINE_SLA is True).
    """
    # Use tiered resolution if we have alerts
    if alerts:
        try:
            return resolve_outcome_tiered(attack, blue_actions, posture, clock, alerts, attack_instance)
        except Exception as e:
            print(f"[RESOLVER] Tiered resolution failed, falling back to legacy: {e}")
            return resolve_outcome_legacy(attack, blue_actions, posture, clock)
    
    # Fallback to SLA-aware or legacy
    if settings.FEATURE_TIMELINE_SLA and attack_instance:
        try:
            return resolve_outcome_with_sla(attack, blue_actions, posture, clock, attack_instance)
        except Exception as e:
            print(f"[RESOLVER] SLA resolution failed, falling back to legacy: {e}")
            return resolve_outcome_legacy(attack, blue_actions, posture, clock)
    else:
        # Legacy path (default fallback)
        return resolve_outcome_legacy(attack, blue_actions, posture, clock)


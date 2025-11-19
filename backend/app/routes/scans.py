"""Scan routes for reconnaissance phase."""
from fastapi import APIRouter, HTTPException
from app.models import ScanRequest, ScanResult, ScanToolType, EventKind, GameStatus
from app.routes import game
from app.routes.scenarios import scenarios_cache
from app.ws import broadcaster, create_event
from app.settings import settings
from datetime import datetime
import uuid

router = APIRouter(prefix="/api/scans", tags=["scans"])


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
    
    # Update game state
    # Store the enum value (string) to ensure proper serialization
    game_state.red_scan_completed = True
    game_state.red_scan_tool = request.tool  # This is a ScanToolType enum, Pydantic will serialize it as the string value
    game_state.red_scan_success = is_correct_tool
    
    print(f"[SCAN] Updated game state: red_scan_completed={game_state.red_scan_completed}, red_scan_tool={game_state.red_scan_tool}, red_scan_success={game_state.red_scan_success}")
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
        from app.ws import broadcaster, create_event
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
    
    print(f"[SCAN] Scan completed: tool={request.tool}, success={is_correct_tool}, points={scan_points}")
    
    # Emit scan_completed event
    scan_event = create_event(
        EventKind.SCAN_COMPLETED,
        {
            "scan_id": scan_id,
            "tool": request.tool.value,
            "target_node": request.target_node,
            "success": is_correct_tool,
            "scenario_id": request.scenario_id,
            "points": scan_points,
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
    """Get user-friendly message about scan results."""
    if is_correct:
        if tool == ScanToolType.OWASP_ZAP:
            # Check if scenario has specific vulnerability info
            if scenario and scenario.scan_artifacts and tool.value in scenario.scan_artifacts:
                vuln = scenario.scan_artifacts[tool.value].get("vulnerability", "vulnerability")
                return f"Vulnerability identified! {vuln} detected."
            return "Vulnerability identified! Critical web application vulnerability detected."
        elif tool == ScanToolType.NMAP:
            if scenario and scenario.scan_artifacts and tool.value in scenario.scan_artifacts:
                vuln = scenario.scan_artifacts[tool.value].get("vulnerability", "vulnerability")
                return f"Vulnerability identified! {vuln} detected."
            return "Vulnerability identified! Network vulnerability detected."
        elif tool == ScanToolType.SQLMAP:
            if scenario and scenario.scan_artifacts and tool.value in scenario.scan_artifacts:
                vuln = scenario.scan_artifacts[tool.value].get("vulnerability", "SQL Injection")
                return f"Vulnerability identified! {vuln} detected."
            return "Vulnerability identified! SQL Injection detected."
        elif tool == ScanToolType.NIKTO:
            if scenario and scenario.scan_artifacts and tool.value in scenario.scan_artifacts:
                vuln = scenario.scan_artifacts[tool.value].get("vulnerability", "vulnerability")
                return f"Vulnerability identified! {vuln} detected."
            return "Vulnerability identified! Web server vulnerability detected."
        elif tool == ScanToolType.HAVEIBEENPWNED:
            if scenario and scenario.scan_artifacts and tool.value in scenario.scan_artifacts:
                breach_data = scenario.scan_artifacts[tool.value].get("breach_data", "breach data")
                return f"Breach data identified! {breach_data}."
            return "Breach data identified! Corporate email addresses found in data breaches."
        return f"{tool.value} scan complete. Critical vulnerability identified!"
    else:
        if tool == ScanToolType.NMAP:
            return "Network scan complete. Open ports identified, but no application-level vulnerabilities detected."
        elif tool == ScanToolType.SQLMAP:
            return "SQL injection scan complete. No SQL injection vulnerabilities detected on this endpoint."
        elif tool == ScanToolType.NIKTO:
            return "Web server scan complete. Some minor issues detected, but no critical vulnerabilities found."
        return f"{tool.value} scan complete. No critical vulnerabilities identified."


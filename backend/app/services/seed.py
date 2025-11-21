"""Seed data loader."""
import json
from pathlib import Path
from typing import Dict, Any
from app.models import (
    Scenario,
    Topology,
    Node,
    NodeType,
    Coord,
    Link,
    Attack,
    AttackType,
    Hint,
    ScanToolType,
)

# Optional yaml import (only needed if YAML files are used)
try:
    import yaml
    HAS_YAML = True
except ImportError:
    HAS_YAML = False


def load_scenarios_from_yaml(yaml_path: str) -> Dict[str, Scenario]:
    """Load scenarios from YAML file."""
    if not HAS_YAML:
        # If yaml is not available, fall back to default scenarios
        return create_default_scenarios()
    
    path = Path(yaml_path)
    
    if not path.exists():
        # Create default scenarios programmatically
        return create_default_scenarios()
    
    with open(path, "r") as f:
        data = yaml.safe_load(f)
    
    scenarios = {}
    for scenario_data in data.get("scenarios", []):
        scenario = parse_scenario(scenario_data)
        scenarios[scenario.id] = scenario
    
    return scenarios


def parse_scenario(data: Dict[str, Any]) -> Scenario:
    """Parse a scenario dict into Scenario model."""
    # Parse topology
    nodes = []
    for node_data in data.get("topology", {}).get("nodes", []):
        nodes.append(Node(
            id=node_data["id"],
            type=NodeType(node_data["type"]),
            label=node_data["label"],
            coords=Coord(**node_data["coords"]),
            metadata=node_data.get("metadata", {}),
        ))
    
    links = []
    for link_data in data.get("topology", {}).get("links", []):
        links.append(Link(
            from_id=link_data["from"],
            to_id=link_data["to"],
            metadata=link_data.get("metadata", {}),
        ))
    
    topology = Topology(nodes=nodes, links=links)
    
    # Parse attacks
    attacks = []
    for attack_data in data.get("attacks", []):
        attacks.append(Attack(
            id=attack_data["id"],
            attack_type=AttackType(attack_data["attack_type"]),
            from_node=attack_data["from"],
            to_node=attack_data["to"],
            preconditions=attack_data.get("preconditions", []),
            success_prob_modifiers=attack_data.get("success_prob_modifiers", {}),
            effects=attack_data.get("effects", {}),
        ))
    
    # Parse hints
    hints = []
    for hint_data in data.get("hint_deck", []):
        hints.append(Hint(
            step=hint_data["step"],
            text=hint_data["text"],
            unlock_at=hint_data["unlock_at"],
        ))
    
    return Scenario(
        id=data["id"],
        name=data["name"],
        description=data["description"],
        topology=topology,
        initial_posture=data.get("initial_posture", {}),
        artifacts=data.get("artifacts", {}),
        attacks=attacks,
        hint_deck=hints,
    )


def create_default_scenarios() -> Dict[str, Scenario]:
    """Create default scenarios programmatically."""
    scenarios = {}
    
    # Scenario 1: NH360 SharePoint - CVE-2025-53770 RCE
    scenarios["scenario-1"] = Scenario(
        id="scenario-1",
        name="NH360 SharePoint — CVE-2025-53770",
        description="Exploitation of CVE-2025-53770 (SharePoint RCE) in NH360 SharePoint Server. Attacker exploits deserialization vulnerability to gain remote code execution, then establishes persistence and attempts data exfiltration.",
        red_briefing={
            "cyrillicText": "МИССИЯ: Проникновение в SharePoint сервер NH360\nЦЕЛЬ: SharePoint сервер (sharepoint-1)\nЗАДАЧА: Получить удаленное выполнение кода\n\nИНТЕЛЛЕКТУАЛЬНАЯ ИНФОРМАЦИЯ:\n- Обнаружен SharePoint Server 2019\n- WAF в разрешительном режиме\n- Отсутствует защита EDR\n- Десериализация недоверенных данных включена\n\nФАЗА 1: Разведка\n- Провести разведку инфраструктуры\n- Идентифицировать уязвимости и векторы атаки\n- Выбрать подходящие инструменты сканирования\n\nФАЗА 2: Эксплуатация\n- Выбрать наиболее эффективный вектор атаки\n- Эксплуатировать обнаруженные уязвимости\n- Установить постоянный доступ",
            "englishText": "MISSION: Penetrate NH360 SharePoint Server\nTARGET: SharePoint Server (sharepoint-1)\nOBJECTIVE: Gain Remote Code Execution\n\nINTEL:\n- SharePoint Server 2019 detected\n- WAF in permissive mode\n- No EDR protection\n- Untrusted data deserialization enabled\n\nPHASE 1: Reconnaissance\n- Conduct infrastructure reconnaissance\n- Identify vulnerabilities and attack vectors\n- Select appropriate scanning tools\n\nPHASE 2: Exploitation\n- Choose the most effective attack vector\n- Exploit identified vulnerabilities\n- Establish persistence and maintain access",
            "targetInfo": "Target: sharepoint-1 (NH360 SharePoint Server)\nInfrastructure: WAF → SharePoint Server → Database\nSharePoint Version: 2019 (Unpatched)\nSecurity Posture: WAF permissive, no EDR, deserialization enabled",
            "objectives": [
                "Turn 1: Conduct reconnaissance to identify attack surface and vulnerabilities",
                "Turn 2: Select and execute appropriate attack vector to gain RCE",
                "Turn 3: Establish persistence and maintain access"
            ],
            "phasedObjectives": {
                "turn_1": "Reconnaissance - Scan infrastructure, identify vulnerabilities, select scanning tools",
                "turn_2": "Exploitation - Launch attack to gain remote code execution",
                "turn_3": "Persistence - Establish command and control, create backdoors",
                "turn_4": "Pivot Strategy - Assess attack success, choose next move (lateral movement, alternative attack, or persistence verification)"
            }
        },
        blue_briefing={
            "alertLevel": "CRITICAL",
            "threatSummary": "Intelligence indicates active exploitation of CVE-2025-53770 targeting NH360 SharePoint infrastructure. Threat actors are exploiting deserialization vulnerabilities to gain unauthenticated remote code execution and establish persistence.",
            "context": "NH360 SharePoint Server 2019 running unpatched version vulnerable to CVE-2025-53770. WAF in permissive mode due to false positives from SharePoint application. No EDR on SharePoint servers. Untrusted data deserialization enabled. Active exploitation observed in the wild.",
            "initialIndicators": [
                "SharePoint Server 2019 detected on sharepoint-1",
                "WAF configured in permissive mode",
                "No EDR coverage on SharePoint servers",
                "Untrusted data deserialization enabled",
                "Known CVE-2025-53770 (SharePoint RCE) applicable and actively exploited"
            ],
            "recommendedActions": [
                "Turn 1: Monitor WAF logs for suspicious POST requests to SharePoint endpoints with serialized payloads",
                "Turn 2: Watch for command execution patterns in process trees (w3wp.exe spawning cmd.exe or powershell.exe)",
                "Turn 3: Alert on outbound network connections from sharepoint-1 to external IPs, isolate compromised host if exploitation detected"
            ],
            "phasedActions": {
                "turn_1": "Monitor and detect - Watch WAF logs, scan for suspicious activity, establish baseline",
                "turn_2": "Respond and contain - Block attacks, investigate alerts, begin containment procedures",
                "turn_3": "Remediate and harden - Isolate compromised systems, remove persistence, patch vulnerabilities",
                "turn_4": "Post-incident investigation - Determine if attack succeeded, identify compromised systems, check for persistence mechanisms"
            }
        },
        topology=Topology(
            nodes=[
                Node(id="internet", type=NodeType.INTERNET, label="Internet", coords=Coord(x=50, y=200)),
                Node(id="waf-1", type=NodeType.WAF, label="WAF", coords=Coord(x=200, y=200)),
                Node(id="sharepoint-1", type=NodeType.WEB, label="SharePoint Server", coords=Coord(x=350, y=200)),
                Node(id="db-1", type=NodeType.DB, label="Database", coords=Coord(x=500, y=200)),
            ],
            links=[
                Link(from_id="internet", to_id="waf-1"),
                Link(from_id="waf-1", to_id="sharepoint-1"),
                Link(from_id="sharepoint-1", to_id="db-1"),
            ],
        ),
        initial_posture={
            "waf_mode": "permissive",
            "edr": False,
            "context": "NH360 SharePoint Server 2019 running unpatched version vulnerable to CVE-2025-53770. WAF in permissive mode due to false positives from SharePoint application. No EDR on SharePoint servers. Untrusted data deserialization enabled. Active exploitation observed in the wild."
        },
        artifacts={
            "nmap": "PORT     STATE SERVICE\n80/tcp   open  http\n443/tcp  open  https\n1433/tcp filtered mssql",
            "zap": "Microsoft SharePoint Server 2019 detected\nVulnerability: CVE-2025-53770 (SharePoint RCE via Deserialization)\nConfidence: High\nPath: /_api/* endpoints\nMethod: POST\nDeserialization: Untrusted data deserialization enabled",
            "web_logs": "2025-01-15 10:23:45 POST /_api/web HTTP/1.1 200\nUser-Agent: Mozilla/5.0 (compatible; Scanner/1.0)\nPayload: Serialized malicious object detected\nIP: 198.51.100.7\nReferer: https://sharepoint.nh360.com/",
            "process_tree": "PID 1234: w3wp.exe (parent)\n  └─ PID 5678: cmd.exe /c 'powershell -enc <base64>'\n  └─ PID 5679: powershell.exe\n  └─ PID 5680: netcat.exe\nUser: SHAREPOINT\\sp_service\nWorking Dir: C:\\Program Files\\Common Files\\Microsoft Shared\\Web Server Extensions\\16",
            "network_conns": "sharepoint-1:44323 → 198.51.100.7:4444 (ESTABLISHED)\nProtocol: TCP\nDuration: 300s\nProcess: powershell.exe\nDirection: Outbound",
            "file_system": "New file: C:\\Program Files\\Common Files\\Microsoft Shared\\Web Server Extensions\\16\\TEMPLATE\\LAYOUTS\\backdoor.aspx\nCreated: 2025-01-15 10:24:12\nSize: 3.2KB\nMD5: a1b2c3d4e5f6789012345678901234ab\nPermissions: 644\nOwner: SHAREPOINT\\sp_service",
        },
        required_scan_tool=ScanToolType.OWASP_ZAP,  # Correct scan tool for this scenario
        scan_artifacts={
            ScanToolType.OWASP_ZAP.value: {
                "server": "Microsoft-IIS/10.0",
                "application": "SharePoint Server 2019",
                "endpoints": "/_api/web, /_api/site, /_api/contextinfo",
                "methods": "POST, GET",
                "findings": "API endpoints accept complex data structures. Object serialization functionality detected in REST API endpoints.",
                "configuration": "SharePoint Server 2019 with REST API endpoints accepting structured data payloads",
                "zap": "Microsoft SharePoint Server 2019 detected\nApplication: SharePoint Server 2019\nEndpoints: /_api/web, /_api/site, /_api/contextinfo\nMethods: POST, GET\nConfiguration: API endpoints accept complex data structures\nNote: Object serialization functionality detected in API calls\nStatus: Review API endpoint data handling"
            },
            ScanToolType.NMAP.value: {
                "ports": "80/tcp open http, 443/tcp open https, 1433/tcp filtered mssql, 8080/tcp open http-proxy",
                "service_detection": "Microsoft-IIS/10.0, SharePoint Server 2019, Proxy service on 8080",
                "findings": "Proxy service detected on non-standard port. Potential unauthorized access vector through proxy configuration.",
                "target": "sharepoint-1:8080",
                "configuration": "Proxy service on port 8080 may allow traffic forwarding and potential bypass of security controls",
                "nmap": "PORT     STATE SERVICE\n80/tcp   open  http\n443/tcp  open  https\n1433/tcp filtered mssql\n8080/tcp open  http-proxy\n\nService: Microsoft-IIS/10.0, SharePoint Server 2019\nProxy detected on port 8080\nNote: Proxy service may allow unauthorized access\nConfiguration: Non-standard proxy port configuration detected\nStatus: Review proxy service security posture"
            },
            ScanToolType.SQLMAP.value: {
                "target": "/_api/web/lists?$filter=Title eq 'test'",
                "sql_injection": "Not detected in primary endpoints",
                "database": "SQL Server (parameterized queries)",
                "findings": "Primary API endpoints use parameterized queries. Legacy endpoints may have different security posture.",
                "configuration": "Modern endpoints secured, but legacy API paths may have different query handling",
                "sqlmap": "Target: /_api/web/lists?$filter=Title eq 'test'\nSQL Injection: Not detected in primary endpoints\nDatabase: SQL Server\nNote: Modern endpoints use parameterized queries\nConfiguration: Legacy endpoints may have different security posture\nStatus: Further investigation of legacy endpoints recommended"
            },
            ScanToolType.NIKTO.value: {
                "server": "Microsoft-IIS/10.0",
                "application": "SharePoint Server 2019",
                "target": "/",
                "findings": "SharePoint Server 2019 detected with standard configuration",
                "configuration": "Standard SharePoint Server 2019 installation detected",
                "nikto": "Microsoft-IIS/10.0 detected\nSharePoint Server 2019\nTarget: /\nConfiguration: Standard SharePoint installation\nNote: Review server configuration and patch status\nStatus: Standard SharePoint deployment detected"
            },
        },
        attacks=[
            Attack(
                id="atk-rce-1",
                attack_type=AttackType.RCE,
                from_node="internet",
                to_node="sharepoint-1",
                preconditions=[],
                effects={
                    "alerts": 4,
                    "impact": "Web application attack targeting API endpoints. Attempts to exploit data handling mechanisms in REST API.",
                    "indicators": [
                        "Process spawn: cmd.exe/powershell.exe spawned by w3wp.exe",
                        "Network connection: sharepoint-1 → 198.51.100.7:4444 (reverse shell)",
                        "File system: backdoor.aspx created in SharePoint LAYOUTS directory",
                        "Log entries: POST /_api/web with malicious serialized payload"
                    ]
                },
                is_correct_choice=True,  # RCE is the correct attack for this scenario
                requires_scan=True,  # Requires scan first
                required_scan_tool=ScanToolType.OWASP_ZAP,  # Must use ZAP
            ),
            Attack(
                id="atk-sqli-1",
                attack_type=AttackType.SQLI,
                from_node="internet",
                to_node="sharepoint-1",
                preconditions=[],
                effects={
                    "alerts": 2,
                    "impact": "Database interaction attack targeting query endpoints. Attempts to manipulate database queries through API parameters.",
                    "indicators": [
                        "Database query anomalies detected",
                        "SQL injection attempt blocked by parameterized queries",
                        "Attack unsuccessful: No data exfiltration"
                    ]
                },
                is_correct_choice=False,  # SQLi is incorrect for RCE scenario
                requires_scan=True,
                required_scan_tool=ScanToolType.SQLMAP,  # Must use SQLMAP
            ),
            Attack(
                id="atk-network-1",
                attack_type=AttackType.LATERALMOVE,
                from_node="internet",
                to_node="sharepoint-1",
                preconditions=[],
                effects={
                    "alerts": 3,
                    "impact": "Network-based attack targeting proxy services. Attempts to bypass security controls through non-standard ports.",
                    "indicators": [
                        "Unauthorized proxy access on port 8080",
                        "Network traffic anomalies",
                        "Bypass detected through proxy service"
                    ]
                },
                is_correct_choice=False,  # Network attack is incorrect for RCE scenario
                requires_scan=True,
                required_scan_tool=ScanToolType.NMAP,  # Must use NMAP
            ),
            Attack(
                id="atk-brute-1",
                attack_type=AttackType.BRUTEFORCE,
                from_node="internet",
                to_node="sharepoint-1",
                preconditions=[],
                effects={
                    "alerts": 2,
                    "impact": "Authentication attack targeting login endpoints. Attempts to gain access through credential enumeration.",
                    "indicators": [
                        "Multiple failed login attempts detected",
                        "Rate limiting triggered",
                        "Attack unsuccessful: No valid credentials found"
                    ]
                },
                is_correct_choice=False,  # Bruteforce is incorrect
            ),
        ],
        hint_deck=[
            Hint(step=1, text="Check WAF logs for suspicious POST requests to /_api/* endpoints with serialized payloads.", unlock_at=30),
            Hint(step=2, text="Correlate outbound network connections from sharepoint-1 with process spawn events (w3wp.exe spawning cmd.exe or powershell.exe).", unlock_at=120),
            Hint(step=3, text="Review SharePoint logs for deserialization errors or unexpected .aspx files in LAYOUTS directory.", unlock_at=180),
        ],
        max_turns_per_side=4,  # Four 5-minute turns per side
    )
    
    # Scenario 2: Phishing to Endpoint
    scenarios["scenario-2"] = Scenario(
        id="scenario-2",
        name="Phishing to Endpoint — Macro Dropper",
        description="Initial compromise via email, C2 beacon, and lateral movement. Attacker sends malicious email with macro-enabled document to gain initial access to endpoint.",
        red_briefing={
            "cyrillicText": "МИССИЯ: Компрометация корпоративной сети\nЦЕЛЬ: Конечная точка пользователя (endpoint-1)\nЗАДАЧА: Получить начальный доступ\n\nИНТЕЛЛЕКТУАЛЬНАЯ ИНФОРМАЦИЯ:\n- Обнаружен почтовый шлюз с базовой фильтрацией\n- EDR установлен, но может быть обойден\n- Пользователи открывают вложения из внешних источников\n- Active Directory доступна с endpoint\n- Корпоративные email адреса могут быть скомпрометированы\n\nФАЗА 1: Разведка\n- Исследовать корпоративную инфраструктуру\n- Проверить историю утечек данных\n- Проанализировать почтовую систему\n- Идентифицировать векторы атаки\n\nФАЗА 2: Эксплуатация\n- Выбрать наиболее эффективный метод компрометации\n- Использовать социальную инженерию при необходимости\n- Получить начальный доступ к endpoint\n- Установить постоянное соединение",
            "englishText": "MISSION: Compromise Corporate Network\nTARGET: User Endpoint (endpoint-1)\nOBJECTIVE: Gain Initial Access\n\nINTEL:\n- Mail gateway detected with basic filtering\n- EDR installed but may be bypassed\n- Users open attachments from external sources\n- Active Directory accessible from endpoint\n- Corporate email addresses may be compromised in data breaches\n\nPHASE 1: Reconnaissance\n- Research corporate infrastructure and email systems\n- Check for historical data breaches affecting target organization\n- Analyze mail gateway and filtering capabilities\n- Identify potential attack vectors and user behavior patterns\n\nPHASE 2: Exploitation\n- Select the most effective compromise method\n- Leverage social engineering if applicable\n- Gain initial access to endpoint\n- Establish command and control beacon",
            "targetInfo": "Target: endpoint-1 (User Endpoint)\nInfrastructure: Internet → Mail Gateway → Endpoint → Active Directory\nSecurity Posture: Basic email filtering, EDR present, macro execution enabled\nThreat Landscape: Historical data breaches may have exposed corporate credentials",
            "objectives": [
                "Conduct reconnaissance on corporate infrastructure",
                "Research historical data breaches affecting target",
                "Analyze email delivery and filtering mechanisms",
                "Identify and exploit initial access vector",
                "Establish persistent command and control",
                "Maintain access and prepare for lateral movement"
            ]
        },
        blue_briefing={
            "alertLevel": "CLASSIFIED",
            "threatSummary": "Intelligence indicates potential threat activity targeting corporate email infrastructure. Threat actors may attempt to gain initial access to endpoints through various attack vectors and establish persistence.",
            "context": "Mail gateway configured with basic filtering. EDR installed on endpoints but may not detect all attack vectors. Users have a history of opening attachments from external senders. Historical data breaches may have exposed corporate email credentials. Active Directory accessible from compromised endpoints.",
            "initialIndicators": [
                "Mail gateway with basic filtering configuration",
                "EDR installed but detection capabilities may be limited",
                "Email web portal accessible from internet",
                "Users frequently open attachments from external senders",
                "Corporate email domain appears in historical data breach databases",
                "Known threat patterns targeting corporate email infrastructure"
            ],
            "recommendedActions": [
                "Monitor email gateway logs for suspicious attachments and delivery patterns",
                "Watch for suspicious process execution events in EDR on endpoint-1",
                "Alert on outbound network connections from endpoint-1 to external IPs",
                "Monitor Active Directory for unusual authentication attempts from endpoint-1",
                "Review historical data breach exposure for corporate email domain",
                "Isolate compromised endpoint immediately if suspicious activity detected"
            ]
        },
        topology=Topology(
            nodes=[
                Node(id="internet", type=NodeType.INTERNET, label="Internet", coords=Coord(x=50, y=200)),
                Node(id="mail-gw", type=NodeType.FIREWALL, label="Mail Gateway", coords=Coord(x=200, y=100)),
                Node(id="endpoint-1", type=NodeType.ENDPOINT, label="User Endpoint", coords=Coord(x=350, y=100)),
                Node(id="ad-1", type=NodeType.AD, label="Active Directory", coords=Coord(x=500, y=200)),
            ],
            links=[
                Link(from_id="internet", to_id="mail-gw"),
                Link(from_id="mail-gw", to_id="endpoint-1"),
                Link(from_id="endpoint-1", to_id="ad-1"),
            ],
        ),
        initial_posture={
            "edr": True, 
            "mail_filter": "basic",
            "context": "Corporate email infrastructure with basic filtering. EDR installed on endpoints but may not detect all attack vectors. Users have history of opening attachments. Historical data breaches may have exposed corporate email credentials."
        },
        artifacts={
            "nmap": "No external ports open",
            "email": "Suspicious attachment: invoice.docm from unknown.sender@example.com",
            "breach_data": "Corporate domain appears in multiple historical data breaches",
            "webmail": "Email web portal accessible at /webmail",
        },
        required_scan_tool=ScanToolType.HAVEIBEENPWNED,  # Correct scan tool for phishing scenario
        scan_artifacts={
            ScanToolType.HAVEIBEENPWNED.value: {
                "breach_data": "Multiple corporate email addresses found in data breaches",
                "severity": "Medium",
                "target": "Corporate email domain",
                "breaches": "LinkedIn (2012), Adobe (2013), Dropbox (2012), Yahoo (2013-2014)",
                "confidence": "High",
                "recommendation": "Corporate email addresses exposed in historical breaches. Credentials may be reused or compromised. Phishing campaigns targeting exposed accounts may have higher success rates.",
                "haveibeenpwned": "Domain: example.com\nBreaches found: 4\nTotal accounts exposed: 1,247\n\nBreach Details:\n- LinkedIn (2012): 542 accounts\n- Adobe (2013): 312 accounts\n- Dropbox (2012): 289 accounts\n- Yahoo (2013-2014): 104 accounts\n\nRisk: High probability of credential reuse. Phishing campaigns targeting exposed accounts likely to succeed."
            },
            ScanToolType.OWASP_ZAP.value: {
                "vulnerability": "Email Portal Weak Authentication & Attachment Filtering",
                "severity": "High",
                "target": "/webmail/login.php",
                "email_system": "Microsoft Exchange 2016",
                "confidence": "High",
                "recommendation": "Email portal may be vulnerable to credential harvesting. Macro attachments (.docm, .xlsm) are allowed through filtering.",
                "zap": "Microsoft Exchange 2016 detected on /webmail/login.php\nVulnerability: Weak email filtering, macro attachments (.docm, .xlsm) allowed\nConfidence: High\nPath: /webmail/login.php\nMethod: POST\nAttachment delivery: Enabled\nMacro execution: Not blocked\n\nNote: This is informational only - not linked to any attack."
            },
            ScanToolType.NIKTO.value: {
                "server": "Microsoft Exchange 2016",
                "vulnerability": "Email web portal detected",
                "severity": "Informational",
                "target": "/webmail",
                "issues": "Microsoft Exchange 2016 webmail portal accessible",
                "confidence": "High",
                "recommendation": "Email web portal detected. May be useful for credential harvesting or social engineering attacks.",
                "nikto": "Microsoft Exchange 2016 detected\nWebmail portal: /webmail\nTarget: /webmail/login.php\nNote: Email portal accessible from internet\n\nNote: This is informational only - not linked to any attack."
            },
            ScanToolType.NMAP.value: {
                "ports": "25/tcp open smtp, 587/tcp open submission, 993/tcp open imaps, 143/tcp open imap",
                "service_detection": "Postfix 3.4.8, Microsoft Exchange 2016",
                "vulnerability": "Email services exposed but authentication required",
                "severity": "Low",
                "target": "mail-gw:25,587,993,143",
                "confidence": "High",
                "recommendation": "Email services require authentication. Direct SMTP/IMAP attacks unlikely to succeed.",
                "nmap": "PORT     STATE SERVICE\n25/tcp   open  smtp\n587/tcp  open  submission\n993/tcp  open  imaps\n143/tcp  open  imap\n\nService: Postfix 3.4.8, Microsoft Exchange 2016\nAuthentication: Required for all services\n\nNote: This is informational only - not linked to any attack."
            },
            ScanToolType.SQLMAP.value: {
                "target": "/webmail/api/user.php?email=test@example.com",
                "sql_injection": "Not detected",
                "vulnerability": "No SQL injection vulnerabilities found",
                "severity": "None",
                "database": "N/A",
                "confidence": "High",
                "recommendation": "Email portal API does not appear vulnerable to SQL injection. Focus on email delivery mechanisms.",
                "sqlmap": "Target: /webmail/api/user.php?email=test@example.com\nSQL Injection: Not detected\nDatabase: N/A\nNote: Email portal uses parameterized queries. SQL injection not applicable.\n\nNote: This is informational only - not linked to any attack."
            },
        },
        attacks=[
            Attack(
                id="atk-phish-1",
                attack_type=AttackType.PHISHING,
                from_node="internet",
                to_node="endpoint-1",
                preconditions=[],
                effects={
                    "alerts": 4,
                    "impact": "Phishing attack successful. Macro-enabled document executed on endpoint-1, establishing C2 beacon connection.",
                    "indicators": [
                        "Email gateway: Suspicious attachment delivered (invoice.docm)",
                        "EDR: Macro execution detected on endpoint-1",
                        "Network connection: endpoint-1 → 198.51.100.7:443 (C2 beacon)",
                        "Process: powershell.exe spawned by winword.exe"
                    ]
                },
                is_correct_choice=True,  # Phishing is the correct attack for this scenario
                requires_scan=True,  # Requires scan first
                required_scan_tool=ScanToolType.HAVEIBEENPWNED,  # Must use HaveIBeenPwned
            ),
            Attack(
                id="atk-brute-email-1",
                attack_type=AttackType.BRUTEFORCE,
                from_node="internet",
                to_node="mail-gw",
                preconditions=[],
                effects={
                    "alerts": 2,
                    "impact": "Brute force attack on email credentials. Multiple failed login attempts detected.",
                    "indicators": [
                        "Email gateway: Multiple failed authentication attempts",
                        "Brute force pattern: 100+ login attempts from single IP",
                        "Attack blocked: Account lockout triggered"
                    ]
                },
                is_correct_choice=False,  # Brute force is incorrect for phishing scenario
            ),
            Attack(
                id="atk-lateral-email-1",
                attack_type=AttackType.LATERALMOVE,
                from_node="internet",
                to_node="endpoint-1",
                preconditions=[],
                effects={
                    "alerts": 2,
                    "impact": "Lateral movement attempt via email portal. Attack blocked by authentication requirements.",
                    "indicators": [
                        "Email portal: Unauthorized access attempt detected",
                        "Authentication: Failed login attempts from external IP",
                        "Attack blocked: Strong authentication in place"
                    ]
                },
                is_correct_choice=False,  # Lateral move is incorrect for phishing scenario
            ),
        ],
        hint_deck=[
            Hint(step=1, text="Check email gateway logs for suspicious attachments.", unlock_at=30),
            Hint(step=2, text="EDR should show macro execution on endpoint-1.", unlock_at=90),
            Hint(step=3, text="Monitor AD for privilege escalation attempts.", unlock_at=180),
        ],
    )
    
    return scenarios


"""Alert generation with rules and noise."""
import random
from typing import List, Dict, Any
from datetime import datetime, timedelta
from app.models import Attack, AttackType, Scenario, Alert


def generate_alerts(
    attack: Attack,
    scenario: Scenario,
    base_time: datetime,
    include_noise: bool = True,
) -> List[Alert]:
    """Generate alerts for an attack with jitter and optional noise."""
    alerts: List[Alert] = []
    
    # Alert templates per attack type
    templates: Dict[AttackType, List[Dict[str, Any]]] = {
        AttackType.RCE: [
            {
                "source": "WAF",
                "severity": "high",
                "summary": "POST request to /plugins/legacy.php with base64-encoded payload",
                "details": "Suspicious POST request detected with base64-encoded command injection payload. User-Agent spoofing detected. Request bypassed WAF signature detection.",
                "confidence": 0.8,
                "ioc": {"url": "/plugins/legacy.php", "method": "POST", "payload_type": "base64-encoded"}
            },
            {
                "source": "IDS",
                "severity": "critical",
                "summary": "Command execution pattern detected: /bin/sh spawned by PHP-FPM",
                "details": "Process 'sh' spawned by PHP-FPM with unusual arguments. Command execution pattern matches known RCE exploit (CVE-2019-11043).",
                "confidence": 0.9,
                "ioc": {"process": "/bin/sh", "parent": "php-fpm", "cve": "CVE-2019-11043"}
            },
            {
                "source": "Proxy",
                "severity": "high",
                "summary": "Outbound network connection from web-1 to external IP on port 4444",
                "details": "Suspicious outbound TCP connection from web-1 (10.0.0.10:44323) to external IP 198.51.100.7:4444. Connection established immediately after suspicious POST request. Likely reverse shell.",
                "confidence": 0.85,
                "ioc": {"src_ip": "10.0.0.10", "dst_ip": "198.51.100.7", "dst_port": 4444, "protocol": "TCP"}
            },
            {
                "source": "EDR",
                "severity": "high",
                "summary": "File system write detected: /tmp/.backdoor.php created",
                "details": "New file created in /tmp/ directory with suspicious name pattern. File contains PHP code with base64-encoded payload. Created by www-data user.",
                "confidence": 0.75,
                "ioc": {"file": "/tmp/.backdoor.php", "user": "www-data", "file_type": "PHP"}
            },
        ],
        AttackType.SQLI: [
            {"source": "WAF", "severity": "medium", "summary": "SQL injection pattern detected", "confidence": 0.9},
            {"source": "DB", "severity": "high", "summary": "Anomalous database query", "confidence": 0.8},
        ],
        AttackType.BRUTEFORCE: [
            {"source": "IDS", "severity": "medium", "summary": "Multiple failed login attempts", "confidence": 0.9},
            {"source": "WAF", "severity": "low", "summary": "Rate limit threshold approached", "confidence": 0.6},
        ],
        AttackType.PHISHING: [
            {"source": "Mail GW", "severity": "medium", "summary": "Suspicious email attachment", "confidence": 0.7},
            {"source": "EDR", "severity": "high", "summary": "Macro execution detected", "confidence": 0.8},
        ],
        AttackType.LATERALMOVE: [
            {"source": "EDR", "severity": "high", "summary": "Lateral movement via RPC", "confidence": 0.8},
            {"source": "AD", "severity": "critical", "summary": "Privilege escalation detected", "confidence": 0.9},
        ],
        AttackType.EXFIL: [
            {"source": "Proxy", "severity": "high", "summary": "Large data transfer to external IP", "confidence": 0.8},
            {"source": "Cloud", "severity": "medium", "summary": "Unauthorized bucket access", "confidence": 0.7},
        ],
    }
    
    # Get templates for this attack type
    attack_templates = templates.get(attack.attack_type, [])
    
    # Generate alerts from templates with realistic timing
    # For RCE attacks, space alerts out more realistically (0s, 2s, 5s, 10s, 15s)
    # For other attacks, use shorter intervals
    timing_intervals = {
        AttackType.RCE: [0, 2, 5, 10, 15],  # More realistic timeline for RCE
        AttackType.SQLI: [0, 1, 3],
        AttackType.BRUTEFORCE: [0, 2, 5],
        AttackType.PHISHING: [0, 3, 8],
        AttackType.LATERALMOVE: [0, 5, 10],
        AttackType.EXFIL: [0, 5, 15],
    }
    
    intervals = timing_intervals.get(attack.attack_type, [0, 1, 2])
    
    # Generate alerts from templates
    for i, template in enumerate(attack_templates):
        # Use realistic timing intervals if available, otherwise use default
        if i < len(intervals):
            base_delay = intervals[i]
        else:
            base_delay = i * 0.5
        
        jitter = random.uniform(0, 1)  # Small jitter (0-1 seconds)
        alert_time = base_time + timedelta(seconds=base_delay + jitter)
        
        # Map hint deck if available (for training mode)
        hint_ref = None
        if scenario.hint_deck and i < len(scenario.hint_deck):
            hint_ref = f"hint-{scenario.hint_deck[i].step}"
        
        # Build IOC dict - merge template IOC with default IOC
        ioc = template.get("ioc", {})
        ioc.update({"ip": "198.51.100.7", "target": attack.to_node})
        
        # Get details - use template details if available, otherwise use default
        details = template.get("details", f"Attack {attack.id} targeting {attack.to_node}")
        
        alert = Alert(
            id=f"alert-{attack.id}-{i}",
            timestamp=alert_time,
            source=template["source"],
            severity=template["severity"],
            summary=template["summary"],
            details=details,
            ioc=ioc,
            confidence=template["confidence"],
            hint_ref=hint_ref,
        )
        alerts.append(alert)
    
    # Add noise (20-30% of alerts)
    if include_noise:
        noise_count = max(1, int(len(alerts) * random.uniform(0.2, 0.3)))
        noise_sources = ["IDS", "WAF", "Proxy", "EDR"]
        noise_severities = ["low", "medium"]
        
        for i in range(noise_count):
            jitter = random.uniform(0, 5)
            noise_time = base_time + timedelta(seconds=jitter)
            
            noise_alert = Alert(
                id=f"noise-{random.randint(1000, 9999)}",
                timestamp=noise_time,
                source=random.choice(noise_sources),
                severity=random.choice(noise_severities),
                summary="Benign traffic anomaly",
                details="False positive alert",
                ioc={},
                confidence=random.uniform(0.3, 0.5),
            )
            alerts.append(noise_alert)
    
    # Sort by timestamp
    alerts.sort(key=lambda a: a.timestamp)
    
    return alerts


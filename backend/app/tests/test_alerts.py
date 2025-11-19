"""Tests for alert generation."""
import pytest
from app.services.alerts import generate_alerts
from app.models import Attack, AttackType, Scenario, Topology, Node, NodeType, Coord


def test_generate_alerts_rce():
    """Test RCE attack generates alerts."""
    attack = Attack(
        id="atk-1",
        attack_type=AttackType.RCE,
        from_node="internet",
        to_node="web-1",
    )
    
    scenario = Scenario(
        id="scenario-1",
        name="Test",
        description="Test scenario",
        topology=Topology(nodes=[], links=[]),
    )
    
    from datetime import datetime
    alerts = generate_alerts(attack, scenario, datetime.utcnow(), include_noise=False)
    
    assert len(alerts) >= 1
    # Check for RCE-specific alert patterns
    assert any(
        "command" in alert.summary.lower() or 
        "rce" in alert.summary.lower() or 
        "post request" in alert.summary.lower() or
        "process spawn" in alert.summary.lower() or
        "network connection" in alert.summary.lower() or
        "file system" in alert.summary.lower()
        for alert in alerts
    )


def test_generate_alerts_with_noise():
    """Test alert generation includes noise."""
    attack = Attack(
        id="atk-1",
        attack_type=AttackType.RCE,
        from_node="internet",
        to_node="web-1",
    )
    
    scenario = Scenario(
        id="scenario-1",
        name="Test",
        description="Test scenario",
        topology=Topology(nodes=[], links=[]),
    )
    
    from datetime import datetime
    alerts = generate_alerts(attack, scenario, datetime.utcnow(), include_noise=True)
    
    # Should have more alerts with noise
    assert len(alerts) >= 2


"""Tests for resolver logic."""
import pytest
from app.services.resolver import resolve_outcome
from app.models import Attack, AttackType, BlueAction, BlueActionType
from datetime import datetime


def test_resolve_rce_success():
    """Test RCE attack succeeds without blocking."""
    attack = Attack(
        id="atk-1",
        attack_type=AttackType.RCE,
        from_node="internet",
        to_node="web-1",
    )
    
    outcome = resolve_outcome(attack, [], {}, 0.0)
    
    assert outcome["result"] == "hit"
    assert outcome["score_deltas"]["red"] == 10


def test_resolve_blocked_by_isolation():
    """Test attack is blocked by host isolation."""
    attack = Attack(
        id="atk-1",
        attack_type=AttackType.RCE,
        from_node="internet",
        to_node="web-1",
    )
    
    action = BlueAction(
        id="action-1",
        type=BlueActionType.ISOLATE_HOST,
        target="web-1",
        note="Isolate compromised host",
        timestamp=datetime.utcnow(),
    )
    
    outcome = resolve_outcome(attack, [action], {}, 0.0)
    
    assert outcome["result"] == "blocked"
    assert outcome["score_deltas"]["blue"] >= 8


def test_attribution_bonus():
    """Test correct attribution gives bonus."""
    attack = Attack(
        id="atk-1",
        attack_type=AttackType.SQLI,
        from_node="internet",
        to_node="web-1",
    )
    
    action = BlueAction(
        id="action-1",
        type=BlueActionType.UPDATE_WAF,
        target="web-1",
        note="SQL injection attack detected",
        timestamp=datetime.utcnow(),
    )
    
    outcome = resolve_outcome(attack, [action], {}, 0.0)
    
    # Should have attribution bonus
    assert outcome["score_deltas"]["blue"] >= 2


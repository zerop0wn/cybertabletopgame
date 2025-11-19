"""Scenario V2 routes (advanced scenarios with multi-step playbooks)."""
from fastapi import APIRouter, HTTPException
from typing import List, Dict
from app.models import ScenarioV2
from app.settings import settings

router = APIRouter(prefix="/api/scenarios/v2", tags=["scenarios-v2"])

# In-memory cache for V2 scenarios (loaded from seed)
scenarios_v2_cache: Dict[str, ScenarioV2] = {}


def load_scenarios_v2():
    """Load V2 scenarios from seed (only if feature flag is enabled)."""
    global scenarios_v2_cache
    
    if not settings.FEATURE_ADV_SCENARIOS:
        scenarios_v2_cache = {}
        return scenarios_v2_cache
    
    try:
        # Import seed function
        from app.services.seed_v2 import create_v2_scenarios
        
        scenarios_v2_cache = create_v2_scenarios()
        return scenarios_v2_cache
    except ImportError as e:
        # If seed_v2 module doesn't exist, return empty dict
        print(f"[scenario_v2] Warning: Could not import seed_v2: {e}")
        scenarios_v2_cache = {}
        return scenarios_v2_cache
    except Exception as e:
        # Handle any other errors gracefully
        print(f"[scenario_v2] Error loading V2 scenarios: {e}")
        scenarios_v2_cache = {}
        return scenarios_v2_cache


# Load scenarios on first access (lazy loading)
def ensure_scenarios_loaded():
    """Ensure scenarios are loaded (lazy initialization)."""
    if not scenarios_v2_cache and settings.FEATURE_ADV_SCENARIOS:
        load_scenarios_v2()


@router.get("")
async def list_scenarios_v2() -> List[Dict]:
    """
    List all available V2 scenarios.
    
    Only available if FEATURE_ADV_SCENARIOS is True.
    """
    if not settings.FEATURE_ADV_SCENARIOS:
        raise HTTPException(
            status_code=501,
            detail="Advanced scenarios are not enabled"
        )
    
    ensure_scenarios_loaded()
    
    return [
        {
            "id": s.id,
            "title": s.title,
            "threat_actor": {
                "name": s.threat_actor.name,
                "synopsis": s.threat_actor.synopsis,
                "tags": s.threat_actor.tags,
            },
            "steps_count": len(s.steps),
            "entry_step": s.entry_step,
        }
        for s in scenarios_v2_cache.values()
    ]


@router.get("/{scenario_id}")
async def get_scenario_v2(scenario_id: str) -> ScenarioV2:
    """
    Get full V2 scenario details.
    
    Only available if FEATURE_ADV_SCENARIOS is True.
    """
    if not settings.FEATURE_ADV_SCENARIOS:
        raise HTTPException(
            status_code=501,
            detail="Advanced scenarios are not enabled"
        )
    
    ensure_scenarios_loaded()
    
    if scenario_id not in scenarios_v2_cache:
        raise HTTPException(status_code=404, detail="Scenario not found")
    
    return scenarios_v2_cache[scenario_id]


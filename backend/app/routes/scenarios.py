"""Scenario routes."""
from fastapi import APIRouter
from typing import List, Dict
from app.models import Scenario
from app.services.seed import create_default_scenarios

router = APIRouter(prefix="/api/scenarios", tags=["scenarios"])

# Load scenarios on module import
scenarios_cache = create_default_scenarios()


@router.get("")
async def list_scenarios() -> List[Dict]:
    """List all available scenarios."""
    
    return [
        {
            "id": s.id,
            "name": s.name,
            "description": s.description,
        }
        for s in scenarios_cache.values()
    ]


@router.get("/{scenario_id}")
async def get_scenario(scenario_id: str) -> Scenario:
    """Get full scenario details."""
    
    if scenario_id not in scenarios_cache:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Scenario not found")
    
    return scenarios_cache[scenario_id]


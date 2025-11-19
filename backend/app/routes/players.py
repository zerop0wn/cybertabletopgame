"""Player name assignment routes."""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from app.services.name_assignment import assign_name, release_name, get_assigned_count
from app.settings import settings

router = APIRouter(prefix="/api/players", tags=["players"])


class AssignNameRequest(BaseModel):
    role: str
    session_id: Optional[str] = None


class AssignNameResponse(BaseModel):
    player_name: str
    role: str
    session_id: Optional[str] = None
    team_size: int
    max_team_size: int


class ReleaseNameRequest(BaseModel):
    player_name: str
    role: str
    session_id: Optional[str] = None


@router.post("/assign-name", response_model=AssignNameResponse)
async def assign_player_name(request: AssignNameRequest) -> AssignNameResponse:
    """
    Assign a name to a player.
    
    Enforces a maximum of 10 players per team.
    """
    if request.role not in ['red', 'blue']:
        raise HTTPException(status_code=400, detail="Invalid role. Must be 'red' or 'blue'")
    
    try:
        assigned_name = assign_name(request.role, request.session_id)
        team_size = get_assigned_count(request.role, request.session_id)
        
        return AssignNameResponse(
            player_name=assigned_name,
            role=request.role,
            session_id=request.session_id,
            team_size=team_size,
            max_team_size=10
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to assign name: {str(e)}")


@router.post("/release-name")
async def release_player_name(request: ReleaseNameRequest) -> dict:
    """
    Release a player name when they disconnect.
    """
    try:
        released = release_name(request.player_name, request.role, request.session_id)
        if not released:
            raise HTTPException(status_code=404, detail="Name not found or already released")
        return {"success": True, "message": f"Name {request.player_name} released"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to release name: {str(e)}")


@router.get("/team-size")
async def get_team_size(role: str, session_id: Optional[str] = None) -> dict:
    """
    Get the current team size for a role.
    """
    if role not in ['red', 'blue']:
        raise HTTPException(status_code=400, detail="Invalid role. Must be 'red' or 'blue'")
    
    team_size = get_assigned_count(role, session_id)
    return {
        "role": role,
        "session_id": session_id,
        "team_size": team_size,
        "max_team_size": 10
    }


"""Voting routes for team decision-making."""
from fastapi import APIRouter, HTTPException
from app.models import VoteRequest, VoteResponse, PlayerChoice, VotingStatus, GameStatus, EventKind
from app.routes.game import game_state
from app.ws import broadcaster, create_event
from app.settings import settings
from datetime import datetime
from typing import Dict, List

router = APIRouter(prefix="/api/voting", tags=["voting"])

# Store player choices and votes per turn
# Structure: {role: {turn_key: {"choices": [...], "votes": {...}}}}
# turn_key = f"{game_state.round}-{game_state.current_turn}"
_voting_data: Dict[str, Dict[str, Dict]] = {
    "red": {},
    "blue": {},
}

# Store player choices separately for easy lookup
_player_choices: Dict[str, Dict[str, PlayerChoice]] = {
    "red": {},  # player_name -> PlayerChoice
    "blue": {},
}


def _get_turn_key() -> str:
    """Get current turn key for voting."""
    if not game_state.current_turn:
        return "unknown"
    return f"{game_state.round}-{game_state.current_turn}"


def _clear_voting_data():
    """Clear voting data when game resets."""
    global _voting_data, _player_choices
    _voting_data = {"red": {}, "blue": {}}
    _player_choices = {"red": {}, "blue": {}}


@router.post("/vote")
async def submit_vote(request: VoteRequest) -> VoteResponse:
    """Submit a vote for a player's choice."""
    global _voting_data, _player_choices
    
    if game_state.status != GameStatus.RUNNING:
        raise HTTPException(
            status_code=400,
            detail="Game is not running. Voting is only available during active games."
        )
    
    if game_state.current_turn != request.role:
        raise HTTPException(
            status_code=400,
            detail=f"It's not {request.role} team's turn. Current turn: {game_state.current_turn}"
        )
    
    turn_key = _get_turn_key()
    role = request.role
    
    # Initialize voting data for this turn if needed
    if turn_key not in _voting_data[role]:
        _voting_data[role][turn_key] = {
            "choices": [],
            "votes": {},
        }
    
    # Check if target player has made a choice
    if request.target_player_name not in _player_choices[role]:
        raise HTTPException(
            status_code=400,
            detail=f"Player {request.target_player_name} has not made a choice yet."
        )
    
    # Initialize votes for this player if needed
    if request.target_player_name not in _voting_data[role][turn_key]["votes"]:
        _voting_data[role][turn_key]["votes"][request.target_player_name] = []
    
    # Check if voter has already voted
    if request.voter_name in _voting_data[role][turn_key]["votes"][request.target_player_name]:
        return VoteResponse(
            success=False,
            message="You have already voted for this player."
        )
    
    # Add vote
    _voting_data[role][turn_key]["votes"][request.target_player_name].append(request.voter_name)
    
    # Emit vote update event to team
    vote_update_event = create_event(
        EventKind.VOTE_UPDATE,
        {
            "role": role,
            "target_player_name": request.target_player_name,
            "voter_name": request.voter_name,
            "vote_count": len(_voting_data[role][turn_key]["votes"][request.target_player_name]),
        },
    )
    await broadcaster.emit_to_role(role, vote_update_event)
    
    return VoteResponse(
        success=True,
        message=f"Vote recorded for {request.target_player_name}"
    )


@router.post("/choice")
async def submit_choice(choice: PlayerChoice) -> VoteResponse:
    """Submit a player's choice for the current turn."""
    global _voting_data, _player_choices
    
    if game_state.status != GameStatus.RUNNING:
        raise HTTPException(
            status_code=400,
            detail="Game is not running. Choices can only be submitted during active games."
        )
    
    if game_state.current_turn != choice.role:
        raise HTTPException(
            status_code=400,
            detail=f"It's not {choice.role} team's turn. Current turn: {game_state.current_turn}"
        )
    
    turn_key = _get_turn_key()
    role = choice.role
    
    # Initialize voting data for this turn if needed
    if turn_key not in _voting_data[role]:
        _voting_data[role][turn_key] = {
            "choices": [],
            "votes": {},
        }
    
    # Update or add player choice
    choice.timestamp = datetime.utcnow()
    _player_choices[role][choice.player_name] = choice
    
    # Update choices list (remove old entry if exists, add new)
    choices_list = _voting_data[role][turn_key]["choices"]
    choices_list = [c for c in choices_list if c.player_name != choice.player_name]
    choices_list.append(choice)
    _voting_data[role][turn_key]["choices"] = choices_list
    
    # Emit vote update event to team (choice added/updated)
    vote_update_event = create_event(
        EventKind.VOTE_UPDATE,
        {
            "role": role,
            "player_name": choice.player_name,
            "choice_updated": True,
            "total_choices": len(choices_list),
        },
    )
    await broadcaster.emit_to_role(role, vote_update_event)
    
    return VoteResponse(
        success=True,
        message="Choice recorded"
    )


@router.get("/status")
async def get_voting_status(role: str) -> VotingStatus:
    """Get current voting status for a role."""
    if role not in ["red", "blue"]:
        raise HTTPException(status_code=400, detail="Role must be 'red' or 'blue'")
    
    if game_state.status != GameStatus.RUNNING:
        return VotingStatus(
            role=role,
            player_choices=[],
            votes={},
            turn_number=None,
        )
    
    turn_key = _get_turn_key()
    
    if turn_key not in _voting_data[role]:
        return VotingStatus(
            role=role,
            player_choices=[],
            votes={},
            turn_number=game_state.round,
        )
    
    voting_info = _voting_data[role][turn_key]
    
    return VotingStatus(
        role=role,
        player_choices=voting_info["choices"],
        votes=voting_info["votes"],
        turn_number=game_state.round,
    )


# Export function to clear voting data (called from game.py on reset)
def clear_voting_data():
    """Clear all voting data."""
    _clear_voting_data()


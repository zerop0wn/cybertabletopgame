"""Name assignment service for automatic player naming."""
from typing import Dict, Set, Optional
from datetime import datetime, timedelta

# Name pools for each team
RED_TEAM_NAMES = [
    "0xDeadBeef",
    "NullPointer",
    "SQLInjector",
    "BufferOverflow",
    "RootAccess",
    "KernelPanic",
    "StackSmash",
    "ShellShock",
    "ZeroDay",
    "PhishMaster",
]

BLUE_TEAM_NAMES = [
    "Commander Data",
    "Agent Scully",
    "Dr. Spock",
    "Major Motoko",
    "Agent Smith",
    "Lt. Ripley",
    "Neo Defender",
    "Captain Picard",
    "Agent Mulder",
    "Dr. Who",
]

# Maximum players per team
MAX_PLAYERS_PER_TEAM = 10

# Track assigned names: {session_id: {role: {player_name: assigned_at}}}
# If session_id is None, it's a global assignment (lobby mode)
_assigned_names: Dict[Optional[str], Dict[str, Dict[str, datetime]]] = {}

# Track name to session/role mapping for cleanup: {player_name: (session_id, role)}
_name_to_session: Dict[str, tuple] = {}


def assign_name(role: str, session_id: Optional[str] = None) -> str:
    """
    Assign a name to a player.
    
    Args:
        role: The player's role ('red' or 'blue')
        session_id: Optional session ID for session-scoped names
        
    Returns:
        Assigned player name
        
    Raises:
        ValueError: If team is full or invalid role
    """
    if role not in ['red', 'blue']:
        raise ValueError(f"Invalid role for name assignment: {role}. Only 'red' and 'blue' are supported.")
    
    # Get the appropriate name pool
    name_pool = RED_TEAM_NAMES if role == 'red' else BLUE_TEAM_NAMES
    
    # Initialize session tracking if needed
    if session_id not in _assigned_names:
        _assigned_names[session_id] = {}
    if role not in _assigned_names[session_id]:
        _assigned_names[session_id][role] = {}
    
    # Check if team is full
    assigned_count = len(_assigned_names[session_id][role])
    if assigned_count >= MAX_PLAYERS_PER_TEAM:
        raise ValueError(f"{role.capitalize()} team is full ({MAX_PLAYERS_PER_TEAM} players max)")
    
    # Find an available name
    assigned_for_role = set(_assigned_names[session_id][role].keys())
    available_names = [name for name in name_pool if name not in assigned_for_role]
    
    if not available_names:
        # All names are taken - this shouldn't happen if MAX_PLAYERS_PER_TEAM <= len(name_pool)
        # But handle it gracefully by recycling the oldest assigned name
        if assigned_for_role:
            # Find the oldest assigned name
            oldest_name = min(
                assigned_for_role,
                key=lambda n: _assigned_names[session_id][role][n]
            )
            # Remove it and reuse
            del _assigned_names[session_id][role][oldest_name]
            if oldest_name in _name_to_session:
                del _name_to_session[oldest_name]
            available_names = [oldest_name]
        else:
            raise ValueError(f"No available names for {role} team")
    
    # Assign the first available name
    assigned_name = available_names[0]
    _assigned_names[session_id][role][assigned_name] = datetime.utcnow()
    _name_to_session[assigned_name] = (session_id, role)
    
    return assigned_name


def release_name(player_name: str, role: str, session_id: Optional[str] = None) -> bool:
    """
    Release a name when a player disconnects.
    
    Args:
        player_name: The name to release
        role: The player's role
        session_id: Optional session ID
        
    Returns:
        True if name was released, False if not found
    """
    # Check if this name is tracked
    if player_name not in _name_to_session:
        return False
    
    stored_session_id, stored_role = _name_to_session[player_name]
    
    # Verify it matches
    if stored_session_id != session_id or stored_role != role:
        return False
    
    # Remove from tracking
    if stored_session_id in _assigned_names:
        if stored_role in _assigned_names[stored_session_id]:
            if player_name in _assigned_names[stored_session_id][stored_role]:
                del _assigned_names[stored_session_id][stored_role][player_name]
                # Clean up empty dicts
                if not _assigned_names[stored_session_id][stored_role]:
                    del _assigned_names[stored_session_id][stored_role]
                if not _assigned_names[stored_session_id]:
                    del _assigned_names[stored_session_id]
    
    del _name_to_session[player_name]
    return True


def get_assigned_count(role: str, session_id: Optional[str] = None) -> int:
    """
    Get the number of currently assigned names for a role.
    
    Args:
        role: The role to check
        session_id: Optional session ID (None means lobby/global mode)
        
    Returns:
        Number of assigned names
    """
    # Handle None session_id (lobby mode) - use None as key
    if session_id not in _assigned_names:
        return 0
    if role not in _assigned_names[session_id]:
        return 0
    return len(_assigned_names[session_id][role])


def clear_session_names(session_id: str) -> None:
    """
    Clear all names for a session (when session ends).
    
    Args:
        session_id: The session ID to clear
    """
    if session_id in _assigned_names:
        # Remove all names from tracking
        for role, names in _assigned_names[session_id].items():
            for name in list(names.keys()):
                if name in _name_to_session:
                    del _name_to_session[name]
        del _assigned_names[session_id]


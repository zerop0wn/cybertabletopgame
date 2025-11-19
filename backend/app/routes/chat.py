"""Chat routes for team communication."""
from fastapi import APIRouter, HTTPException
from app.models import ChatRequest, ChatMessage, GameStatus
from app.routes.game import game_state
from app.ws import broadcaster, create_event
from app.settings import settings
from datetime import datetime
import uuid

router = APIRouter(prefix="/api/chat", tags=["chat"])

# Store recent chat messages (last 100 per role)
_chat_history: dict[str, list[ChatMessage]] = {
    "red": [],
    "blue": [],
    "gm": [],
    "audience": [],
}


@router.post("/send")
async def send_message(request: ChatRequest) -> dict:
    """Send a chat message to the team."""
    if game_state.status != GameStatus.RUNNING and game_state.status != GameStatus.PAUSED:
        raise HTTPException(
            status_code=400,
            detail="Chat is only available during active games."
        )
    
    # Create chat message
    message = ChatMessage(
        id=str(uuid.uuid4()),
        player_name=request.player_name,
        role=request.role,
        message=request.message,
        timestamp=datetime.utcnow(),
    )
    
    # Add to history
    if request.role in _chat_history:
        _chat_history[request.role].append(message)
        # Keep only last 100 messages
        _chat_history[request.role] = _chat_history[request.role][-100:]
    
    # Emit chat event to team room
    chat_event = create_event(
        "chat_message",
        message.model_dump(mode="json"),
    )
    
    # Emit to role-specific room
    await broadcaster.emit_to_role(request.role, chat_event)
    
    # Also emit to session-scoped rooms if join codes are enabled
    if settings.FEATURE_JOIN_CODES:
        # Get session ID from request context if available
        # For now, emit to all session rooms for this role
        pass
    
    return {"success": True, "message_id": message.id}


@router.get("/history")
async def get_chat_history(role: str) -> dict:
    """Get chat history for a role."""
    if role not in ["red", "blue", "gm", "audience"]:
        raise HTTPException(status_code=400, detail="Invalid role")
    
    messages = _chat_history.get(role, [])
    # Convert to JSON-serializable format
    return {
        "role": role,
        "messages": [
            {
                "id": msg.id,
                "player_name": msg.player_name,
                "role": msg.role,
                "message": msg.message,
                "timestamp": msg.timestamp.isoformat(),
            }
            for msg in messages
        ],
    }


def clear_chat_history():
    """Clear chat history (called on game reset)."""
    global _chat_history
    _chat_history = {
        "red": [],
        "blue": [],
        "gm": [],
        "audience": [],
    }


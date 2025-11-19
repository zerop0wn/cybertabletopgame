import { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../store/useGameStore';
import { chatApi } from '../api/client';
import { ChatMessage } from '../api/types';
import { useWebSocket } from '../hooks/useWebSocket';

interface TeamChatProps {
  role: 'red' | 'blue' | 'gm' | 'audience';
}

export default function TeamChat({ role }: TeamChatProps) {
  const { playerName, gameState } = useGameStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const socket = useWebSocket(role);

  // Load chat history on mount
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const history = await chatApi.getHistory(role);
        setMessages(history.messages);
      } catch (error) {
        console.error('[TeamChat] Failed to load chat history:', error);
      }
    };
    loadHistory();
  }, [role]);

  // Listen for new chat messages via WebSocket
  useEffect(() => {
    if (!socket) return;

    const handleChatMessage = (event: any) => {
      const eventData = event.event || event;
      if (eventData.kind === 'chat_message' || eventData.kind === 'CHAT_MESSAGE') {
        const message: ChatMessage = {
          id: eventData.payload.id,
          player_name: eventData.payload.player_name,
          role: eventData.payload.role,
          message: eventData.payload.message,
          timestamp: eventData.payload.timestamp,
        };
        setMessages((prev) => {
          // Avoid duplicates
          if (prev.some(m => m.id === message.id)) {
            return prev;
          }
          return [...prev, message].slice(-100); // Keep last 100 messages
        });
      }
    };

    socket.on('game_event', handleChatMessage);

    return () => {
      socket.off('game_event', handleChatMessage);
    };
  }, [socket?.connected]); // Only depend on connection status, not socket object

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!inputMessage.trim() || !playerName || sending) return;

    setSending(true);
    try {
      await chatApi.send({
        message: inputMessage.trim(),
        player_name: playerName,
        role: role,
      });
      setInputMessage('');
    } catch (error: any) {
      console.error('[TeamChat] Failed to send message:', error);
      alert(error.response?.data?.detail || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (timestamp: string): string => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <div className="bg-slate-800 rounded-2xl p-6 flex flex-col h-96">
      <h2 className="text-xl font-semibold mb-4">Team Chat</h2>
      
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-2 mb-4 pr-2">
        {messages.length === 0 ? (
          <div className="text-slate-400 text-sm text-center py-4">
            No messages yet. Start the conversation!
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`p-2 rounded-lg ${
                msg.player_name === playerName
                  ? 'bg-blue-900/30 ml-4'
                  : 'bg-slate-700/50 mr-4'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={`font-semibold text-sm ${
                  msg.player_name === playerName
                    ? 'text-blue-300'
                    : role === 'red'
                    ? 'text-red-300'
                    : 'text-blue-300'
                }`}>
                  {msg.player_name}
                </span>
                <span className="text-xs text-slate-400">
                  {formatTime(msg.timestamp)}
                </span>
              </div>
              <div className="text-sm text-slate-200 whitespace-pre-wrap break-words">
                {msg.message}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder={playerName ? "Type a message..." : "Set your name to chat"}
          disabled={!playerName || sending || gameState?.status !== 'running'}
          className="flex-1 px-4 py-2 bg-slate-700 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <button
          onClick={handleSend}
          disabled={!playerName || !inputMessage.trim() || sending || gameState?.status !== 'running'}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Send
        </button>
      </div>
      {!playerName && (
        <div className="mt-2 text-xs text-yellow-400 text-center">
          ⚠️ Set your player name in the lobby to chat
        </div>
      )}
    </div>
  );
}


import { useState, useEffect } from 'react';
import { useGameStore } from '../store/useGameStore';
import { presenceApi } from '../api/client';
import { PresenceStatus, PlayerPresence } from '../api/types';
import { useWebSocket } from '../hooks/useWebSocket';

interface PresenceIndicatorProps {
  role: 'red' | 'blue' | 'gm' | 'audience';
}

export default function PresenceIndicator({ role }: PresenceIndicatorProps) {
  const { playerName, gameState } = useGameStore();
  const [presenceStatus, setPresenceStatus] = useState<PresenceStatus | null>(null);
  const socket = useWebSocket(role);

  // Load presence status on mount and periodically
  useEffect(() => {
    const loadPresence = async () => {
      try {
        const status = await presenceApi.getStatus(role);
        setPresenceStatus(status);
      } catch (error) {
        console.error('[PresenceIndicator] Failed to load presence:', error);
      }
    };

    loadPresence();
    const interval = setInterval(loadPresence, 5000); // Refresh every 5 seconds

    return () => clearInterval(interval);
  }, [role]);

  // Send heartbeat periodically
  useEffect(() => {
    if (!playerName || !gameState || gameState.status !== 'running') return;

    const heartbeat = async () => {
      try {
        await presenceApi.heartbeat(playerName, role);
      } catch (error) {
        console.error('[PresenceIndicator] Failed to send heartbeat:', error);
      }
    };

    heartbeat();
    const interval = setInterval(heartbeat, 15000); // Heartbeat every 15 seconds

    return () => clearInterval(interval);
  }, [playerName, role, gameState?.status]);

  // Listen for presence updates via WebSocket
  useEffect(() => {
    if (!socket || !socket.connected) return;

    const handlePresenceUpdate = (event: any) => {
      const eventData = event.event || event;
      if (eventData.kind === 'presence_update' || eventData.kind === 'PRESENCE_UPDATE') {
        // Reload presence status when update is received
        presenceApi.getStatus(role).then((status) => {
          setPresenceStatus(status);
        }).catch(console.error);
      }
    };

    socket.on('game_event', handlePresenceUpdate);

    return () => {
      socket.off('game_event', handlePresenceUpdate);
    };
  }, [socket?.connected, role]); // Only depend on connection status, not socket object

  if (!presenceStatus) {
    return (
      <div className="bg-slate-800 rounded-2xl p-6">
        <h2 className="text-xl font-semibold mb-4">Team Members</h2>
        <div className="text-slate-400 text-sm text-center py-4">
          Loading...
        </div>
      </div>
    );
  }

  const onlinePlayers = presenceStatus.players.filter(p => p.is_online);
  const offlinePlayers = presenceStatus.players.filter(p => !p.is_online);

  return (
    <div className="bg-slate-800 rounded-2xl p-6">
      <h2 className="text-xl font-semibold mb-4">
        Team Members ({onlinePlayers.length} online)
      </h2>
      <div className="space-y-2">
        {onlinePlayers.length === 0 && offlinePlayers.length === 0 ? (
          <div className="text-slate-400 text-sm text-center py-4">
            No team members yet
          </div>
        ) : (
          <>
            {/* Online players */}
            {onlinePlayers.map((player) => (
              <div
                key={player.player_name}
                className="flex items-center gap-2 p-2 rounded-lg bg-green-900/20 border border-green-700/30"
              >
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-green-300">
                    {player.player_name}
                  </div>
                  {player.current_activity && (
                    <div className="text-xs text-slate-400 truncate">
                      {player.current_activity}
                    </div>
                  )}
                </div>
              </div>
            ))}
            
            {/* Offline players */}
            {offlinePlayers.map((player) => (
              <div
                key={player.player_name}
                className="flex items-center gap-2 p-2 rounded-lg bg-slate-700/30 opacity-50"
              >
                <div className="w-2 h-2 rounded-full bg-slate-500" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-slate-400">
                    {player.player_name}
                  </div>
                  <div className="text-xs text-slate-500">
                    Offline
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}


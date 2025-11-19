import { useState, useEffect } from 'react';
import { useGameStore } from '../store/useGameStore';
import { votingApi } from '../api/client';
import { VotingStatus, PlayerChoice, ScanToolType, AttackType, BlueActionType } from '../api/types';
import { useWebSocket } from '../hooks/useWebSocket';

interface VotingPanelProps {
  role: 'red' | 'blue';
}

export default function VotingPanel({ role }: VotingPanelProps) {
  const { gameState, playerName } = useGameStore();
  const [votingStatus, setVotingStatus] = useState<VotingStatus | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const socket = useWebSocket(role);

  // Load voting status
  const loadStatus = async () => {
    if (!gameState || gameState.status !== 'running' || gameState.current_turn !== role) {
      setVotingStatus(null);
      return;
    }

    try {
      const status = await votingApi.getStatus(role);
      setVotingStatus(status);
    } catch (error) {
      console.error('[VotingPanel] Failed to load voting status:', error);
    }
  };

  // Refresh voting status periodically
  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 2000); // Refresh every 2 seconds

    return () => clearInterval(interval);
  }, [gameState?.status, gameState?.current_turn, role]);

  // Listen for real-time vote updates via WebSocket
  useEffect(() => {
    if (!socket || !socket.connected) return;

    const handleVoteUpdate = (event: any) => {
      const eventData = event.event || event;
      if (eventData.kind === 'vote_update' || eventData.kind === 'VOTE_UPDATE') {
        // Reload voting status when update is received
        loadStatus();
      }
    };

    socket.on('game_event', handleVoteUpdate);

    return () => {
      socket.off('game_event', handleVoteUpdate);
    };
  }, [socket?.connected, gameState?.status, gameState?.current_turn, role]); // Only depend on connection status, not socket object

  const handleVote = async (targetPlayerName: string) => {
    if (!playerName) {
      alert('Please set your player name in the lobby first.');
      return;
    }

    setLoading(true);
    try {
      const response = await votingApi.vote({
        voter_name: playerName,
        target_player_name: targetPlayerName,
        role: role,
      });

      if (response.success) {
        // Refresh status
        const status = await votingApi.getStatus(role);
        setVotingStatus(status);
      } else {
        alert(response.message || 'Failed to submit vote');
      }
    } catch (error: any) {
      console.error('[VotingPanel] Failed to submit vote:', error);
      alert(error.response?.data?.detail || 'Failed to submit vote');
    } finally {
      setLoading(false);
    }
  };

  const formatChoice = (choice: PlayerChoice): string => {
    if (role === 'red') {
      const parts: string[] = [];
      if (choice.scan_tool) {
        parts.push(`Scan: ${choice.scan_tool}`);
      }
      if (choice.attack_type) {
        parts.push(`Attack: ${choice.attack_type}`);
      }
      return parts.join(', ') || 'No choice yet';
    } else {
      const parts: string[] = [];
      if (choice.action_type) {
        parts.push(`Action: ${choice.action_type.replace(/_/g, ' ')}`);
      }
      if (choice.action_target) {
        parts.push(`Target: ${choice.action_target}`);
      }
      return parts.join(', ') || 'No choice yet';
    }
  };

  if (!gameState || gameState.status !== 'running' || gameState.current_turn !== role) {
    return null;
  }

  if (!votingStatus || votingStatus.player_choices.length === 0) {
    return (
      <div className="bg-slate-800 rounded-2xl p-6">
        <h2 className="text-xl font-semibold mb-4">Team Voting</h2>
        <div className="text-slate-400 text-sm text-center py-4">
          No player choices yet. Waiting for team members to make decisions...
        </div>
      </div>
    );
  }

  const voteCounts = Object.fromEntries(
    Object.entries(votingStatus.votes).map(([player, voters]) => [player, voters.length])
  );

  return (
    <div className="bg-slate-800 rounded-2xl p-6">
      <h2 className="text-xl font-semibold mb-4">Team Voting</h2>
      <div className="space-y-3">
        {votingStatus.player_choices.map((choice) => {
          const votes = voteCounts[choice.player_name] || 0;
          const hasVoted = playerName && votingStatus.votes[choice.player_name]?.includes(playerName);
          
          return (
            <div
              key={choice.player_name}
              className={`p-4 rounded-lg border-2 ${
                hasVoted
                  ? 'border-green-500 bg-green-900/20'
                  : 'border-slate-600 bg-slate-700/50'
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <div className="font-semibold text-blue-300 mb-1">{choice.player_name}</div>
                  <div className="text-sm text-slate-300">{formatChoice(choice)}</div>
                </div>
                <div className="ml-4 text-right">
                  <div className="text-2xl font-bold text-green-400">{votes}</div>
                  <div className="text-xs text-slate-400">votes</div>
                </div>
              </div>
              <button
                onClick={() => handleVote(choice.player_name)}
                disabled={loading || hasVoted || !playerName}
                className={`w-full mt-2 py-2 px-4 rounded-lg font-semibold transition-colors ${
                  hasVoted
                    ? 'bg-green-600 cursor-not-allowed opacity-50'
                    : playerName
                    ? 'bg-blue-600 hover:bg-blue-700'
                    : 'bg-slate-600 cursor-not-allowed opacity-50'
                }`}
              >
                {hasVoted ? '✓ Voted' : 'Vote for this choice'}
              </button>
            </div>
          );
        })}
      </div>
      {!playerName && (
        <div className="mt-4 p-3 bg-yellow-900/20 border border-yellow-500/30 rounded-lg text-sm text-yellow-200">
          ⚠️ Set your player name in the lobby to vote
        </div>
      )}
    </div>
  );
}


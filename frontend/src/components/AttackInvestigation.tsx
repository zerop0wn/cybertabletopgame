import { useState, useEffect } from 'react';
import { useGameStore } from '../store/useGameStore';
import { gameApi } from '../api/client';
import { EventKind } from '../api/types';

interface AttackInvestigationProps {
  votes?: Record<string, string>;  // player_name -> "succeeded" or "blocked"
  investigationCompleted?: boolean;
}

export default function AttackInvestigation({
  votes = {},
  investigationCompleted = false,
}: AttackInvestigationProps) {
  const { playerName, gameState, events } = useGameStore();
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);

  // Check if there's a resolved attack
  const resolvedAttack = events.find(
    e => {
      const kind = e.kind as string;
      return kind === 'attack_resolved' || kind === 'ATTACK_RESOLVED' || kind === EventKind.ATTACK_RESOLVED;
    }
  );

  // Available investigation options
  const investigationOptions = [
    { status: "blocked", label: 'Attack Was Blocked', description: 'The attack was successfully blocked by our defenses', icon: '🛡️' },
    { status: "succeeded", label: 'Attack Succeeded', description: 'The attack partially or fully succeeded before being blocked', icon: '⚠️' },
  ];

  // Check if player has already voted
  useEffect(() => {
    if (playerName && votes[playerName]) {
      setHasVoted(true);
      setSelectedStatus(votes[playerName]);
    }
  }, [playerName, votes]);

  // Calculate vote counts
  const voteCounts: Record<string, number> = {};
  Object.values(votes).forEach(status => {
    voteCounts[status] = (voteCounts[status] || 0) + 1;
  });

  const totalVotes = Object.keys(votes).length;
  const majorityCount = Math.max(...Object.values(voteCounts), 0);
  const hasMajority = majorityCount > (totalVotes / 2) && totalVotes > 0;

  const handleSubmit = async () => {
    if (!selectedStatus || !playerName || submitting) return;

    setSubmitting(true);
    try {
      const response = await fetch('/api/actions/investigate-attack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player_name: playerName,
          attack_status: selectedStatus,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to submit vote');
      }

      setHasVoted(true);
      
      // Reload game state to get updated votes
      try {
        const updatedState = await gameApi.getState();
        const store = useGameStore.getState();
        store.setGameState(updatedState);
      } catch (error) {
        console.error('[AttackInvestigation] Failed to reload game state:', error);
      }
    } catch (error: any) {
      console.error('[AttackInvestigation] Failed to submit vote:', error);
      alert(error.message || 'Failed to submit vote');
    } finally {
      setSubmitting(false);
    }
  };

  // Don't show if no resolved attack
  if (!resolvedAttack) {
    return null;
  }

  // Don't show if it's not Blue team's turn
  if (gameState?.current_turn !== 'blue') {
    return null;
  }

  // Only show in Turn 4 (Blue's 2nd turn)
  // Turn 1 (Blue): Block scan IP → blue_turn_count becomes 1
  // Turn 2 (Blue): Investigate attack → blue_turn_count === 1 (during turn), becomes 2 (after)
  const blueTurnCount = gameState?.blue_turn_count || 0;
  if (blueTurnCount !== 1) {
    return null;
  }

  return (
    <div className="bg-slate-800 rounded-2xl p-6">
      <h2 className="text-xl font-semibold mb-2">Post-Incident Investigation</h2>
      <p className="text-sm text-slate-400 mb-4">
        Review the attack alerts and resolution to determine if the attack succeeded or was fully blocked. Check for indicators of compromise.
      </p>

      {investigationCompleted && (
        <div className="mb-4 p-3 bg-green-900/30 border border-green-500 rounded-lg">
          <div className="text-green-300 font-semibold">✓ Investigation Complete!</div>
          <div className="text-xs text-green-400 mt-1">Team has completed the attack investigation.</div>
        </div>
      )}

      {!hasVoted && !investigationCompleted && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Did the attack succeed or was it blocked?</label>
            <div className="grid grid-cols-2 gap-3">
              {investigationOptions.map((option) => (
                <button
                  key={option.status}
                  onClick={() => setSelectedStatus(option.status)}
                  disabled={submitting}
                  className={`p-3 rounded-lg border-2 transition-all ${
                    selectedStatus === option.status
                      ? 'border-blue-500 bg-blue-900/20'
                      : 'border-slate-600 bg-slate-700 hover:border-slate-500'
                  } ${submitting ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xl">{option.icon}</span>
                    <span className="font-semibold text-sm">{option.label}</span>
                  </div>
                  <div className="text-xs text-slate-400 text-left">{option.description}</div>
                </button>
              ))}
            </div>
          </div>

          {selectedStatus && (
            <button
              onClick={handleSubmit}
              disabled={submitting || !playerName}
              className={`w-full px-4 py-2 rounded-lg font-semibold ${
                submitting || !playerName
                  ? 'bg-slate-600 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {submitting ? 'Submitting...' : 'Submit Vote'}
            </button>
          )}

          {!playerName && (
            <div className="text-xs text-yellow-400 text-center">
              ⚠️ Set your player name in the lobby to vote
            </div>
          )}
        </div>
      )}

      {hasVoted && (
        <div className="mb-4 p-3 bg-blue-900/30 border border-blue-500 rounded-lg">
          <div className="text-blue-300 font-semibold">✓ Your Vote Recorded</div>
          <div className="text-xs text-blue-400 mt-1">
            You voted: <strong>{investigationOptions.find(o => o.status === selectedStatus)?.label || selectedStatus}</strong>
          </div>
        </div>
      )}

      {/* Voting Status */}
      {totalVotes > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-700">
          <div className="text-sm font-semibold mb-2">Team Voting Status:</div>
          <div className="space-y-2">
            {Object.entries(voteCounts).map(([status, count]) => {
              const option = investigationOptions.find(o => o.status === status);
              return (
                <div key={status} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span>{option?.icon || '📋'}</span>
                    <span className="text-sm">{option?.label || status}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-24 bg-slate-700 rounded-full h-2">
                      <div
                        className="bg-blue-500 h-2 rounded-full"
                        style={{ width: `${(count / totalVotes) * 100}%` }}
                      />
                    </div>
                    <span className="text-sm font-semibold w-8 text-right">{count}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 text-xs text-slate-400">
            Total votes: {totalVotes} {hasMajority && '(Majority reached)'}
          </div>
        </div>
      )}
    </div>
  );
}


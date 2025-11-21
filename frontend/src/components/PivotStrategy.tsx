import { useState, useEffect } from 'react';
import { useGameStore } from '../store/useGameStore';
import { gameApi } from '../api/client';

interface PivotStrategyProps {
  votes?: Record<string, string>;  // player_name -> pivot_strategy
  strategySelected?: boolean;
}

export default function PivotStrategy({
  votes = {},
  strategySelected = false,
}: PivotStrategyProps) {
  const { playerName, gameState } = useGameStore();
  const [selectedStrategy, setSelectedStrategy] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);

  // Available pivot strategies
  const pivotStrategies = [
    { 
      strategy: "lateral", 
      label: 'Lateral Movement', 
      description: 'Attempt to move to other systems if partial access was gained', 
      icon: '🔄' 
    },
    { 
      strategy: "alternative", 
      label: 'Alternative Attack', 
      description: 'Try a different attack vector or technique', 
      icon: '🎯' 
    },
    { 
      strategy: "persistence", 
      label: 'Verify Persistence', 
      description: 'Check if backdoors or persistence mechanisms survived', 
      icon: '🔐' 
    },
  ];

  // Check if player has already voted
  useEffect(() => {
    if (playerName && votes[playerName]) {
      setHasVoted(true);
      setSelectedStrategy(votes[playerName]);
    }
  }, [playerName, votes]);

  // Calculate vote counts
  const voteCounts: Record<string, number> = {};
  Object.values(votes).forEach(strategy => {
    voteCounts[strategy] = (voteCounts[strategy] || 0) + 1;
  });

  const totalVotes = Object.keys(votes).length;
  const majorityCount = Math.max(...Object.values(voteCounts), 0);
  const hasMajority = majorityCount > (totalVotes / 2) && totalVotes > 0;

  const handleSubmit = async () => {
    if (!selectedStrategy || !playerName || submitting) return;

    setSubmitting(true);
    try {
      const response = await fetch('/api/scans/select-pivot-strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player_name: playerName,
          pivot_strategy: selectedStrategy,
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
        console.error('[PivotStrategy] Failed to reload game state:', error);
      }
    } catch (error: any) {
      console.error('[PivotStrategy] Failed to submit vote:', error);
      alert(error.message || 'Failed to submit vote');
    } finally {
      setSubmitting(false);
    }
  };

  // Don't show if it's not Red team's turn
  if (gameState?.current_turn !== 'red') {
    return null;
  }

  // Only show in Turn 4 (Red's 2nd turn)
  // Turn 1 (Red): Scan and identify vulnerability → red_turn_count becomes 1
  // Turn 2 (Red): Launch attack → red_turn_count becomes 2
  // Turn 3 (Red): Select pivot strategy → red_turn_count === 2 (during turn), becomes 3 (after)
  const redTurnCount = gameState?.red_turn_count || 0;
  if (redTurnCount !== 2) {
    return null;
  }

  return (
    <div className="bg-slate-800 rounded-2xl p-6">
      <h2 className="text-xl font-semibold mb-2">Pivot Strategy Selection</h2>
      <p className="text-sm text-slate-400 mb-4">
        Your attack was blocked. Choose your next strategy to continue the operation.
      </p>

      {strategySelected && (
        <div className="mb-4 p-3 bg-green-900/30 border border-green-500 rounded-lg">
          <div className="text-green-300 font-semibold">✓ Strategy Selected!</div>
          <div className="text-xs text-green-400 mt-1">Team has selected the pivot strategy.</div>
        </div>
      )}

      {!hasVoted && !strategySelected && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Select your pivot strategy:</label>
            <div className="grid grid-cols-1 gap-3">
              {pivotStrategies.map((strategy) => (
                <button
                  key={strategy.strategy}
                  onClick={() => setSelectedStrategy(strategy.strategy)}
                  disabled={submitting}
                  className={`p-3 rounded-lg border-2 transition-all ${
                    selectedStrategy === strategy.strategy
                      ? 'border-red-500 bg-red-900/20'
                      : 'border-slate-600 bg-slate-700 hover:border-slate-500'
                  } ${submitting ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xl">{strategy.icon}</span>
                    <span className="font-semibold text-sm">{strategy.label}</span>
                  </div>
                  <div className="text-xs text-slate-400 text-left">{strategy.description}</div>
                </button>
              ))}
            </div>
          </div>

          {selectedStrategy && (
            <button
              onClick={handleSubmit}
              disabled={submitting || !playerName}
              className={`w-full px-4 py-2 rounded-lg font-semibold ${
                submitting || !playerName
                  ? 'bg-slate-600 cursor-not-allowed'
                  : 'bg-red-600 hover:bg-red-700'
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
        <div className="mb-4 p-3 bg-red-900/30 border border-red-500 rounded-lg">
          <div className="text-red-300 font-semibold">✓ Your Vote Recorded</div>
          <div className="text-xs text-red-400 mt-1">
            You voted for: <strong>{pivotStrategies.find(s => s.strategy === selectedStrategy)?.label || selectedStrategy}</strong>
          </div>
        </div>
      )}

      {/* Voting Status */}
      {totalVotes > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-700">
          <div className="text-sm font-semibold mb-2">Team Voting Status:</div>
          <div className="space-y-2">
            {Object.entries(voteCounts).map(([strategy, count]) => {
              const strategyInfo = pivotStrategies.find(s => s.strategy === strategy);
              return (
                <div key={strategy} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span>{strategyInfo?.icon || '📋'}</span>
                    <span className="text-sm">{strategyInfo?.label || strategy}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-24 bg-slate-700 rounded-full h-2">
                      <div
                        className="bg-red-500 h-2 rounded-full"
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


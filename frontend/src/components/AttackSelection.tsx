import { useState, useEffect } from 'react';
import { useGameStore } from '../store/useGameStore';
import { scansApi, gameApi } from '../api/client';
import { Attack } from '../api/types';

interface AttackSelectionProps {
  attacks: Attack[];  // Available attacks
  votes?: Record<string, string>;  // player_name -> attack_id
  attackSelected?: boolean;  // Whether team has selected an attack
}

export default function AttackSelection({
  attacks,
  votes = {},
  attackSelected = false,
}: AttackSelectionProps) {
  const { playerName, gameState, currentScenario } = useGameStore();
  const [selectedAttackId, setSelectedAttackId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);

  // Check if player has already voted
  useEffect(() => {
    if (playerName && votes[playerName]) {
      setHasVoted(true);
      setSelectedAttackId(votes[playerName]);
    }
  }, [playerName, votes]);

  // Filter attacks based on scan requirements
  const availableAttacks = attacks.filter((attack) => {
    if (!attack.requires_scan) {
      return true; // No scan required, always available
    }

    // Check if scan was completed
    const scanResults = gameState?.red_scan_results || [];
    if (scanResults.length === 0) {
      return false; // No scans completed
    }

    // Check if required scan tool was used
    if (attack.required_scan_tool) {
      const normalizedRequiredTool = String(attack.required_scan_tool);
      const hasMatchingScan = scanResults.some(
        (scan) => String(scan.tool) === normalizedRequiredTool
      );
      return hasMatchingScan;
    }

    return true; // Scan required but no specific tool specified
  });

  // Calculate vote counts
  const voteCounts: Record<string, number> = {};
  Object.values(votes).forEach((attackId) => {
    voteCounts[attackId] = (voteCounts[attackId] || 0) + 1;
  });

  const totalVotes = Object.keys(votes).length;
  const majorityCount = Math.max(...Object.values(voteCounts), 0);
  const hasMajority = majorityCount > (totalVotes / 2) && totalVotes > 0;
  const majorityAttackId = Object.entries(voteCounts).find(
    ([_, count]) => count === majorityCount
  )?.[0];

  const handleSubmit = async () => {
    if (!selectedAttackId || !playerName || submitting) return;

    setSubmitting(true);
    try {
      await scansApi.selectAttack(playerName, selectedAttackId);
      setHasVoted(true);
      
      // Reload game state to get updated votes
      try {
        const updatedState = await gameApi.getState();
        const store = useGameStore.getState();
        store.setGameState(updatedState);
      } catch (error) {
        console.error('[AttackSelection] Failed to reload game state:', error);
      }
    } catch (error: any) {
      console.error('[AttackSelection] Failed to submit vote:', error);
      alert(error.response?.data?.detail || error.message || 'Failed to submit vote');
    } finally {
      setSubmitting(false);
    }
  };

  // Don't show if no attacks available
  if (availableAttacks.length === 0) {
    return null;
  }

  // Don't show if it's not Red team's turn
  if (gameState?.current_turn !== 'red') {
    return null;
  }

  // Only show in Turn 3 (red_turn_count === 1)
  const redTurnCount = gameState?.red_turn_count || 0;
  if (redTurnCount !== 1) {
    return null;
  }

  return (
    <div className="bg-slate-800 rounded-2xl p-6">
      <h2 className="text-xl font-semibold mb-2">Select Attack</h2>
      <p className="text-sm text-slate-400 mb-4">
        Review scan results and vote on which attack to launch. Once majority is reached, any team member can launch the selected attack.
      </p>

      {attackSelected && (
        <div className="mb-4 p-3 bg-green-900/30 border border-green-500 rounded-lg">
          <div className="text-green-300 font-semibold">✓ Attack Selected!</div>
          <div className="text-xs text-green-400 mt-1">
            Team has selected an attack. {majorityAttackId ? `Selected: ${availableAttacks.find(a => a.id === majorityAttackId)?.effects?.impact?.split('.')[0] || majorityAttackId}` : ''}
          </div>
          <div className="text-xs text-green-400 mt-1">
            You can now launch the selected attack from the attacks tab below.
          </div>
        </div>
      )}

      {!hasVoted && !attackSelected && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Select the attack to launch:</label>
            <div className="space-y-2">
              {availableAttacks.map((attack) => {
                const attackImpact = attack.effects?.impact 
                  ? attack.effects.impact.split('.')[0]
                  : attack.attack_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                
                return (
                  <button
                    key={attack.id}
                    onClick={() => setSelectedAttackId(attack.id)}
                    disabled={submitting}
                    className={`w-full p-3 rounded-lg border-2 transition-all text-left ${
                      selectedAttackId === attack.id
                        ? 'border-red-500 bg-red-900/20'
                        : 'border-slate-600 bg-slate-700 hover:border-slate-500'
                    } ${submitting ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <div className="font-semibold text-sm mb-1">{attackImpact}</div>
                    <div className="text-xs text-slate-400">
                      {attack.from_node} → {attack.to_node}
                    </div>
                    {attack.effects?.impact && (
                      <div className="text-xs text-slate-500 mt-1">
                        {attack.effects.impact}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {selectedAttackId && (
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
        <div className="mb-4 p-3 bg-blue-900/30 border border-blue-500 rounded-lg">
          <div className="text-blue-300 font-semibold">✓ Your Vote Recorded</div>
          <div className="text-xs text-blue-400 mt-1">
            You voted for: <strong>{availableAttacks.find(a => a.id === selectedAttackId)?.effects?.impact?.split('.')[0] || selectedAttackId}</strong>
          </div>
        </div>
      )}

      {/* Voting Status */}
      {totalVotes > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-700">
          <div className="text-sm font-semibold mb-2">Team Voting Status:</div>
          <div className="space-y-2">
            {Object.entries(voteCounts).map(([attackId, count]) => {
              const attack = availableAttacks.find(a => a.id === attackId);
              const attackLabel = attack?.effects?.impact?.split('.')[0] 
                || attack?.attack_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
                || attackId;
              
              return (
                <div key={attackId} className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-sm truncate">{attackLabel}</span>
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
          {hasMajority && majorityAttackId && (
            <div className="mt-2 p-2 bg-green-900/20 border border-green-500 rounded text-xs text-green-300">
              ✓ Majority reached: {availableAttacks.find(a => a.id === majorityAttackId)?.effects?.impact?.split('.')[0] || majorityAttackId}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


import { useState, useEffect } from 'react';
import { useGameStore } from '../store/useGameStore';
import { gameApi, actionsApi } from '../api/client';
import { BlueActionType, EventKind } from '../api/types';

interface ActionIdentificationProps {
  votes?: Record<string, string>;  // player_name -> action_type
  actionIdentified?: boolean;
  attackId?: string;
  attackType?: string;
}

export default function ActionIdentification({
  votes = {},
  actionIdentified = false,
  attackId,
  attackType,
}: ActionIdentificationProps) {
  const { playerName, gameState, events, currentScenario } = useGameStore();
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submittingAction, setSubmittingAction] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);

  // Check if there's an active attack
  const activeAttack = events.find(
    e => {
      const kind = e.kind as string;
      return (kind === 'attack_launched' || kind === 'ATTACK_LAUNCHED' || kind === EventKind.ATTACK_LAUNCHED) && 
             !events.some(e2 => {
               const e2Kind = e2.kind as string;
               return (e2Kind === 'attack_resolved' || e2Kind === EventKind.ATTACK_RESOLVED) && e2.payload?.attack_id === e.payload?.attack_id;
             });
    }
  );

  // Available action types
  const availableActions = [
    { type: BlueActionType.UPDATE_WAF, label: 'Update WAF', description: 'Update WAF rules to block web attacks', icon: '🛡️' },
    { type: BlueActionType.BLOCK_IP, label: 'Block IP', description: 'Block the attacker IP address', icon: '🚫' },
    { type: BlueActionType.ISOLATE_HOST, label: 'Isolate Host', description: 'Isolate the compromised host', icon: '🔒' },
    { type: BlueActionType.BLOCK_DOMAIN, label: 'Block Domain', description: 'Block a malicious domain', icon: '🌐' },
  ];

  // Check if player has already voted
  useEffect(() => {
    if (playerName && votes[playerName]) {
      setHasVoted(true);
      setSelectedAction(votes[playerName]);
    }
  }, [playerName, votes]);

  // Calculate vote counts
  const voteCounts: Record<string, number> = {};
  Object.values(votes).forEach(action => {
    voteCounts[action] = (voteCounts[action] || 0) + 1;
  });

  const totalVotes = Object.keys(votes).length;
  const majorityCount = Math.max(...Object.values(voteCounts), 0);
  const hasMajority = majorityCount > (totalVotes / 2) && totalVotes > 0;
  const majorityAction = Object.entries(voteCounts).find(([_, count]) => count === majorityCount)?.[0] || null;

  const handleSubmitVote = async () => {
    if (!selectedAction || !playerName || submitting) return;

    setSubmitting(true);
    try {
      const response = await fetch('/api/actions/identify-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player_name: playerName,
          action_type: selectedAction,
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
        console.error('[ActionIdentification] Failed to reload game state:', error);
      }
    } catch (error: any) {
      console.error('[ActionIdentification] Failed to submit vote:', error);
      alert(error.message || 'Failed to submit vote');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitAction = async () => {
    if (!majorityAction || !activeAttack || submittingAction) return;

    // Determine target - use the attack target node
    const attackTarget = activeAttack.payload?.to || activeAttack.payload?.target;
    if (!attackTarget) {
      alert('Unable to determine attack target. Cannot submit action.');
      return;
    }

    setSubmittingAction(true);
    try {
      await actionsApi.submit({
        type: majorityAction as BlueActionType,
        target: attackTarget,
        note: '',
        player_name: playerName || undefined,
      });

      // Reload game state
      try {
        const updatedState = await gameApi.getState();
        const store = useGameStore.getState();
        store.setGameState(updatedState);
      } catch (error) {
        console.error('[ActionIdentification] Failed to reload game state:', error);
      }
    } catch (error: any) {
      console.error('[ActionIdentification] Failed to submit action:', error);
      alert(error.response?.data?.detail || error.message || 'Failed to submit action');
    } finally {
      setSubmittingAction(false);
    }
  };

  // Don't show if no active attack
  if (!activeAttack) {
    return null;
  }

  // Don't show if it's not Blue team's turn
  if (gameState?.current_turn !== 'blue') {
    return null;
  }

  // Don't show if Blue team has already taken action this turn
  if (gameState?.blue_action_this_turn) {
    return null;
  }

  return (
    <div className="bg-slate-800 rounded-2xl p-6">
      <h2 className="text-xl font-semibold mb-2">Identify Response Action</h2>
      <p className="text-sm text-slate-400 mb-4">
        Review the attack alerts and vote on which action to take in response. Choose the most effective defense strategy.
      </p>

      {attackType && (
        <div className="mb-4 p-3 bg-slate-900 rounded border border-slate-600">
          <div className="text-xs text-slate-400 mb-1">Active Attack:</div>
          <div className="text-sm font-semibold text-red-300">{attackType}</div>
        </div>
      )}

      {actionIdentified && (
        <div className="mb-4 p-3 bg-green-900/30 border border-green-500 rounded-lg">
          <div className="text-green-300 font-semibold">✓ Action Correctly Identified!</div>
          <div className="text-xs text-green-400 mt-1">Team has successfully identified the correct response action.</div>
        </div>
      )}

      {!hasVoted && !actionIdentified && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Select the action to take:</label>
            <div className="grid grid-cols-2 gap-3">
              {availableActions.map((action) => (
                <button
                  key={action.type}
                  onClick={() => setSelectedAction(action.type)}
                  disabled={submitting}
                  className={`p-3 rounded-lg border-2 transition-all ${
                    selectedAction === action.type
                      ? 'border-blue-500 bg-blue-900/20'
                      : 'border-slate-600 bg-slate-700 hover:border-slate-500'
                  } ${submitting ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xl">{action.icon}</span>
                    <span className="font-semibold text-sm">{action.label}</span>
                  </div>
                  <div className="text-xs text-slate-400 text-left">{action.description}</div>
                </button>
              ))}
            </div>
          </div>

          {selectedAction && (
            <button
              onClick={handleSubmitVote}
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
            You voted for: <strong>{availableActions.find(a => a.type === selectedAction)?.label || selectedAction}</strong>
          </div>
        </div>
      )}

      {/* Voting Status */}
      {totalVotes > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-700">
          <div className="text-sm font-semibold mb-2">Team Voting Status:</div>
          <div className="space-y-2">
            {Object.entries(voteCounts).map(([action, count]) => {
              const actionInfo = availableActions.find(a => a.type === action);
              return (
                <div key={action} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span>{actionInfo?.icon || '📋'}</span>
                    <span className="text-sm">{actionInfo?.label || action}</span>
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
          {hasMajority && majorityAction && !gameState?.blue_action_this_turn && (
            <div className="mt-4 pt-4 border-t border-slate-600">
              <div className="text-sm font-semibold mb-2 text-green-300">
                ✓ Majority Reached: {availableActions.find(a => a.type === majorityAction)?.label || majorityAction}
              </div>
              <button
                onClick={handleSubmitAction}
                disabled={submittingAction || !playerName}
                className={`w-full px-4 py-2 rounded-lg font-semibold ${
                  submittingAction || !playerName
                    ? 'bg-slate-600 cursor-not-allowed'
                    : 'bg-green-600 hover:bg-green-700'
                }`}
              >
                {submittingAction ? 'Submitting Action...' : `Submit ${availableActions.find(a => a.type === majorityAction)?.label || majorityAction} Action`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


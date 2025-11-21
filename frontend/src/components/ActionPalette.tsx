import { useState, useMemo } from 'react';
import { BlueActionType } from '../api/types';
import { actionsApi, gameApi, activityApi } from '../api/client';
import { useGameStore } from '../store/useGameStore';

interface ActionPaletteProps {
  onActionSubmitted?: () => void;
}

export default function ActionPalette({ onActionSubmitted }: ActionPaletteProps) {
  const { currentScenario, gameState, playerName, role, alerts } = useGameStore();
  const [selectedType, setSelectedType] = useState<BlueActionType | null>(null);
  const [target, setTarget] = useState('');
  const [useCustomTarget, setUseCustomTarget] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  
  // Extract scan IPs from alerts when BLOCK_IP is selected
  const scanIPs = useMemo(() => {
    if (selectedType !== BlueActionType.BLOCK_IP) return [];
    const ips = new Set<string>();
    alerts.forEach(alert => {
      if (alert.ioc && alert.ioc.source_ip) {
        ips.add(String(alert.ioc.source_ip));
      }
    });
    return Array.from(ips).sort();
  }, [selectedType, alerts]);
  
  // Get available targets from scenario nodes
  const availableTargets = useMemo(() => {
    if (!currentScenario?.topology?.nodes) {
      console.log('[ActionPalette] No scenario or nodes available');
      return [];
    }
    const targets = currentScenario.topology.nodes.map(node => ({
      id: node.id,
      label: node.label || node.id,
      type: node.type,
    }));
    console.log('[ActionPalette] Available targets:', targets);
    return targets;
  }, [currentScenario]);

  const actionTypes: { type: BlueActionType; label: string; desc: string }[] = [
    { type: BlueActionType.ISOLATE_HOST, label: 'Isolate Host', desc: 'Isolate a compromised host' },
    { type: BlueActionType.BLOCK_IP, label: 'Block IP', desc: 'Block an IP address' },
    { type: BlueActionType.BLOCK_DOMAIN, label: 'Block Domain', desc: 'Block a domain' },
    { type: BlueActionType.UPDATE_WAF, label: 'Update WAF', desc: 'Update WAF rules' },
    { type: BlueActionType.DISABLE_ACCOUNT, label: 'Disable Account', desc: 'Disable a user account' },
    { type: BlueActionType.RESET_PASSWORD, label: 'Reset Password', desc: 'Reset user password' },
    { type: BlueActionType.OPEN_TICKET, label: 'Open Ticket', desc: 'Create an incident ticket' },
  ];

  const handleSubmit = async () => {
    if (!selectedType || !target.trim()) {
      alert('Please select an action type and enter a target.');
      return;
    }

    // Check if it's Blue team's turn
    // Refresh game state first to ensure we have the latest turn information
    try {
      const latestState = await gameApi.getState();
      useGameStore.getState().setGameState(latestState);
      
      // Check if game is running
      if (latestState.status !== 'running') {
        alert(`Game is not running. Current status: ${latestState.status || 'unknown'}. Please wait for the game to start.`);
        return;
      }
      
      // Check if it's Blue team's turn
      if (latestState.current_turn !== 'blue') {
        alert(`It's not Blue team's turn. Current turn: ${latestState.current_turn || 'unknown'}. Please wait for your turn.`);
        return;
      }
    } catch (error) {
      console.error('Failed to refresh game state:', error);
      // Continue with local state check as fallback
      if (gameState?.status !== 'running') {
        alert(`Game is not running. Current status: ${gameState?.status || 'unknown'}. Please wait for the game to start.`);
        return;
      }
      if (gameState?.current_turn !== 'blue') {
        alert(`It's not Blue team's turn. Current turn: ${gameState?.current_turn || 'unknown'}. Please wait for your turn.`);
        return;
      }
    }

    setSubmitting(true);
    try {
      // Track activity: preparing to submit action
      if (playerName && role) {
        try {
          await activityApi.track({
            player_name: playerName,
            role: role as 'red' | 'blue' | 'gm' | 'audience',
            activity_type: 'submitting_action',
            description: `Submitting ${selectedType} action on ${target}`,
            metadata: { action_type: selectedType, target },
          });
        } catch (err) {
          console.error('[ActionPalette] Failed to track activity:', err);
        }
      }
      
      console.log('Submitting action:', { type: selectedType, target: target.trim() });
      const result = await actionsApi.submit({
        type: selectedType,
        target: target.trim(),
        note: '', // Empty note since justification box is removed
        player_name: playerName || undefined,
      });
      
      console.log('Action submitted successfully:', result);
      alert(`Action submitted successfully! ID: ${result.action_id || 'N/A'}`);
      
      setSelectedType(null);
      setTarget('');
      onActionSubmitted?.();
    } catch (error: any) {
      console.error('Failed to submit action:', error);
      const message = error.response?.data?.detail || error.message || 'Failed to submit action';
      alert(`Failed to submit action: ${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Disable if game is not running
  const isGameRunning = gameState?.status === 'running';
  
  return (
    <div className="bg-slate-800 rounded-2xl p-6">
      <h2 className="text-xl font-semibold mb-4">Action Palette</h2>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">Action Type</label>
          <select
            value={selectedType || ''}
            onChange={(e) => setSelectedType(e.target.value as BlueActionType)}
            className="w-full px-4 py-2 bg-slate-700 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select an action</option>
            {actionTypes.map(({ type, label, desc }) => (
              <option key={type} value={type}>
                {label} - {desc}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Target</label>
          
          {availableTargets.length > 0 && !useCustomTarget ? (
            <>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="w-full px-4 py-2 bg-slate-700 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
              >
                <option value="">Select a target node...</option>
                {availableTargets.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.label} ({node.type})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  setUseCustomTarget(true);
                  setTarget('');
                }}
                className="text-xs text-blue-400 hover:text-blue-300 underline"
              >
                Or enter custom target (IP, domain, etc.)
              </button>
            </>
          ) : (
            <>
              {selectedType === BlueActionType.BLOCK_IP && scanIPs.length > 0 && (
                <div className="mb-2 p-2 bg-slate-900 rounded border border-slate-600">
                  <div className="text-xs text-slate-400 mb-1">Scan IPs from alerts:</div>
                  <div className="flex flex-wrap gap-1">
                    {scanIPs.map(ip => (
                      <button
                        key={ip}
                        type="button"
                        onClick={() => setTarget(ip)}
                        className="text-xs px-2 py-1 bg-blue-900/50 hover:bg-blue-800/50 rounded border border-blue-700/50 text-blue-300"
                      >
                        {ip}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <input
                type="text"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder={selectedType === BlueActionType.BLOCK_IP 
                  ? "e.g., 198.51.100.7 (or click IPs above)" 
                  : availableTargets.length > 0 
                    ? "e.g., 198.51.100.7, example.com" 
                    : "e.g., web-1, 198.51.100.7, example.com"}
                className="w-full px-4 py-2 bg-slate-700 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
              />
              {availableTargets.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setUseCustomTarget(false);
                    setTarget('');
                  }}
                  className="text-xs text-blue-400 hover:text-blue-300 underline"
                >
                  Or select from scenario nodes ({availableTargets.length} available)
                </button>
              )}
            </>
          )}
        </div>

        {!isGameRunning && (
          <div className="text-yellow-400 text-sm text-center py-2 px-4 bg-yellow-900/20 rounded-lg border border-yellow-500/30">
            Game is not running. Waiting for Game Manager to start the game.
          </div>
        )}
        <button
          onClick={handleSubmit}
          disabled={!isGameRunning || submitting || !selectedType || !target.trim() || gameState?.current_turn !== 'blue'}
          className={`w-full py-3 rounded-lg font-semibold transition-colors ${
            isGameRunning && gameState?.current_turn === 'blue' && !submitting && selectedType && target.trim()
              ? 'bg-blue-600 hover:bg-blue-700'
              : 'bg-slate-600 cursor-not-allowed opacity-50'
          }`}
          title={
            !isGameRunning 
              ? 'Game is not running' 
              : gameState?.current_turn !== 'blue' 
                ? `It's not Blue team's turn. Current turn: ${gameState?.current_turn || 'unknown'}` 
                : 'Submit Action'
          }
        >
          {submitting 
            ? 'Submitting...' 
            : !isGameRunning 
              ? 'Game Not Started' 
              : gameState?.current_turn === 'blue' 
                ? 'Submit Action' 
                : `Not Your Turn (${gameState?.current_turn || 'unknown'})`}
        </button>
      </div>
    </div>
  );
}


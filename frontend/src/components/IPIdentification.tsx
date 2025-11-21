import { useState, useEffect } from 'react';
import { useGameStore } from '../store/useGameStore';
import { scansApi, gameApi } from '../api/client';

interface IPIdentificationProps {
  scanIPs?: string[];  // Available IP addresses from alerts
  votes?: Record<string, string>;  // player_name -> ip_address
  ipIdentified?: boolean;
}

export default function IPIdentification({
  scanIPs = [],
  votes = {},
  ipIdentified = false,
}: IPIdentificationProps) {
  const { playerName, gameState, alerts } = useGameStore();
  const [selectedIP, setSelectedIP] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);

  // Extract IP addresses from alerts if not provided
  const availableIPs = scanIPs.length > 0 
    ? scanIPs 
    : Array.from(new Set(
        alerts
          .filter(alert => alert.ioc && alert.ioc.source_ip)
          .map(alert => String(alert.ioc.source_ip))
      )).sort();

  // Check if player has already voted
  useEffect(() => {
    if (playerName && votes[playerName]) {
      setHasVoted(true);
      setSelectedIP(votes[playerName]);
    }
  }, [playerName, votes]);

  // Calculate vote counts
  const voteCounts: Record<string, number> = {};
  Object.values(votes).forEach(ip => {
    voteCounts[ip] = (voteCounts[ip] || 0) + 1;
  });

  const totalVotes = Object.keys(votes).length;
  const majorityCount = Math.max(...Object.values(voteCounts), 0);
  const hasMajority = majorityCount > (totalVotes / 2) && totalVotes > 0;

  const handleSubmit = async () => {
    if (!selectedIP || !playerName || submitting) return;

    setSubmitting(true);
    try {
      // Call the identify-ip endpoint
      const response = await fetch('/api/scans/identify-ip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player_name: playerName,
          ip_address: selectedIP,
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
        console.error('[IPIdentification] Failed to reload game state:', error);
      }
    } catch (error: any) {
      console.error('[IPIdentification] Failed to submit vote:', error);
      alert(error.message || 'Failed to submit vote');
    } finally {
      setSubmitting(false);
    }
  };

  // Don't show if no IPs are available
  if (availableIPs.length === 0) {
    return null;
  }

  // Don't show if it's not Blue team's turn
  if (gameState?.current_turn !== 'blue') {
    return null;
  }

  return (
    <div className="bg-slate-800 rounded-2xl p-6">
      <h2 className="text-xl font-semibold mb-2">Identify Scan Source IP</h2>
      <p className="text-sm text-slate-400 mb-4">
        Review alerts and vote on which IP address was used for scanning. Block the correct IP to prevent future attacks.
      </p>

      {ipIdentified && (
        <div className="mb-4 p-3 bg-green-900/30 border border-green-500 rounded-lg">
          <div className="text-green-300 font-semibold">✓ IP Correctly Identified!</div>
          <div className="text-xs text-green-400 mt-1">Team has successfully identified the correct scan source IP.</div>
        </div>
      )}

      {!hasVoted && !ipIdentified && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Select the IP address used for scanning:</label>
            <div className="grid grid-cols-2 gap-3">
              {availableIPs.map((ip) => (
                <button
                  key={ip}
                  onClick={() => setSelectedIP(ip)}
                  disabled={submitting}
                  className={`p-3 rounded-lg border-2 transition-all ${
                    selectedIP === ip
                      ? 'border-blue-500 bg-blue-900/20'
                      : 'border-slate-600 bg-slate-700 hover:border-slate-500'
                  } ${submitting ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xl">🌐</span>
                    <span className="font-mono text-sm">{ip}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {selectedIP && (
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
            You voted for: <strong className="font-mono">{selectedIP}</strong>
          </div>
        </div>
      )}

      {/* Voting Status */}
      {totalVotes > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-700">
          <div className="text-sm font-semibold mb-2">Team Voting Status:</div>
          <div className="space-y-2">
            {Object.entries(voteCounts).map(([ip, count]) => (
              <div key={ip} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span>🌐</span>
                  <span className="font-mono text-sm">{ip}</span>
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
            ))}
          </div>
          <div className="mt-3 text-xs text-slate-400">
            Total votes: {totalVotes} {hasMajority && '(Majority reached)'}
          </div>
        </div>
      )}
    </div>
  );
}


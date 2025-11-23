import { useState, useMemo } from 'react';
import { Alert, Event } from '../api/types';
import { useGameStore } from '../store/useGameStore';

export default function AlertFeed() {
  const { alerts, events } = useGameStore();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const getSeverityColor = (severity: string) => {
    const colors: Record<string, string> = {
      low: 'bg-slate-600',
      medium: 'bg-yellow-600',
      high: 'bg-orange-600',
      critical: 'bg-red-600',
    };
    return colors[severity] || 'bg-slate-600';
  };

  // Helper function to convert timestamp to Date
  const getTimestamp = (ts: string | Date): Date => {
    return (ts as any) instanceof Date ? (ts as Date) : new Date(String(ts));
  };
  
  // Filter out alerts with invalid timestamps and sort
  const validAlerts = alerts.filter(alert => {
    const timestamp = getTimestamp(alert.timestamp as any);
    return !isNaN(timestamp.getTime());
  });
  
  const sortedAlerts = [...validAlerts].sort(
    (a, b) => {
      const timeA = getTimestamp(a.timestamp as any);
      const timeB = getTimestamp(b.timestamp as any);
      return timeB.getTime() - timeA.getTime();
    }
  );
  
  // Debug logging removed to reduce console noise
  // Uncomment if needed for debugging:
  // console.log('[AlertFeed] Alerts in store:', alerts.length, 'Valid alerts:', validAlerts.length);

  // Get recent score change events for context
  const recentScoreEvents = useMemo(() => {
    return events
      .filter(
        (e) =>
          (e.kind === 'attack_resolved' || e.kind === 'score_update') &&
          (
            (e.payload.score_deltas && e.payload.score_deltas.blue !== undefined) ||
            (e.payload.score_explanation) ||
            (e.kind === 'score_update' && (e.payload.red !== undefined || e.payload.blue !== undefined))
          )
      )
      .slice(-10)
      .reverse();
  }, [events]);

  // Helper to get score explanation
  const getScoreExplanation = (event: Event): { blueDelta: number; redDelta: number; explanation: string | null } | null => {
    const payload = event.payload || {};
    
    // Handle attack_resolved events with score_deltas
    if (payload.score_deltas) {
      const blueDelta = payload.score_deltas.blue || 0;
      const redDelta = payload.score_deltas.red || 0;
      const explanation = payload.score_explanation || null;
      
      // Only return if there's a score change or explanation
      if (blueDelta === 0 && redDelta === 0 && !explanation) return null;

      return {
        blueDelta,
        redDelta,
        explanation: explanation || 'No explanation provided'
      };
    }
    
    // Handle score_update events with direct score values
    if (event.kind === 'score_update' && (payload.red !== undefined || payload.blue !== undefined)) {
      // For score_update events, we don't have deltas, so show current score
      // But try to calculate delta from previous score if available
      const blueDelta = 0; // Can't calculate delta from standalone score_update
      const redDelta = 0;
      const explanation = payload.score_explanation || `Current Score: Red ${payload.red || 0}, Blue ${payload.blue || 0}`;
      
      return {
        blueDelta,
        redDelta,
        explanation
      };
    }
    
    return null;
  };

  return (
    <div className="bg-slate-800 rounded-2xl p-6 h-full flex flex-col">
      <h2 className="text-xl font-semibold mb-4">Alert Feed & Score Updates</h2>
      
      <div className="flex-1 overflow-y-auto space-y-2">
        {/* Score change notifications */}
        {recentScoreEvents.length > 0 && (
          <div className="mb-4 pb-4 border-b border-slate-700">
            <div className="text-xs font-semibold text-green-400 mb-2">Recent Score Updates</div>
            {recentScoreEvents.map((event) => {
              const scoreInfo = getScoreExplanation(event);
              if (!scoreInfo) return null;
              
              const hasBlueChange = scoreInfo.blueDelta !== 0;
              const hasRedChange = scoreInfo.redDelta !== 0;
              const isBluePositive = scoreInfo.blueDelta > 0;
              
              return (
                <div
                  key={event.id}
                  className={`${
                    hasBlueChange && isBluePositive
                      ? 'bg-green-900/20 border-green-500/50'
                      : hasBlueChange && !isBluePositive
                      ? 'bg-red-900/20 border-red-500/50'
                      : 'bg-slate-900/20 border-slate-500/50'
                  } border rounded-lg p-3 mb-2 text-xs`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm text-white">Score Update</span>
                    <span className="text-slate-400 text-xs">
                      {new Date(event.ts).toLocaleTimeString()}
                    </span>
                  </div>
                  
                  {/* Score Deltas */}
                  {(hasBlueChange || hasRedChange) && (
                    <div className="flex items-center gap-4 mb-2">
                      {hasBlueChange && (
                        <div className={`${isBluePositive ? 'text-green-300' : 'text-red-300'} font-bold`}>
                          Blue: {isBluePositive ? '+' : ''}{scoreInfo.blueDelta}
                        </div>
                      )}
                      {hasRedChange && (
                        <div className={`${scoreInfo.redDelta > 0 ? 'text-red-300' : 'text-green-300'} font-bold`}>
                          Red: {scoreInfo.redDelta > 0 ? '+' : ''}{scoreInfo.redDelta}
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Written Explanation */}
                  {scoreInfo.explanation && (
                    <div className={`${
                      hasBlueChange && isBluePositive ? 'text-green-200/80' : 
                      hasBlueChange && !isBluePositive ? 'text-red-200/80' : 
                      'text-slate-300'
                    } text-xs mt-1 pt-2 border-t border-slate-600`}>
                      <div className="font-semibold mb-1">Reason:</div>
                      <div>{scoreInfo.explanation}</div>
                    </div>
                  )}
                  
                  {/* Attack Result if available */}
                  {event.payload.result && (
                    <div className="text-slate-300 mt-2 pt-2 border-t border-slate-600 text-xs">
                      <span className="font-semibold">Attack Result: </span>
                      <span className={`${
                        event.payload.result === 'blocked' ? 'text-green-400' :
                        event.payload.result === 'detected' ? 'text-yellow-400' :
                        'text-red-400'
                      } font-bold`}>
                        {event.payload.result.toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {sortedAlerts.length === 0 ? (
          <div className="text-slate-400 text-center py-8">No alerts yet</div>
        ) : (
          sortedAlerts.map((alert) => (
            <div
              key={alert.id}
              className="bg-slate-700 rounded-lg p-4 cursor-pointer hover:bg-slate-600 transition-colors"
              onClick={() => setExpandedId(expandedId === alert.id ? null : alert.id)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className={`px-2 py-1 rounded text-xs font-semibold ${getSeverityColor(
                        alert.severity
                      )}`}
                    >
                      {alert.severity.toUpperCase()}
                    </span>
                    <span className="text-sm text-slate-400">{alert.source}</span>
                    <span className="text-xs text-slate-500">
                      {getTimestamp(alert.timestamp as any).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="font-semibold">{alert.summary}</div>
                  {expandedId === alert.id && (
                    <div className="mt-2 text-sm text-slate-300">
                      <div className="mb-2">{alert.details}</div>
                      {alert.ioc && Object.keys(alert.ioc).length > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-600">
                          <div className="text-xs text-slate-400 mb-1">IOCs:</div>
                          <pre className="text-xs bg-slate-800 p-2 rounded">
                            {JSON.stringify(alert.ioc, null, 2)}
                          </pre>
                        </div>
                      )}
                      <div className="mt-2 text-xs text-slate-400">
                        Confidence: {(alert.confidence * 100).toFixed(0)}%
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}


import { Event } from '../api/types';
import { useGameStore } from '../store/useGameStore';
import { useState } from 'react';

export default function TimelineStrip() {
  const { events } = useGameStore();
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);

  // Debug logging removed to reduce console noise
  // Uncomment if needed for debugging:
  // console.log('[TimelineStrip] Total events:', events.length);

  const sortedEvents = [...events].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
  );

  const getEventKind = (kind: string | any): string => {
    if (typeof kind === 'string') return kind.toLowerCase();
    if (kind?.value) return kind.value.toLowerCase();
    return String(kind).toLowerCase();
  };

  const getEventColor = (kind: string | any) => {
    const kindStr = getEventKind(kind);
    const colors: Record<string, string> = {
      attack_launched: 'bg-orange-500',
      attack_resolved: 'bg-red-500',
      alert_emitted: 'bg-yellow-500',
      action_taken: 'bg-blue-500',
      score_update: 'bg-green-500',
      round_started: 'bg-purple-500',
      round_ended: 'bg-pink-500',
      turn_changed: 'bg-cyan-500',
      turn_timeout: 'bg-cyan-600',
      scan_completed: 'bg-indigo-500',
    };
    return colors[kindStr] || 'bg-slate-500';
  };

  const getEventLabel = (event: Event): string => {
    const kind = getEventKind(event.kind);
    const payload = event.payload || {};
    
    switch (kind) {
      case 'attack_launched':
      case 'ATTACK_LAUNCHED':
        return `Attack: ${payload.attack_type || 'Unknown'}`;
      case 'attack_resolved':
      case 'ATTACK_RESOLVED':
        const result = payload.result?.toUpperCase() || 'UNKNOWN';
        const isBlocked = payload.result === 'blocked' || payload.result === 'successful_block' || payload.result === 'successful_mitigation';
        const isHit = payload.result === 'hit' || payload.result === 'unsuccessful_block' || payload.result === 'unsuccessful_mitigation';
        if (isBlocked) return `Blocked: ${payload.attack_type || 'Attack'}`;
        if (isHit) return `Hit: ${payload.attack_type || 'Attack'}`;
        return `Resolved: ${result}`;
      case 'alert_emitted':
        return `Alert: ${payload.severity?.toUpperCase() || 'Unknown'}`;
      case 'action_taken':
      case 'ACTION_TAKEN':
        const actionType = payload.type?.replace(/_/g, ' ') || 'Unknown';
        const target = payload.target || 'Unknown';
        return `Blue: ${actionType} → ${target}`;
      case 'score_update':
        return `Score: R${payload.red || 0} B${payload.blue || 0}`;
      case 'round_started':
        return `Round Started`;
      case 'round_ended':
        return `Round Ended`;
      case 'turn_changed':
        const turn = payload.turn?.toUpperCase() || 'Unknown';
        const reason = payload.reason || 'unknown';
        return `Turn: ${turn} (${reason.replace(/_/g, ' ')})`;
      case 'turn_timeout':
        const expiredTurn = payload.expired_turn?.toUpperCase() || 'Unknown';
        const newTurn = payload.new_turn?.toUpperCase() || 'Unknown';
        return `Turn Timeout: ${expiredTurn} → ${newTurn}`;
      case 'scan_completed':
        const tool = payload.tool || 'Unknown';
        const success = payload.success ? 'Success' : 'Failed';
        return `Scan: ${tool} (${success})`;
      default:
        return kind;
    }
  };
  
  // Find the result of a Blue Team action
  const getActionResult = (event: Event): { result: string; attackType: string; scoreChange: number } | null => {
    const eventKind = typeof event.kind === 'string' ? event.kind : (event.kind as any)?.value || '';
    if (eventKind !== 'action_taken' && eventKind !== 'ACTION_TAKEN') return null;
    
    const eventIndex = sortedEvents.findIndex(e => e.id === event.id);
    if (eventIndex === -1) return null;
    
    // Look for the next resolved event that this action might have contributed to
    const nextResolved = sortedEvents.slice(eventIndex + 1).find(
      e => e.kind === 'attack_resolved' && !e.payload.preliminary
    );
    
    if (!nextResolved) return null;
    
    const resolved = nextResolved.payload;
    const scoreDelta = resolved.score_deltas?.blue || 0;
    
    return {
      result: resolved.result || 'unknown',
      attackType: resolved.attack_type || 'Unknown',
      scoreChange: scoreDelta,
    };
  };
  
  // Get effectiveness indicator for Blue actions
  const getActionEffectiveness = (event: Event): { label: string; color: string } | null => {
    const eventKind = typeof event.kind === 'string' ? event.kind : (event.kind as any)?.value || '';
    if (eventKind !== 'action_taken' && eventKind !== 'ACTION_TAKEN') return null;
    
    // Find the next attack_resolved event that might be related
    const eventIndex = sortedEvents.findIndex(e => e.id === event.id);
    if (eventIndex === -1) return null;
    
    // Look for the next resolved event
    const nextResolved = sortedEvents.slice(eventIndex + 1).find(e => e.kind === 'attack_resolved' && !e.payload.preliminary);
    if (!nextResolved) return null;
    
    const resolved = nextResolved.payload;
    if (resolved.result === 'blocked' || resolved.result === 'successful_block' || resolved.result === 'successful_mitigation') {
      return { label: 'Blocked Attack', color: 'text-green-400' };
    } else if (resolved.result === 'hit' || resolved.result === 'unsuccessful_block' || resolved.result === 'unsuccessful_mitigation') {
      return { label: 'Attack Hit', color: 'text-red-400' };
    } else if (resolved.result === 'detected') {
      return { label: 'Detected', color: 'text-yellow-400' };
    }
    return null;
  };

  if (sortedEvents.length === 0) {
    return (
      <div className="bg-slate-800 rounded-2xl p-6">
        <h2 className="text-xl font-semibold mb-4">Timeline</h2>
        <div className="text-slate-400 text-center py-4">No events yet</div>
      </div>
    );
  }

  return (
    <div className="bg-slate-800 rounded-2xl p-6">
      <h2 className="text-xl font-semibold mb-4">Event Timeline</h2>
      
      {/* Horizontal timeline view */}
      <div className="mb-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {sortedEvents.map((event, index) => (
            <div
              key={event.id}
              className="group relative flex-shrink-0"
            >
              <div
                className={`w-4 h-4 rounded-full ${getEventColor(event.kind)} cursor-pointer hover:scale-125 transition-transform`}
                onClick={() => setExpandedEvent(expandedEvent === event.id ? null : event.id)}
                title={`${getEventLabel(event)} - ${new Date(event.ts).toLocaleTimeString()}`}
              />
              {index < sortedEvents.length - 1 && (
                <div className="absolute top-2 left-4 w-8 h-0.5 bg-slate-600" />
              )}
              
              {/* Tooltip */}
              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-slate-700 text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                {getEventLabel(event)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detailed event list */}
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {sortedEvents.slice(-10).reverse().map((event) => {
          const isExpanded = expandedEvent === event.id;
          const payload = event.payload || {};
          
          return (
            <div
              key={event.id}
              className={`bg-slate-700 rounded-lg p-3 cursor-pointer hover:bg-slate-600 transition-colors ${
                isExpanded ? 'ring-2 ring-blue-500' : ''
              }`}
              onClick={() => setExpandedEvent(isExpanded ? null : event.id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className={`w-3 h-3 rounded-full flex-shrink-0 ${getEventColor(event.kind)}`} />
                  <span className="font-semibold text-sm truncate">{getEventLabel(event)}</span>
                  {/* Show result badge for blue actions with results */}
                  {(getEventKind(event.kind) === 'action_taken') && (() => {
                    const actionResult = getActionResult(event);
                    if (actionResult) {
                      return (
                        <span className={`ml-2 px-2 py-0.5 rounded text-xs font-semibold flex-shrink-0 ${
                          actionResult.result === 'blocked' ? 'bg-green-900/50 text-green-300' :
                          actionResult.result === 'hit' ? 'bg-red-900/50 text-red-300' :
                          actionResult.result === 'detected' ? 'bg-yellow-900/50 text-yellow-300' :
                          'bg-slate-700 text-slate-300'
                        }`}>
                          {actionResult.result === 'blocked' ? 'Blocked' :
                           actionResult.result === 'hit' ? 'Hit' :
                           actionResult.result === 'detected' ? 'Detected' :
                           actionResult.result}
                        </span>
                      );
                    }
                    return null;
                  })()}
                </div>
                <span className="text-xs text-slate-400 flex-shrink-0 ml-2">
                  {new Date(event.ts).toLocaleTimeString()}
                </span>
              </div>
              
                  {isExpanded && (() => {
                const normalizedKind = getEventKind(event.kind);
                return (
                <div className="mt-2 pt-2 border-t border-slate-600 text-xs text-slate-300">
                  <div className="font-semibold mb-1">{normalizedKind.replace(/_/g, ' ')}</div>
                  {(normalizedKind === 'attack_launched') && (
                    <div>
                      <div>Type: {payload.attack_type}</div>
                      <div>From: {payload.from} → To: {payload.to}</div>
                    </div>
                  )}
                  {(normalizedKind === 'attack_resolved') && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`font-bold text-lg ${
                          payload.result === 'blocked' ? 'text-green-400' :
                          payload.result === 'hit' ? 'text-red-400' :
                          'text-yellow-400'
                        }`}>
                          {payload.result === 'blocked' ? 'BLOCKED' :
                           payload.result === 'hit' ? 'HIT' :
                           'DETECTED'}
                        </div>
                      </div>
                      <div className="mb-2">Attack Type: <span className="font-semibold">{payload.attack_type || 'Unknown'}</span></div>
                      {payload.blue_actions_count !== undefined && (
                        <div className="mb-2">
                          <span className="text-blue-400">Blue Actions:</span> {payload.blue_actions_count}
                        </div>
                      )}
                      {payload.blue_actions && Array.isArray(payload.blue_actions) && payload.blue_actions.length > 0 && (
                        <div className="mb-2 pt-2 border-t border-slate-600">
                          <div className="text-blue-300 font-semibold mb-1">Blue Team Responses:</div>
                          {payload.blue_actions.map((action: any, idx: number) => (
                            <div key={idx} className="text-xs text-slate-300 ml-2 mb-1">
                              • {action.type?.replace(/_/g, ' ')} → {action.target}
                              {action.note && (
                                <span className="text-slate-400 italic"> - {action.note}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {payload.action_evaluations && Array.isArray(payload.action_evaluations) && payload.action_evaluations.length > 0 && (
                        <div className="mb-2 pt-2 border-t border-slate-600 space-y-2">
                          <div className="text-blue-300 font-semibold mb-1">Blue Team Actions & Results:</div>
                          {payload.action_evaluations.map((evaluation: any, idx: number) => (
                            <div key={idx} className={`text-xs ml-2 p-2 rounded border ${
                              evaluation.result === 'successful_block'
                                ? 'bg-green-900/20 border-green-600/50'
                                : evaluation.result === 'successful_mitigation'
                                ? 'bg-green-800/15 border-green-500/50'
                                : evaluation.result === 'unsuccessful_block'
                                ? 'bg-yellow-900/20 border-yellow-600/50'
                                : 'bg-red-900/20 border-red-600/50'
                            }`}>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-semibold text-slate-200">• {evaluation.action_type?.replace(/_/g, ' ')} → {evaluation.target}</span>
                                <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${
                                  evaluation.result === 'successful_block' ? 'bg-green-700 text-white' :
                                  evaluation.result === 'successful_mitigation' ? 'bg-green-600 text-white' :
                                  evaluation.result === 'unsuccessful_block' ? 'bg-yellow-700 text-white' :
                                  'bg-red-700 text-white'
                                }`}>
                                  {evaluation.result.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}
                                </span>
                                <span className={`font-bold ${evaluation.points >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                  {evaluation.points >= 0 ? '+' : ''}{evaluation.points} pts
                                </span>
                              </div>
                              {evaluation.reason && (
                                <div className={`mt-1 p-1.5 rounded text-xs ${
                                  evaluation.result === 'successful_block' || evaluation.result === 'successful_mitigation'
                                    ? 'bg-green-900/20 text-green-200'
                                    : 'bg-slate-800/50 text-slate-300'
                                }`}>
                                  <span className="font-semibold">Why: </span>
                                  <span className="italic">{evaluation.reason}</span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {payload.effectiveness && (
                        <div className="mb-2 pt-2 border-t border-slate-600">
                          <div className="text-sm font-semibold mb-1">Effectiveness:</div>
                          <div className="text-xs space-y-1">
                            {payload.effectiveness.blocked && <div className="text-green-400">Attack Blocked</div>}
                            {payload.effectiveness.detected && <div className="text-yellow-400">Attack Detected</div>}
                            {payload.effectiveness.quick_response && <div className="text-blue-400">Quick Response</div>}
                            {payload.effectiveness.correct_attribution && <div className="text-green-400">Correct Attribution</div>}
                            {!payload.effectiveness.blocked && !payload.effectiveness.detected && !payload.effectiveness.quick_response && !payload.effectiveness.correct_attribution && (
                              <div className="text-slate-400">No significant effectiveness indicators</div>
                            )}
                          </div>
                        </div>
                      )}
                      {payload.score_explanation && (
                        <div className="mb-2 pt-2 border-t border-slate-600">
                          <div className="text-sm font-semibold mb-1">Score Impact:</div>
                          <div className="text-xs text-slate-300">{payload.score_explanation}</div>
                        </div>
                      )}
                      {payload.score_deltas && (
                        <div className="mt-2 pt-2 border-t border-slate-600">
                          <div className="text-sm font-semibold mb-1">Score Changes:</div>
                          <div className="flex gap-4 text-sm">
                            <div>
                              <span className="text-red-400">Red:</span> {payload.score_deltas.red >= 0 ? '+' : ''}{payload.score_deltas.red || 0}
                            </div>
                            <div>
                              <span className="text-blue-400">Blue:</span> {payload.score_deltas.blue >= 0 ? '+' : ''}{payload.score_deltas.blue || 0}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {(normalizedKind === 'action_taken') && (() => {
                    const actionResult = getActionResult(event);
                    const effectiveness = getActionEffectiveness(event);
                    
                    return (
                      <div>
                        <div className="font-semibold text-blue-300 mb-2">Blue Team Response</div>
                        <div className="space-y-1 text-sm">
                          <div><span className="text-slate-400">Action:</span> <span className="font-semibold">{payload.type?.replace(/_/g, ' ') || 'Unknown'}</span></div>
                          <div><span className="text-slate-400">Target:</span> <span className="font-semibold">{payload.target || 'Unknown'}</span></div>
                          {payload.note && (
                            <div className="mt-2 pt-2 border-t border-slate-600">
                              <div className="text-slate-400 mb-1">Note:</div>
                              <div className="text-slate-300">{payload.note}</div>
                            </div>
                          )}
                          {payload.timestamp && (
                            <div className="text-xs text-slate-500 mt-2">
                              Time: {new Date(payload.timestamp).toLocaleTimeString()}
                            </div>
                          )}
                        </div>
                        
                        {/* Show result and effectiveness */}
                        {actionResult && (
                          <div className="mt-3 pt-3 border-t border-slate-600">
                            <div className="text-sm font-semibold mb-2">Result:</div>
                            <div className="space-y-2">
                              <div className={`flex items-center gap-2 font-semibold ${
                                actionResult.result === 'blocked' ? 'text-green-400' :
                                actionResult.result === 'hit' ? 'text-red-400' :
                                actionResult.result === 'detected' ? 'text-yellow-400' :
                                'text-slate-400'
                              }`}>
                                {actionResult.result === 'blocked' && 'Attack Blocked'}
                                {actionResult.result === 'hit' && 'Attack Hit'}
                                {actionResult.result === 'detected' && 'Attack Detected'}
                                {!['blocked', 'hit', 'detected'].includes(actionResult.result) && `Result: ${actionResult.result}`}
                              </div>
                              <div className="text-xs text-slate-400">
                                Attack: {actionResult.attackType}
                              </div>
                              {actionResult.scoreChange !== 0 && (
                                <div className={`text-sm font-semibold ${
                                  actionResult.scoreChange > 0 ? 'text-green-400' : 'text-red-400'
                                }`}>
                                  Score: {actionResult.scoreChange > 0 ? '+' : ''}{actionResult.scoreChange}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                        
                        {/* Show effectiveness indicators */}
                        {effectiveness && (
                          <div className={`mt-2 pt-2 border-t border-slate-600 text-xs ${effectiveness.color} font-semibold`}>
                            {effectiveness.label}
                          </div>
                        )}
                        
                        {/* If no result yet, show pending status */}
                        {!actionResult && !effectiveness && (
                          <div className="mt-2 pt-2 border-t border-slate-600 text-xs text-slate-500 italic">
                            Waiting for attack resolution...
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {normalizedKind === 'score_update' && (
                    <div>
                      <div>Red: {payload.red || 0}</div>
                      <div>Blue: {payload.blue || 0}</div>
                    </div>
                  )}
                  {normalizedKind === 'alert_emitted' && (
                    <div>
                      <div>Source: {payload.source}</div>
                      <div>Severity: {payload.severity}</div>
                      <div>Summary: {payload.summary}</div>
                    </div>
                  )}
                  {normalizedKind === 'turn_changed' && (
                    <div>
                      <div className="font-semibold text-cyan-300 mb-2">Turn Changed</div>
                      <div className="space-y-1 text-sm">
                        <div><span className="text-slate-400">New Turn:</span> <span className="font-semibold text-cyan-400">{payload.turn?.toUpperCase() || 'Unknown'}</span></div>
                        {payload.previous_turn && (
                          <div><span className="text-slate-400">Previous Turn:</span> <span className="font-semibold">{payload.previous_turn.toUpperCase()}</span></div>
                        )}
                        {payload.reason && (
                          <div><span className="text-slate-400">Reason:</span> <span className="font-semibold">{payload.reason.replace(/_/g, ' ')}</span></div>
                        )}
                        {payload.turn_start_time && (
                          <div className="text-xs text-slate-500 mt-2">
                            Turn Start: {new Date(payload.turn_start_time).toLocaleTimeString()}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {normalizedKind === 'turn_timeout' && (
                    <div>
                      <div className="font-semibold text-cyan-300 mb-2">Turn Timeout</div>
                      <div className="space-y-1 text-sm">
                        <div><span className="text-slate-400">Expired Turn:</span> <span className="font-semibold text-red-400">{payload.expired_turn?.toUpperCase() || 'Unknown'}</span></div>
                        <div><span className="text-slate-400">New Turn:</span> <span className="font-semibold text-cyan-400">{payload.new_turn?.toUpperCase() || 'Unknown'}</span></div>
                        {payload.elapsed_seconds !== undefined && (
                          <div><span className="text-slate-400">Elapsed:</span> <span className="font-semibold">{payload.elapsed_seconds}s</span></div>
                        )}
                        {payload.reason && (
                          <div><span className="text-slate-400">Reason:</span> <span className="font-semibold">{payload.reason.replace(/_/g, ' ')}</span></div>
                        )}
                      </div>
                    </div>
                  )}
                  {normalizedKind === 'scan_completed' && (
                    <div>
                      <div className="font-semibold text-indigo-300 mb-2">Scan Completed</div>
                      <div className="space-y-1 text-sm">
                        <div><span className="text-slate-400">Tool:</span> <span className="font-semibold">{payload.tool || 'Unknown'}</span></div>
                        <div><span className="text-slate-400">Target:</span> <span className="font-semibold">{payload.target_node || 'Unknown'}</span></div>
                        <div><span className="text-slate-400">Result:</span> <span className={`font-semibold ${payload.success ? 'text-green-400' : 'text-red-400'}`}>
                          {payload.success ? 'Success' : 'Failed'}
                        </span></div>
                        {payload.message && (
                          <div className="mt-2 pt-2 border-t border-slate-600 text-xs text-slate-300">
                            {payload.message}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                );
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}


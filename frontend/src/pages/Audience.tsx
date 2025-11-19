import { useEffect, useMemo, memo, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../store/useGameStore';
import { scenariosApi, gameApi } from '../api/client';
import { useWebSocket } from '../hooks/useWebSocket';
import PewPewMap from '../components/PewPewMap';
import ScorePanel from '../components/ScorePanel';
import TimelineStrip from '../components/TimelineStrip';
import GameBanner from '../components/GameBanner';
import { Node, Link, Event } from '../api/types';
import { isPewPewAudienceEnabled, codesOn } from '../lib/flags';
import AudiencePewPewMap from '../components/audience/PewPewMap';
import StatusPill from '../components/ui/StatusPill';
import { toPewEvents, demoPewStream, type PewEvent } from '../lib/pewpew';
import MapAnimationOverlay, { BLUE_CASTLE, RED_SKULL, type MapAnimationAPI } from '../components/map/MapAnimationOverlay';

// Memoized map component to prevent unnecessary re-renders (legacy view)
const MemoizedMap = memo(({ nodes, links, liveEvents }: { nodes: Node[]; links: Link[]; liveEvents: Event[] }) => {
  const memoizedNodes = useMemo(() => nodes, [JSON.stringify(nodes.map(n => n.id).sort())]);
  const memoizedLinks = useMemo(() => links, [JSON.stringify(links.map(l => `${l.from_id}-${l.to_id}`).sort())]);
  const memoizedEvents = useMemo(() => liveEvents, [liveEvents.length, liveEvents.map(e => e.id).join(',')]);
  
  return (
    <PewPewMap
      nodes={memoizedNodes}
      links={memoizedLinks}
      liveEvents={memoizedEvents}
    />
  );
});

MemoizedMap.displayName = 'MemoizedMap';


export default function Audience() {
  const navigate = useNavigate();
  const { gameState, currentScenario, setCurrentScenario, setGameState, events, authToken, role, sessionId } = useGameStore();
  const enabled = isPewPewAudienceEnabled();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  
  // Check authentication immediately
  useEffect(() => {
    if (codesOn()) {
      if (!authToken || !sessionId || role !== 'audience') {
        navigate('/', { replace: true });
        setIsAuthenticated(false);
        return;
      }
      setIsAuthenticated(true);
    } else {
      setIsAuthenticated(true);
    }
  }, [authToken, sessionId, role, navigate]);

  // Pew-pew event state
  const [pewEvents, setPewEvents] = useState<PewEvent[]>([]);
  const evBufRef = useRef<PewEvent[]>([]);

  // Map dimensions state
  const [mapWidth, setMapWidth] = useState(1200);
  const [mapHeight, setMapHeight] = useState(600);
  
  // Animation overlay ref
  const animationOverlayRef = useRef<MapAnimationAPI | null>(null);

  // Track processed event IDs to avoid duplicates (must be before conditional returns)
  const processedEventIds = useRef<Set<string>>(new Set());

  useWebSocket('audience');

  // Define loadGameState before it's used
  const loadGameState = async () => {
    try {
      const state = await gameApi.getState();
      setGameState(state);
      console.log('[Audience] Loaded game state:', state);
    } catch (error) {
      console.error('[Audience] Failed to load game state:', error);
    }
  };

  // Define loadScenario before it's used in useEffect
  const loadScenario = async (id: string) => {
    try {
      const scenario = await scenariosApi.get(id);
      setCurrentScenario(scenario);
    } catch (error) {
      console.error('Failed to load scenario:', error);
    }
  };

  // Load game state on mount
  useEffect(() => {
    loadGameState();
  }, []);

  // Periodically refresh game state to ensure we have the latest status
  useEffect(() => {
    const interval = setInterval(() => {
      loadGameState().catch(err => console.error('[Audience] Failed to refresh game state:', err));
    }, 5000); // Refresh every 5 seconds

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (gameState?.current_scenario_id && !currentScenario) {
      loadScenario(gameState.current_scenario_id);
    }
  }, [gameState]);

  // Convert game events to pew-pew events (when feature enabled)
  // MUST be before conditional returns to comply with Rules of Hooks
  useEffect(() => {
    if (!enabled) return;

    console.log('[Audience] Total events in store:', events.length);
    console.log('[Audience] Event kinds:', events.map(e => ({ kind: e.kind, id: e.id, attack_id: e.payload?.attack_id, result: e.payload?.result })));

    // Filter out already processed events (but allow attack_resolved to update existing)
    const newEvents = events.filter(e => {
      // Always process attack_resolved events (they update existing attacks)
      if (e.kind === 'attack_resolved') {
        console.log('[Audience] Processing attack_resolved event:', e.id, 'attack_id:', e.payload?.attack_id, 'result:', e.payload?.result, 'preliminary:', e.payload?.preliminary);
        return true;
      }
      // Only process new events
      const isNew = !processedEventIds.current.has(e.id);
      if (!isNew) {
        console.log('[Audience] Skipping already processed event:', e.id);
      }
      return isNew;
    });
    
    console.log('[Audience] New events to process:', newEvents.length);
    
    // Convert real game events
    const pewEventsFromGame = toPewEvents(newEvents);
    console.log('[Audience] Converted to pew events:', pewEventsFromGame.length, pewEventsFromGame.map(e => ({ id: e.id, attack_id: e.attack_id, result: e.result, state: e.state })));
    
    // Mark events as processed (except attack_resolved which can update)
    newEvents.forEach(e => {
      if (e.kind !== 'attack_resolved') {
        processedEventIds.current.add(e.id);
      }
    });
    
    if (pewEventsFromGame.length > 0) {
      evBufRef.current.push(...pewEventsFromGame);
      
      // Batch updates
      if (evBufRef.current.length > 4) {
        setPewEvents((prev) => [...prev, ...evBufRef.current]);
        evBufRef.current = [];
      } else {
        // Still update even with small batches
        setPewEvents((prev) => [...prev, ...pewEventsFromGame]);
      }
    }
  }, [events, enabled]);

  // Don't render if not authenticated (AFTER all hooks are called)
  if (codesOn() && !isAuthenticated) {
    return null;
  }

  // Demo stream disabled - only use real game events
  // The demo stream is now disabled to show only real attack animations

  if (!gameState || gameState.status !== 'running') {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-xl mb-4">Waiting for game to start...</div>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg"
          >
            Back to Lobby
          </button>
        </div>
      </div>
    );
  }

  // New pew-pew layout (feature-flagged)
  if (enabled) {
    // Calculate statistics from events
    const attackEvents = events.filter(e => 
      e.kind === 'attack_launched' || e.kind === 'attack_resolved'
    );
    const resolvedAttacks = events.filter(e => 
      e.kind === 'attack_resolved' && !e.payload?.preliminary
    );
    const blockedCount = resolvedAttacks.filter(e => {
      const result = e.payload?.result;
      return result === 'blocked' || result === 'successful_block' || result === 'successful_mitigation';
    }).length;
    const hitCount = resolvedAttacks.filter(e => {
      const result = e.payload?.result;
      return result === 'hit' || result === 'unsuccessful_block' || result === 'unsuccessful_mitigation';
    }).length;
    const defenseActions = events.filter(e => 
      e.kind === 'action_taken' || e.kind === 'ACTION_TAKEN'
    );

    return (
      <div className="min-h-screen bg-slate-900 text-white">
        {/* Game Banner */}
        <GameBanner />
        
        <div className="container mx-auto px-4 sm:px-6 py-6 max-w-7xl">
          <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
            <div className="flex items-center gap-4 min-w-0 flex-1">
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-200 truncate">Audience View</h1>
              <StatusPill intent="neutral" label="Mode" value="Live Map" />
            </div>
            <div className="flex items-center gap-4 flex-shrink-0">
              <button
                onClick={() => navigate('/')}
                className="px-3 sm:px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm sm:text-base whitespace-nowrap"
              >
                Back to Lobby
              </button>
            </div>
          </header>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Main Map Area */}
            <div className="lg:col-span-3 space-y-6">
              {/* Map Container */}
              <div className="bg-slate-800 rounded-2xl p-4 sm:p-6 shadow-lg border border-slate-700">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold text-slate-200">Live Attack Map</h2>
                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-orange-500"></div>
                      <span className="text-slate-400">Attack</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-green-500"></div>
                      <span className="text-slate-400">Blocked</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-red-500"></div>
                      <span className="text-slate-400">Hit</span>
                    </div>
                  </div>
                </div>
                <div className="relative w-full bg-slate-900 rounded-lg overflow-hidden" style={{ minHeight: '500px' }}>
                  {/* Background map with baked-in icons */}
                  <div className="relative z-0 w-full h-full">
                    <img
                      src="/images/background.png"
                      alt="Global cyber command map"
                      className="w-full h-full object-cover"
                      style={{ aspectRatio: '2/1' }}
                      onLoad={(e) => {
                        const img = e.currentTarget;
                        setMapWidth(img.clientWidth);
                        setMapHeight(img.clientHeight);
                      }}
                    />
                  </div>
                  
                  {/* Animation overlay */}
                  <div className="absolute inset-0 z-10 pointer-events-none">
                    <MapAnimationOverlay
                      ref={animationOverlayRef}
                      width={mapWidth}
                      height={mapHeight}
                      fps={60}
                    />
                  </div>
                  
                  {/* Animated pew-pew map with attack trails (overlay) */}
                  <div className="absolute inset-0 z-20 pointer-events-none">
                    <AudiencePewPewMap 
                      events={pewEvents} 
                      width={mapWidth} 
                      height={mapHeight}
                      transparentBackground={true}
                    />
                    <div className="pewpew-scanlines" />
                  </div>
                </div>
              </div>

              {/* Event Timeline */}
              <div className="bg-slate-800 rounded-2xl p-4 sm:p-6 shadow-lg border border-slate-700">
                <h2 className="text-xl font-semibold mb-4 text-slate-200">Event Timeline</h2>
                <TimelineStrip />
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Score Panel */}
              <ScorePanel />

              {/* Statistics */}
              <div className="bg-slate-800 rounded-2xl p-4 sm:p-6 shadow-lg border border-slate-700">
                <h2 className="text-lg font-semibold mb-4 text-slate-200">Battle Statistics</h2>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-700/50 rounded-lg p-3 border border-slate-600">
                      <div className="text-xs text-slate-400 mb-1">Total Attacks</div>
                      <div className="text-2xl font-bold text-orange-400">{attackEvents.filter(e => e.kind === 'attack_launched').length}</div>
                    </div>
                    <div className="bg-slate-700/50 rounded-lg p-3 border border-slate-600">
                      <div className="text-xs text-slate-400 mb-1">Defense Actions</div>
                      <div className="text-2xl font-bold text-blue-400">{defenseActions.length}</div>
                    </div>
                    <div className="bg-slate-700/50 rounded-lg p-3 border border-slate-600">
                      <div className="text-xs text-slate-400 mb-1">Blocked</div>
                      <div className="text-2xl font-bold text-green-400">{blockedCount}</div>
                    </div>
                    <div className="bg-slate-700/50 rounded-lg p-3 border border-slate-600">
                      <div className="text-xs text-slate-400 mb-1">Hits</div>
                      <div className="text-2xl font-bold text-red-400">{hitCount}</div>
                    </div>
                  </div>
                  
                  {resolvedAttacks.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-slate-700">
                      <div className="text-sm text-slate-400 mb-2">Defense Success Rate</div>
                      <div className="w-full bg-slate-700 rounded-full h-3">
                        <div
                          className="bg-green-500 h-3 rounded-full transition-all duration-500"
                          style={{ width: `${(blockedCount / resolvedAttacks.length) * 100}%` }}
                        />
                      </div>
                      <div className="text-xs text-slate-500 mt-1 text-right">
                        {Math.round((blockedCount / resolvedAttacks.length) * 100)}%
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Recent Defense Actions */}
              {defenseActions.length > 0 && (
                <div className="bg-slate-800 rounded-2xl p-4 sm:p-6 shadow-lg border border-slate-700">
                  <h2 className="text-lg font-semibold mb-4 text-slate-200">Recent Defenses</h2>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {defenseActions.slice(-5).reverse().map((action) => {
                      const actionType = action.payload?.type?.replace(/_/g, ' ') || 'Unknown';
                      const target = action.payload?.target || 'Unknown';
                      return (
                        <div key={action.id} className="bg-slate-700/50 rounded-lg p-2 border border-slate-600">
                          <div className="text-xs text-blue-300 font-semibold">{actionType}</div>
                          <div className="text-xs text-slate-400 mt-1">Target: {target}</div>
                          <div className="text-xs text-slate-500 mt-1">
                            {new Date(action.ts).toLocaleTimeString()}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Legacy audience layout (when flag is off)
  // Calculate statistics
  const attackEvents = events.filter(e => 
    e.kind === 'attack_launched' || e.kind === 'attack_resolved'
  );
  const resolvedAttacks = events.filter(e => 
    e.kind === 'attack_resolved' && !e.payload?.preliminary
  );
  const blockedCount = resolvedAttacks.filter(e => {
    const result = e.payload?.result;
    return result === 'blocked' || result === 'successful_block' || result === 'successful_mitigation';
  }).length;
  const hitCount = resolvedAttacks.filter(e => {
    const result = e.payload?.result;
    return result === 'hit' || result === 'unsuccessful_block' || result === 'unsuccessful_mitigation';
  }).length;
  const defenseActions = events.filter(e => 
    e.kind === 'action_taken' || e.kind === 'ACTION_TAKEN'
  );

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Game Banner */}
      <GameBanner />
      
      <div className="container mx-auto px-4 sm:px-6 py-6 max-w-7xl">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div className="flex items-center gap-4 min-w-0 flex-1">
            <h1 className="text-2xl sm:text-3xl font-bold truncate">Audience View</h1>
          </div>
          <div className="flex items-center gap-4 flex-shrink-0">
            <button
              onClick={() => navigate('/')}
              className="px-3 sm:px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm sm:text-base whitespace-nowrap"
            >
              Back to Lobby
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main Map - Full Width */}
          <div className="lg:col-span-3 space-y-6">
            <div className="bg-slate-800 rounded-2xl p-4 sm:p-6 shadow-lg border border-slate-700">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-slate-200">Network Attack Map</h2>
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-orange-500"></div>
                    <span className="text-slate-400">Attack</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-green-500"></div>
                    <span className="text-slate-400">Blocked</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500"></div>
                    <span className="text-slate-400">Hit</span>
                  </div>
                </div>
              </div>
              <div className="h-[500px] sm:h-[600px]">
                {currentScenario ? (
                  <MemoizedMap
                    nodes={currentScenario.topology.nodes}
                    links={currentScenario.topology.links}
                    liveEvents={events}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-slate-400">
                    No scenario loaded
                  </div>
                )}
              </div>
            </div>

            {/* Timeline */}
            <div className="bg-slate-800 rounded-2xl p-4 sm:p-6 shadow-lg border border-slate-700">
              <h2 className="text-xl font-semibold mb-4 text-slate-200">Event Timeline</h2>
              <TimelineStrip />
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Score Panel */}
            <ScorePanel />

            {/* Statistics */}
            <div className="bg-slate-800 rounded-2xl p-4 sm:p-6 shadow-lg border border-slate-700">
              <h2 className="text-lg font-semibold mb-4 text-slate-200">Battle Statistics</h2>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-700/50 rounded-lg p-3 border border-slate-600">
                    <div className="text-xs text-slate-400 mb-1">Total Attacks</div>
                    <div className="text-xl sm:text-2xl font-bold text-orange-400">{attackEvents.filter(e => e.kind === 'attack_launched').length}</div>
                  </div>
                  <div className="bg-slate-700/50 rounded-lg p-3 border border-slate-600">
                    <div className="text-xs text-slate-400 mb-1">Defense Actions</div>
                    <div className="text-xl sm:text-2xl font-bold text-blue-400">{defenseActions.length}</div>
                  </div>
                  <div className="bg-slate-700/50 rounded-lg p-3 border border-slate-600">
                    <div className="text-xs text-slate-400 mb-1">Blocked</div>
                    <div className="text-xl sm:text-2xl font-bold text-green-400">{blockedCount}</div>
                  </div>
                  <div className="bg-slate-700/50 rounded-lg p-3 border border-slate-600">
                    <div className="text-xs text-slate-400 mb-1">Hits</div>
                    <div className="text-xl sm:text-2xl font-bold text-red-400">{hitCount}</div>
                  </div>
                </div>
                
                {resolvedAttacks.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-slate-700">
                    <div className="text-sm text-slate-400 mb-2">Defense Success Rate</div>
                    <div className="w-full bg-slate-700 rounded-full h-3">
                      <div
                        className="bg-green-500 h-3 rounded-full transition-all duration-500"
                        style={{ width: `${(blockedCount / resolvedAttacks.length) * 100}%` }}
                      />
                    </div>
                    <div className="text-xs text-slate-500 mt-1 text-right">
                      {Math.round((blockedCount / resolvedAttacks.length) * 100)}%
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Recent Defense Actions */}
            {defenseActions.length > 0 && (
              <div className="bg-slate-800 rounded-2xl p-4 sm:p-6 shadow-lg border border-slate-700">
                <h2 className="text-lg font-semibold mb-4 text-slate-200">Recent Defenses</h2>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {defenseActions.slice(-5).reverse().map((action) => {
                    const actionType = action.payload?.type?.replace(/_/g, ' ') || 'Unknown';
                    const target = action.payload?.target || 'Unknown';
                    return (
                      <div key={action.id} className="bg-slate-700/50 rounded-lg p-2 border border-slate-600">
                        <div className="text-xs text-blue-300 font-semibold">{actionType}</div>
                        <div className="text-xs text-slate-400 mt-1">Target: {target}</div>
                        <div className="text-xs text-slate-500 mt-1">
                          {new Date(action.ts).toLocaleTimeString()}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


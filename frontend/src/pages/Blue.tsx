import { useEffect, useState, useMemo, memo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../store/useGameStore';
import { scenariosApi, gameApi, scoreApi, playersApi } from '../api/client';
import { Scenario, Node, Link, Event } from '../api/types';
import { useWebSocket } from '../hooks/useWebSocket';
import { codesOn } from '../lib/flags';
import PewPewMap from '../components/PewPewMap';
import AlertFeed from '../components/AlertFeed';
import ActionPalette from '../components/ActionPalette';
import TimelineStrip from '../components/TimelineStrip';
import ScorePanel from '../components/ScorePanel';
import GameBanner from '../components/GameBanner';
import BlueBriefing from '../components/BlueBriefing';
import TeamChat from '../components/TeamChat';
import ActivityFeed from '../components/ActivityFeed';
import PresenceIndicator from '../components/PresenceIndicator';

// Memoized map component to prevent unnecessary re-renders
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

export default function Blue() {
  const navigate = useNavigate();
  const { gameState, currentScenario, setCurrentScenario, setGameState, events, authToken, role, sessionId, playerName, setPlayerName } = useGameStore();
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [hasCheckedAuth, setHasCheckedAuth] = useState(false);
  const [blockedNotification, setBlockedNotification] = useState<{ show: boolean; attackType?: string; attackId?: string; success?: boolean }>({ show: false });
  const processedBlockedEvents = useRef<Set<string>>(new Set());
  const [showBriefing, setShowBriefing] = useState(false);
  const briefingShownRef = useRef<Set<string>>(new Set());
  const [hasSeenRunning, setHasSeenRunning] = useState(false); // Track if we've seen the game running

  // Track if we've had time to check authentication (prevents premature redirects)
  // This MUST be called before any early returns to ensure hooks are called in the same order
  useEffect(() => {
    // Give authentication check time to run
    const timer = setTimeout(() => {
      setHasCheckedAuth(true);
    }, 200);
    return () => clearTimeout(timer);
  }, []);

  // Check authentication immediately
  // If codes are enabled, require auth/session only if they used a code
  // If codes are disabled OR no code was used (lobby mode), allow access
  useEffect(() => {
    // Small delay to allow store to hydrate and role to be set
    const timer = setTimeout(() => {
      if (codesOn()) {
        // Codes enabled - check if player used a code (has authToken/sessionId)
        // If they have a code, require it; if not (lobby mode), allow access
        if (authToken && sessionId) {
          // Player used a code - verify it matches their role
          if (role && role !== 'blue') {
            console.log('[Blue] Role mismatch - redirecting to lobby. Role:', role, 'Expected: blue');
            navigate('/', { replace: true });
            setIsAuthenticated(false);
            return;
          }
          // If role is null/undefined, wait a bit more for it to be set
          if (role === 'blue') {
            setIsAuthenticated(true);
          } else if (role === null || role === undefined) {
            // Role not set yet, wait for it (don't redirect yet)
            console.log('[Blue] Waiting for role to be set...');
            setIsAuthenticated(false);
          } else {
            // Role is set but not 'blue' - redirect
            console.log('[Blue] Invalid role - redirecting to lobby. Role:', role);
            navigate('/', { replace: true });
            setIsAuthenticated(false);
          }
        } else {
          // No code used - lobby mode, allow access if role is set to 'blue'
          if (role === 'blue') {
            setIsAuthenticated(true);
          } else if (role === null || role === undefined) {
            // Role not set yet, wait for it (don't redirect yet)
            console.log('[Blue] Lobby mode - waiting for role to be set...');
            setIsAuthenticated(false);
          } else {
            // Role is set but not 'blue' - this shouldn't happen in lobby mode, but don't redirect
            // Just wait for role to be corrected
            console.log('[Blue] Lobby mode - role is:', role, 'waiting for it to be set to blue');
            setIsAuthenticated(false);
          }
        }
      } else {
        // Codes disabled - legacy mode, allow access if role is set
        if (role === 'blue') {
          setIsAuthenticated(true);
        } else if (role === null || role === undefined) {
          // Role not set yet, wait for it
          setIsAuthenticated(false);
        } else {
          // Role is set but not 'blue' - don't allow access
          setIsAuthenticated(false);
        }
      }
    }, 100); // Small delay to allow store hydration
    
    return () => clearTimeout(timer);
  }, [authToken, sessionId, role, navigate]);

  // Define functions before they're used in useEffect hooks
  const loadGameState = async () => {
    try {
      const state = await gameApi.getState();
      setGameState(state);
      return state;
    } catch (error) {
      console.error('Failed to load game state:', error);
      setLoading(false);
      return null;
    }
  };

  const loadScore = async () => {
    try {
      const score = await scoreApi.get();
      const { setScore } = useGameStore.getState();
      setScore(score);
    } catch (error) {
      console.error('Failed to load score:', error);
    }
  };

  const loadScenario = async (id: string) => {
    try {
      console.log('[Blue] Loading scenario:', id);
      const scenario = await scenariosApi.get(id);
      console.log('[Blue] Scenario loaded:', scenario.name);
      setCurrentScenario(scenario);
      setLoading(false);
    } catch (error) {
      console.error('[Blue] Failed to load scenario:', error);
      setLoading(false);
    }
  };

  useWebSocket('blue');

  // Ensure player has a name assigned when joining Blue team
  useEffect(() => {
    const ensurePlayerName = async () => {
      // Only assign name if we don't have one and we're authenticated as blue team
      if (!playerName && role === 'blue' && isAuthenticated) {
        try {
          console.log('[Blue] No player name found, assigning one...');
          // In lobby mode, sessionId might be null - that's okay, backend will handle it
          const currentSessionId = sessionId || undefined;
          const nameResponse = await playersApi.assignName('blue', currentSessionId);
          setPlayerName(nameResponse.player_name);
          console.log('[Blue] Assigned name:', nameResponse.player_name);
        } catch (error: any) {
          console.error('[Blue] Failed to assign name:', error);
          // Don't block the page if name assignment fails - user can still play
          // This can happen if team is full or session is invalid
        }
      }
    };
    
    // Only run this check after authentication is confirmed
    if (isAuthenticated) {
      ensurePlayerName();
    }
  }, [role, playerName, isAuthenticated, sessionId, setPlayerName]);

  // Load game state and score on mount and when tab becomes visible
  // Only initialize after authentication is confirmed to prevent session conflicts
  useEffect(() => {
    if (!isAuthenticated && codesOn()) {
      // Wait for authentication before loading game state
      return;
    }
    
    const initialize = async () => {
      try {
        const state = await loadGameState();
        await loadScore();
        // If game is not running, we're done loading (no scenario to load)
        if (state && state.status !== 'running') {
          setLoading(false);
        }
        // If game is running, scenario loading will be handled by the scenario loading effect
      } catch (error) {
        console.error('[Blue] Failed to initialize:', error);
        setLoading(false);
      }
    };
    
    // Initialize immediately
    initialize();
    
    // Also reload when tab becomes visible (user tabs back in)
    const handleVisibilityChange = () => {
      if (!document.hidden && (codesOn() ? isAuthenticated : true)) {
        console.log('[Blue] Tab became visible, reloading game state...');
        initialize();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isAuthenticated]); // Only run when authentication status changes

  // Periodically refresh game state to ensure we have the latest status
  // This helps catch when the game starts even if WebSocket events are missed
  // Also reloads when tab becomes visible
  // Use refs to track previous values to avoid unnecessary updates
  const prevGameStatusRef = useRef<string | null>(null);
  const prevScenarioIdRef = useRef<string | null>(null);
  
  useEffect(() => {
    // Don't start periodic refresh until authenticated (if codes are enabled)
    if (codesOn() && !isAuthenticated) {
      return;
    }
    
    const refreshGameState = async () => {
      // Only refresh if tab is visible (to avoid unnecessary requests when tabbed out)
      if (document.hidden) {
        return;
      }
      
      try {
        const state = await loadGameState();
        if (!state) return;
        
        // Only update if status or scenario actually changed (prevent unnecessary re-renders)
        const statusChanged = state.status !== prevGameStatusRef.current;
        const scenarioChanged = state.current_scenario_id !== prevScenarioIdRef.current;
        
        if (statusChanged) {
          prevGameStatusRef.current = state.status;
        }
        if (scenarioChanged) {
          prevScenarioIdRef.current = state.current_scenario_id || null;
        }
        
        // Only load scenario if game is running and scenario changed
        // Also clear scenario if game is not running
        if (state.status === 'running' && state.current_scenario_id && scenarioChanged && (!currentScenario || currentScenario.id !== state.current_scenario_id)) {
          loadScenario(state.current_scenario_id).catch(err => console.error('[Blue] Failed to load scenario:', err));
        } else if (state.status !== 'running' && currentScenario) {
          // Game stopped - clear scenario
          console.log('[Blue] Game not running, clearing scenario. Status:', state.status);
          setCurrentScenario(null);
        }
      } catch (err) {
        console.error('[Blue] Failed to refresh game state:', err);
      }
    };
    
    // Initialize refs
    if (gameState) {
      prevGameStatusRef.current = gameState.status;
      prevScenarioIdRef.current = gameState.current_scenario_id || null;
    }
    
    // Initial refresh
    refreshGameState();
    
    // Refresh when tab becomes visible
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        console.log('[Blue] Tab became visible, refreshing game state...');
        refreshGameState();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Periodic refresh every 10 seconds (reduced from 5 to minimize updates)
    const interval = setInterval(refreshGameState, 10000);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isAuthenticated]); // Only depend on isAuthenticated, not currentScenario

  // Track if we've seen the game running to prevent flickering
  // Use refs to track previous values to avoid unnecessary state updates
  const prevStatusRef = useRef<string | null>(null);
  
  useEffect(() => {
    if (!gameState) return;
    
    const statusChanged = gameState.status !== prevStatusRef.current;
    
    // Update ref
    prevStatusRef.current = gameState.status;
    
    if (gameState.status === 'running') {
      if (!hasSeenRunning) {
        setHasSeenRunning(true);
      }
    } else if (statusChanged && (gameState.status === 'lobby' || gameState.status === 'finished')) {
      // Only reset hasSeenRunning when status actually changes to lobby/finished
      // This prevents flickering from temporary state updates
      setHasSeenRunning(false);
    }
  }, [gameState?.status, hasSeenRunning]);

  // Release name when component unmounts or player navigates away
  useEffect(() => {
    return () => {
      // Cleanup: release name when leaving the page
      if (playerName && role === 'blue') {
        playersApi.releaseName(playerName, 'blue', sessionId || undefined)
          .catch(error => {
            console.error('[Blue] Failed to release name on unmount:', error);
          });
        // Clear player name from store
        setPlayerName('');
      }
    };
  }, [playerName, role, sessionId, setPlayerName]);

  // Load scenario when game state changes (only when game is running)
  // Don't load scenario if game is stopped/finished to prevent conflicts
  useEffect(() => {
    // Only load scenario if game is running and there's a scenario ID
    if (gameState?.status === 'running' && gameState?.current_scenario_id) {
      // Reload scenario if it changed or if we don't have one loaded
      if (!currentScenario || currentScenario.id !== gameState.current_scenario_id) {
        console.log('[Blue] Scenario changed or not loaded:', {
          current: currentScenario?.id,
          new: gameState.current_scenario_id,
          status: gameState.status,
          round: gameState.round
        });
        loadScenario(gameState.current_scenario_id);
      } else {
        // Scenario is already loaded and matches
        setLoading(false);
      }
    } else if (gameState && (gameState.status !== 'running' || !gameState.current_scenario_id)) {
      // Game is not running or scenario was cleared - clear local scenario
      if (currentScenario) {
        console.log('[Blue] Game stopped or scenario cleared, clearing local scenario. Status:', gameState.status);
        setCurrentScenario(null);
      }
      setLoading(false);
    } else if (gameState) {
      // Game state exists but no scenario ID - we're done loading
      setLoading(false);
    }
    // Only depend on current_scenario_id and status, not currentScenario to avoid reload loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.current_scenario_id, gameState?.status, gameState?.round]);

  // Detect attack resolution and show notification for both success and failure
  useEffect(() => {
    const resolvedEvents = events.filter(
      (e) =>
        e.kind === 'attack_resolved' &&
        !e.payload.preliminary &&
        !processedBlockedEvents.current.has(e.id) &&
        (e.payload.result === 'blocked' ||
         e.payload.result === 'successful_block' ||
         e.payload.result === 'successful_mitigation' ||
         e.payload.result === 'unsuccessful_block' ||
         e.payload.result === 'unsuccessful_mitigation' ||
         e.payload.result === 'hit')
    );

    resolvedEvents.forEach((event) => {
      processedBlockedEvents.current.add(event.id);
      const result = event.payload.result;
      const attackType = event.payload.attack_type || 'Attack';
      const attackId = event.payload.attack_id || 'unknown';
      
      // Determine if action was successful
      const isSuccess = result === 'blocked' || 
                       result === 'successful_block' || 
                       result === 'successful_mitigation';
      
      // Show notification for both success and failure
      setBlockedNotification({
        show: true,
        attackType,
        attackId,
        success: isSuccess,
      });

      // Auto-hide after 6 seconds (longer for failure to ensure user sees it)
      setTimeout(() => {
        setBlockedNotification((prev) => ({ ...prev, show: false }));
      }, isSuccess ? 5000 : 7000);
    });
  }, [events]);

  // Don't render if not authenticated (AFTER all hooks are called)
  // Only check after we've had time to verify authentication
  if (codesOn() && hasCheckedAuth && !isAuthenticated) {
    return null;
  }

  // Show briefing overlay
  if (showBriefing && currentScenario?.blue_briefing) {
    return (
      <BlueBriefing
        briefing={currentScenario.blue_briefing}
        onDismiss={() => setShowBriefing(false)}
      />
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-xl mb-4">Loading...</div>
          <div className="text-sm text-slate-400">Connecting to game...</div>
        </div>
      </div>
    );
  }

  // Only show waiting screen if we've never seen the game running AND game is not currently running
  // This prevents flickering when gameState temporarily updates
  // Use a more stable check: only show waiting if we've never seen running AND gameState exists but is not running
  const shouldShowWaiting = !hasSeenRunning && gameState && gameState.status !== 'running';
  
  if (shouldShowWaiting) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <div className="text-center max-w-md">
          <h1 className="text-3xl font-bold mb-4 text-blue-400">Blue Team SOC</h1>
          <div className="text-xl mb-4">Waiting for game to start...</div>
          <div className="text-sm text-slate-400 mb-6">
            The Game Manager needs to select a scenario and start the game before you can join.
            {gameState && (
              <div className="mt-2 text-xs space-y-1">
                <div>Current status: {gameState.status || 'unknown'}</div>
                {gameState.current_scenario_id && (
                  <div>Scenario ID: {gameState.current_scenario_id}</div>
                )}
                {currentScenario && (
                  <div className="mt-2 pt-2 border-t border-slate-700">
                    <div className="text-blue-300 font-semibold">{currentScenario.name}</div>
                    {currentScenario.description && (
                      <div className="text-xs text-slate-500 mt-1">{currentScenario.description}</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex gap-3 justify-center">
            <button
              onClick={async () => {
                console.log('[Blue] Manually refreshing game state...');
                try {
                  const state = await gameApi.getState();
                  console.log('[Blue] Refreshed game state:', state);
                  setGameState(state);
                  // Load scenario if there's a scenario ID (regardless of game status)
                  if (state.current_scenario_id && (!currentScenario || currentScenario.id !== state.current_scenario_id)) {
                    await loadScenario(state.current_scenario_id);
                  }
                } catch (error) {
                  console.error('[Blue] Failed to refresh game state:', error);
                  alert('Failed to refresh game state. Please try again.');
                }
              }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg"
            >
              Refresh Status
            </button>
            <button
              onClick={() => navigate('/')}
              className="px-4 py-2 bg-slate-600 hover:bg-slate-700 rounded-lg"
            >
              Back to Lobby
            </button>
          </div>
        </div>
      </div>
    );
  }

  // If we've seen running but game is not currently running, show a message but keep the UI
  // Only show this if status actually changed (not just a temporary update) and game is ended (not paused)
  if (hasSeenRunning && gameState && gameState.status !== 'running' && gameState.status !== 'paused') {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-xl mb-4">Game has ended</div>
          <div className="text-sm text-slate-400 mb-4">Status: {gameState.status}</div>
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

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Game Banner */}
      <GameBanner />
      
      {/* Action Result Notification Toast */}
      {blockedNotification.show && (
        <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 transition-all duration-300 ease-in-out">
          <div className={`border-2 rounded-lg shadow-2xl p-6 max-w-md ${
            blockedNotification.success
              ? 'bg-green-600 border-green-400'
              : 'bg-red-600 border-red-400'
          }`}>
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0">
                {blockedNotification.success ? (
                  <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ) : (
                  <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              </div>
              <div className="flex-1">
                <h3 className={`text-2xl font-bold text-white mb-1 ${
                  blockedNotification.success ? '' : 'text-red-100'
                }`}>
                  {blockedNotification.success ? 'Attack Blocked!' : 'Action Failed'}
                </h3>
                <p className={`text-sm ${
                  blockedNotification.success ? 'text-green-100' : 'text-red-100'
                }`}>
                  {blockedNotification.success
                    ? `${blockedNotification.attackType} successfully blocked`
                    : `Your action did not stop the ${blockedNotification.attackType} attack`}
                </p>
                {blockedNotification.attackId && (
                  <p className={`text-xs mt-1 ${
                    blockedNotification.success ? 'text-green-200' : 'text-red-200'
                  }`}>
                    ID: {blockedNotification.attackId}
                  </p>
                )}
              </div>
              <button
                onClick={() => setBlockedNotification({ show: false })}
                className={`flex-shrink-0 text-white transition-colors ${
                  blockedNotification.success
                    ? 'hover:text-green-200'
                    : 'hover:text-red-200'
                }`}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
      
      <div className="container mx-auto px-4 sm:px-6 py-6 max-w-7xl">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 min-w-0 flex-1">
            <h1 className="text-2xl sm:text-3xl font-bold text-blue-400 truncate">Blue Team SOC</h1>
            {currentScenario && (
              <div className="sm:ml-4 sm:pl-4 sm:border-l border-slate-600 min-w-0 flex-1 sm:flex-initial">
                <div className="text-xs sm:text-sm text-slate-400">Active Scenario</div>
                <div className="text-base sm:text-lg font-semibold text-blue-300 truncate">{currentScenario.name}</div>
                {currentScenario.description && (
                  <div className="text-xs text-slate-500 mt-1 line-clamp-2 break-words">{currentScenario.description}</div>
                )}
              </div>
            )}
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
          {/* Main Map */}
          <div className="lg:col-span-3 space-y-6">
            <div className="bg-slate-800 rounded-2xl p-6">
              <h2 className="text-xl font-semibold mb-4">Network Map</h2>
              <div className="h-96">
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

            {/* Alert Feed */}
            <div className="h-96">
              <AlertFeed />
            </div>

            {/* Timeline */}
            <TimelineStrip />
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <PresenceIndicator role="blue" />
            {/* Score Panel */}
            <ScorePanel />
            <ActivityFeed role="blue" />
            <TeamChat role="blue" />

            {/* Defense Summary */}
            {(() => {
              // Calculate defense statistics from resolved attacks
              const resolvedAttacks = events.filter(
                (e) => e.kind === 'attack_resolved' && !e.payload.preliminary
              );
              
              const totalAttacks = resolvedAttacks.length;
              const blockedAttacks = resolvedAttacks.filter(
                (e) => {
                  const result = e.payload.result;
                  return result === 'blocked' || 
                         result === 'successful_block' || 
                         result === 'successful_mitigation';
                }
              ).length;
              
              const successRate = totalAttacks > 0 
                ? Math.round((blockedAttacks / totalAttacks) * 100) 
                : 0;
              
              // Calculate recent streak (last 5 attacks)
              const recentAttacks = resolvedAttacks.slice(-5).reverse();
              let streak = 0;
              for (const attack of recentAttacks) {
                const result = attack.payload.result;
                if (result === 'blocked' || 
                    result === 'successful_block' || 
                    result === 'successful_mitigation') {
                  streak++;
                } else {
                  break; // Streak broken
                }
              }
              
              // Get most recent result
              const mostRecent = resolvedAttacks.length > 0 
                ? resolvedAttacks[resolvedAttacks.length - 1] 
                : null;
              const lastResult = mostRecent?.payload.result;
              const isLastBlocked = lastResult === 'blocked' || 
                                   lastResult === 'successful_block' || 
                                   lastResult === 'successful_mitigation';
              
              return (
                <div className="bg-slate-800 rounded-2xl p-6">
                  <h2 className="text-xl font-semibold mb-4">Defense Summary</h2>
                  
                  {totalAttacks === 0 ? (
                    <div className="text-center py-6">
                      <div className="text-slate-400 text-sm mb-2">No attacks yet</div>
                      <div className="text-xs text-slate-500">Waiting for Red Team...</div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Success Rate */}
                      <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm text-slate-300">Success Rate</span>
                          <span className={`text-2xl font-bold ${
                            successRate >= 80 
                              ? 'text-green-400' 
                              : successRate >= 50 
                              ? 'text-yellow-400' 
                              : 'text-red-400'
                          }`}>
                            {successRate}%
                          </span>
                        </div>
                        <div className="w-full bg-slate-600 rounded-full h-2 mt-2">
                          <div
                            className={`h-2 rounded-full transition-all duration-500 ${
                              successRate >= 80 
                                ? 'bg-green-500' 
                                : successRate >= 50 
                                ? 'bg-yellow-500' 
                                : 'bg-red-500'
                            }`}
                            style={{ width: `${successRate}%` }}
                          />
                        </div>
                      </div>
                      
                      {/* Statistics Grid */}
                      <div className="grid grid-cols-2 gap-2 sm:gap-3">
                        <div className="bg-slate-700/50 rounded-lg p-2 sm:p-3 border border-slate-600 overflow-hidden">
                          <div className="text-xs text-slate-400 mb-1 truncate">Total Attacks</div>
                          <div className="text-xl sm:text-2xl font-bold text-blue-400 truncate">{totalAttacks}</div>
                        </div>
                        <div className="bg-slate-700/50 rounded-lg p-2 sm:p-3 border border-slate-600 overflow-hidden">
                          <div className="text-xs text-slate-400 mb-1 truncate">Blocked</div>
                          <div className="text-xl sm:text-2xl font-bold text-green-400 truncate">{blockedAttacks}</div>
                        </div>
                        <div className="bg-slate-700/50 rounded-lg p-2 sm:p-3 border border-slate-600 overflow-hidden">
                          <div className="text-xs text-slate-400 mb-1 truncate">Failed</div>
                          <div className="text-xl sm:text-2xl font-bold text-red-400 truncate">{totalAttacks - blockedAttacks}</div>
                        </div>
                        <div className="bg-slate-700/50 rounded-lg p-2 sm:p-3 border border-slate-600 overflow-hidden">
                          <div className="text-xs text-slate-400 mb-1 truncate">Current Streak</div>
                          <div className="text-xl sm:text-2xl font-bold text-green-400 truncate">{streak}</div>
                        </div>
                      </div>
                      
                      {/* Last Result Status */}
                      {mostRecent && (
                        <div className={`rounded-lg p-3 border-2 ${
                          isLastBlocked
                            ? 'bg-green-900/30 border-green-500/50'
                            : 'bg-red-900/30 border-red-500/50'
                        }`}>
                          <div className="flex items-center gap-2">
                            {isLastBlocked ? (
                              <>
                                <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <div>
                                  <div className="text-xs text-slate-400">Last Defense</div>
                                  <div className="text-sm font-semibold text-green-300">Successfully Blocked</div>
                                </div>
                              </>
                            ) : (
                              <>
                                <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <div>
                                  <div className="text-xs text-slate-400">Last Defense</div>
                                  <div className="text-sm font-semibold text-red-300">Not Blocked</div>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Action Palette */}
            <ActionPalette />

            {/* Attack Status */}
            <div className="bg-slate-800 rounded-2xl p-6">
              <h2 className="text-xl font-semibold mb-4">Attack Status</h2>
              <div className="space-y-3">
                {(() => {
                  // Group events by attack_id to match launched with resolved
                  const attackMap = new Map<string, { launched?: Event; resolved?: Event }>();
                  
                  // Debug logging removed to reduce console noise
                  // Uncomment if needed for debugging:
                  // const attackEvents = events.filter((e) => e.kind === 'attack_launched' || e.kind === 'attack_resolved');
                  // console.log('[Blue] Attack events in store:', attackEvents.length);
                  
                  const attackEvents = events.filter((e) => e.kind === 'attack_launched' || e.kind === 'attack_resolved');
                  attackEvents.forEach((event) => {
                    const attackId = event.payload?.attack_id || event.payload?.attackId || 'unknown';
                    if (!attackMap.has(attackId)) {
                      attackMap.set(attackId, {});
                    }
                    const entry = attackMap.get(attackId)!;
                    if (event.kind === 'attack_launched' || event.kind === 'ATTACK_LAUNCHED') {
                      entry.launched = event;
                    } else if ((event.kind === 'attack_resolved' || event.kind === 'ATTACK_RESOLVED') && !event.payload?.preliminary) {
                      entry.resolved = event;
                    }
                  });
                  
                  // Convert to array and sort by most recent
                  const attackEntries = Array.from(attackMap.entries())
                    .map(([attackId, entry]) => {
                      const launchedTs = entry.launched?.ts || entry.launched?.timestamp;
                      const resolvedTs = entry.resolved?.ts || entry.resolved?.timestamp;
                      const timestamp = resolvedTs || launchedTs || new Date().toISOString();
                      return {
                        attackId,
                        launched: entry.launched,
                        resolved: entry.resolved,
                        timestamp: typeof timestamp === 'string' ? new Date(timestamp) : timestamp,
                      };
                    })
                    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
                    .slice(0, 5);
                  
                  // Show "No attacks" message if there are no attack entries
                  if (attackEntries.length === 0) {
                    return (
                      <div className="text-slate-400 text-sm text-center py-4">
                        No attacks yet. Waiting for Red Team...
                      </div>
                    );
                  }
                  
                  return attackEntries.map((entry, index) => {
                    const event = entry.resolved || entry.launched;
                    if (!event) return null;
                    
                    const isResolved = !!entry.resolved;
                    const result = entry.resolved?.payload.result;
                    const attackId = entry.attackId;
                    const attackType = event.payload.attack_type || 'unknown';
                    // Check for new result types: successful_block, successful_mitigation, etc.
                    const isBlocked = isResolved && (result === 'blocked' || result === 'successful_block' || result === 'successful_mitigation');
                    const isMostRecent = index === 0;
                    const isMostRecentBlocked = isBlocked && isMostRecent;
                    
                    return (
                      <div
                        key={event.id}
                        className={`p-4 rounded-lg border-2 transition-all ${
                          isResolved
                            ? result === 'blocked'
                              ? isMostRecentBlocked
                                ? 'border-green-400 bg-green-900/40 shadow-lg shadow-green-500/50 ring-2 ring-green-400/50'
                                : 'border-green-500 bg-green-900/20'
                              : result === 'detected'
                              ? 'border-yellow-500 bg-yellow-900/20'
                              : 'border-red-500 bg-red-900/20'
                            : 'border-blue-500 bg-blue-900/20'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            {isBlocked && (
                              <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            )}
                            <span className={`font-semibold ${isMostRecentBlocked ? 'text-green-200 text-base' : 'text-sm'}`}>
                              {isResolved ? (isBlocked ? 'Attack Blocked!' : 'Attack Resolved') : 'Attack Launched'}
                            </span>
                          </div>
                          {isResolved && result && (
                            <span
                              className={`px-3 py-1 rounded text-xs font-bold ${
                                result === 'blocked' || result === 'successful_block'
                                  ? 'bg-green-600 text-white shadow-md'
                                  : result === 'successful_mitigation'
                                  ? 'bg-green-500 text-white'
                                  : result === 'unsuccessful_block' || result === 'unsuccessful_mitigation'
                                  ? 'bg-yellow-600 text-white'
                                  : result === 'detected'
                                  ? 'bg-yellow-600 text-white'
                                  : 'bg-red-600 text-white'
                              }`}
                            >
                              {result.replace(/_/g, ' ').toUpperCase()}
                            </span>
                          )}
                        </div>
                        {isMostRecentBlocked && (
                          <div className="mb-2 px-2 py-1 bg-green-800/50 rounded text-xs text-green-200 font-semibold">
                            Successfully defended!
                          </div>
                        )}
                        <div className={`text-xs ${isMostRecentBlocked ? 'text-green-300' : 'text-slate-400'}`}>
                          {attackType} • {attackId}
                        </div>
                        {isResolved && event.payload.blue_actions_count !== undefined && (
                          <div className="text-xs text-blue-300 mt-1">
                            <div className="font-semibold">Your actions: {event.payload.blue_actions_count}</div>
                            {event.payload.blue_actions && Array.isArray(event.payload.blue_actions) && event.payload.blue_actions.length > 0 && (
                              <div className="ml-2 mt-1 space-y-1">
                                {event.payload.blue_actions.map((action: any, idx: number) => (
                                  <div key={idx} className="text-xs">
                                    • {action.type?.replace(/_/g, ' ')} → {action.target}
                                    {action.note && (
                                      <span className="text-slate-400 italic"> - {action.note}</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {isResolved && event.payload.score_deltas && (
                          <div className="text-xs mt-1">
                            <span className="text-red-400">
                              Red: +{event.payload.score_deltas.red || 0}
                            </span>{' '}
                            <span className={`font-semibold ${isMostRecentBlocked ? 'text-green-300' : 'text-blue-400'}`}>
                              Blue: {event.payload.score_deltas.blue >= 0 ? '+' : ''}{event.payload.score_deltas.blue || 0}
                            </span>
                          </div>
                        )}
                        {isResolved && event.payload.attack_succeeded !== undefined && (
                          <div className="text-xs mt-2 pt-2 border-t border-slate-600">
                            <span className="font-semibold text-slate-300">Attack Status: </span>
                            <span className={event.payload.attack_succeeded ? 'text-red-400 font-semibold' : 'text-yellow-400'}>
                              {event.payload.attack_succeeded ? 'Succeeded' : 'Not Yet Succeeded'}
                            </span>
                          </div>
                        )}
                        {isResolved && event.payload.action_evaluations && Array.isArray(event.payload.action_evaluations) && event.payload.action_evaluations.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-slate-600 space-y-2">
                            <div className="text-xs font-semibold text-slate-300 mb-2">Action Evaluations:</div>
                            {event.payload.action_evaluations.map((evaluation: any, idx: number) => (
                              <div
                                key={evaluation.action_id || idx}
                                className={`p-2 rounded text-xs border ${
                                  evaluation.result === 'successful_block'
                                    ? 'bg-green-900/30 border-green-500'
                                    : evaluation.result === 'successful_mitigation'
                                    ? 'bg-green-800/20 border-green-600'
                                    : evaluation.result === 'unsuccessful_block'
                                    ? 'bg-yellow-900/30 border-yellow-500'
                                    : 'bg-red-900/30 border-red-500'
                                }`}
                              >
                                <div className="flex items-center justify-between mb-1">
                                  <span className="font-semibold text-slate-200">
                                    {evaluation.action_type.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}
                                  </span>
                                  <span className={`font-bold ${
                                    evaluation.points > 0 ? 'text-green-400' : 'text-red-400'
                                  }`}>
                                    {evaluation.points > 0 ? '+' : ''}{evaluation.points}
                                  </span>
                                </div>
                                <div className="text-slate-400 mb-1">
                                  Target: <span className="font-semibold text-slate-300">{evaluation.target}</span>
                                </div>
                                {evaluation.reason && (
                                  <div className={`mt-2 p-2 rounded text-xs ${
                                    evaluation.result === 'successful_block' || evaluation.result === 'successful_mitigation'
                                      ? 'bg-green-900/20 text-green-200 border border-green-700/50'
                                      : 'bg-slate-800/50 text-slate-300 border border-slate-700/50'
                                  }`}>
                                    <div className="font-semibold mb-1">Why this worked:</div>
                                    <div className="italic">{evaluation.reason}</div>
                                  </div>
                                )}
                                <div className="flex items-center gap-2 mt-1">
                                  <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                    evaluation.effectiveness === 'optimal'
                                      ? 'bg-green-600 text-white'
                                      : evaluation.effectiveness === 'effective'
                                      ? 'bg-green-500 text-white'
                                      : evaluation.effectiveness === 'partial'
                                      ? 'bg-yellow-600 text-white'
                                      : evaluation.effectiveness === 'ineffective'
                                      ? 'bg-red-600 text-white'
                                      : 'bg-red-700 text-white'
                                  }`}>
                                    {evaluation.effectiveness.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}
                                  </span>
                                  <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                    evaluation.result === 'successful_block'
                                      ? 'bg-green-700 text-white'
                                      : evaluation.result === 'successful_mitigation'
                                      ? 'bg-green-600 text-white'
                                      : evaluation.result === 'unsuccessful_block'
                                      ? 'bg-yellow-700 text-white'
                                      : 'bg-red-700 text-white'
                                  }`}>
                                    {evaluation.result.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}


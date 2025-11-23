import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../store/useGameStore';
import { scenariosApi, gameApi, sessionsApi } from '../api/client';
import { Scenario, SessionCreateResponse } from '../api/types';
import { useWebSocket } from '../hooks/useWebSocket';
import { authOn, codesOn } from '../lib/flags';
import ScorePanel from '../components/ScorePanel';
import GameBanner from '../components/GameBanner';

export default function GM() {
  const navigate = useNavigate();
  const { gameState, setGameState, setCurrentScenario, authToken, setAuthToken, sessionId, setSessionId, session, setSession, setRole } = useGameStore();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  // Check auth if feature is enabled (but allow page to load first)
  // Use a longer delay to allow Zustand store to hydrate from localStorage
  useEffect(() => {
    const timer = setTimeout(() => {
      if (authOn()) {
        // Check both store and localStorage for token (in case store hasn't hydrated yet)
        const storeToken = authToken;
        const stored = localStorage.getItem('pewpew-storage');
        let localStorageToken = null;
        try {
          if (stored) {
            const parsed = JSON.parse(stored);
            localStorageToken = parsed?.state?.authToken || null;
          }
        } catch (e) {
          // Ignore parse errors
        }
        
        const hasToken = storeToken || localStorageToken;
        
        if (!hasToken) {
          console.log('[GM] No auth token found, redirecting to login');
          navigate('/gm/login', { replace: true });
        } else {
          console.log('[GM] Auth token found, allowing access');
        }
      }
    }, 200); // Increased delay to allow store hydration
    return () => clearTimeout(timer);
  }, [authToken, navigate]);

  // Always call useWebSocket (hooks must be called unconditionally)
  // The hook will handle the case where no token is available
  useWebSocket('gm');

  const loadSession = async (sessionIdToLoad?: string) => {
    const idToLoad = sessionIdToLoad || sessionId;
    if (!codesOn() || !idToLoad) return;
    
    try {
      const sessionData = await sessionsApi.get(idToLoad);
      setSession(sessionData);
      // Ensure sessionId is set if it wasn't already
      if (!sessionId && idToLoad) {
        setSessionId(idToLoad);
      }
    } catch (error) {
      console.error('[GM] Failed to load session:', error);
      // Don't clear sessionId on error - it might be a temporary network issue
      // Only clear if we get a 404 or 403
      if (error && typeof error === 'object' && 'response' in error) {
        const httpError = error as any;
        if (httpError.response?.status === 404 || httpError.response?.status === 403) {
          console.log('[GM] Session not found or unauthorized, clearing session state');
          setSessionId(null);
          setSession(null);
        }
      }
    }
  };

  useEffect(() => {
    // Only load data if we're not redirecting to login
    const authEnabled = authOn();
    if (!authEnabled || authToken) {
      loadScenarios();
      loadGameState();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

  // Load active session on mount if join codes are enabled
  useEffect(() => {
    if (codesOn() && authToken && !sessionId) {
      // Try to load active session if we don't have one stored locally
      sessionsApi.getActive()
        .then((activeSession) => {
          console.log('[GM] Found active session:', activeSession.id);
          setSession(activeSession);
          setSessionId(activeSession.id);
          // Session will be reloaded by the useEffect that watches sessionId
        })
        .catch((error) => {
          // No active session found - that's okay, we'll create one when needed
          console.log('[GM] No active session found (this is normal if starting fresh)');
        });
    }
  }, [authToken, sessionId]); // Also watch sessionId to avoid race conditions

  // Reload session whenever sessionId changes or component mounts (for persistence when navigating back)
  useEffect(() => {
    if (codesOn() && sessionId && authToken) {
      loadSession();
    }
  }, [sessionId, authToken]); // Include loadSession in dependencies would cause issues, but we check sessionId/authToken

  const loadScenarios = async () => {
    try {
      console.log('[GM] Loading scenarios...');
      const data = await scenariosApi.list();
      console.log('[GM] Scenarios loaded:', data?.length || 0, 'scenarios');
      if (data && data.length > 0) {
        setScenarios(data);
      } else {
        console.warn('[GM] No scenarios returned from API');
      }
    } catch (error: any) {
      console.error('[GM] Failed to load scenarios:', error);
      console.error('[GM] Error details:', {
        message: error?.message,
        response: error?.response?.data,
        status: error?.response?.status,
        url: error?.config?.url,
        baseURL: error?.config?.baseURL,
      });
      // Set empty array on error so UI doesn't hang
      setScenarios([]);
    } finally {
      setLoading(false);
    }
  };

  const loadGameState = async () => {
    try {
      const state = await gameApi.getState();
      setGameState(state);
    } catch (error) {
      console.error('Failed to load game state:', error);
    }
  };

  const handleStart = async (scenarioId: string) => {
    // Prevent multiple simultaneous start attempts
    if (isStarting) {
      console.log('[GM] Start already in progress, ignoring duplicate request');
      return;
    }
    
    setIsStarting(true);
    try {
      console.log('[GM] Starting game with scenario:', scenarioId);
      
      // Check if game is currently running or paused - if so, stop it first
      if (gameState && (gameState.status === 'running' || gameState.status === 'paused')) {
        console.log('[GM] Game is currently', gameState.status, '- stopping it first before starting new game');
        try {
          await gameApi.stop();
          // Wait a moment for the stop to complete and propagate
          await new Promise(resolve => setTimeout(resolve, 500));
          // Reload game state to ensure we have the latest status
          await loadGameState();
        } catch (stopError) {
          console.error('[GM] Failed to stop game before starting new one:', stopError);
          // Continue anyway - backend will handle stopping if needed
        }
      }
      
      // Get current sessionId from store (might have been set by useEffect)
      let currentSessionId = sessionId;
      
      // Create or get session if join codes are enabled
      if (codesOn() && !currentSessionId) {
        console.log('[GM] Creating or getting session for join codes');
        try {
          // Try to get active session first
          try {
            const activeSession = await sessionsApi.getActive();
            console.log('[GM] Found active session:', activeSession.id);
            setSession(activeSession);
            setSessionId(activeSession.id);
            currentSessionId = activeSession.id;
            await loadSession(activeSession.id);
          } catch (activeError: any) {
            // No active session found, create a new one
            if (activeError.response?.status === 404) {
              console.log('[GM] No active session found, creating new one');
              const newSession = await sessionsApi.create();
              setSession(newSession);
              setSessionId(newSession.id);
              currentSessionId = newSession.id;
              // Reload session to get full session data (pass the ID explicitly)
              await loadSession(newSession.id);
            } else {
              throw activeError;
            }
          }
        } catch (error: any) {
          console.error('[GM] Failed to create/get session:', error);
          // Continue anyway - session creation is not critical for game start
          // But log the error for debugging
          const errorMessage = error.response?.data?.detail || error.message || 'Unknown error';
          console.error('[GM] Session error details:', errorMessage);
        }
      }
      
      const state = await gameApi.start(scenarioId);
      console.log('[GM] Game started, received state:', state);
      console.log('[GM] Game status:', state.status);
      
      if (!state || state.status !== 'running') {
        console.error('[GM] Game state invalid or not running:', state);
        alert(`Game failed to start. Status: ${state?.status || 'unknown'}`);
        return;
      }
      
      setGameState(state);
      
      // Load scenario
      const scenario = await scenariosApi.get(scenarioId);
      setCurrentScenario(scenario);
      
      // Also update score in store
      // Note: Don't clear events here - let them accumulate so timeline shows full game history
      // Events will be cleared when game is reset, not when starting a new round
      const { setScore } = useGameStore.getState();
      setScore({ red: 0, blue: 0, mttd: undefined, mttc: undefined, round_breakdown: [] });
      
      // Wait a moment for the new game state to propagate
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Reload game state and session to ensure consistency
      await loadGameState();
      // Reload session if we have one (use currentSessionId which might have been just set)
      if (codesOn() && (currentSessionId || sessionId)) {
        // Use the most up-to-date sessionId from store
        const latestSessionId = useGameStore.getState().sessionId;
        if (latestSessionId) {
          await loadSession();
        }
      }
      
      console.log('[GM] Game started successfully');
    } catch (error: any) {
      console.error('[GM] Failed to start game:', error);
      console.error('[GM] Error details:', error?.response?.data || error?.message);
      const errorMessage = error?.response?.data?.detail || error?.message || 'Unknown error';
      alert(`Failed to start game: ${errorMessage}`);
    } finally {
      setIsStarting(false);
    }
  };

  const handlePause = async () => {
    try {
      const state = await gameApi.pause();
      setGameState(state);
    } catch (error) {
      console.error('Failed to pause game:', error);
    }
  };

  const handleResume = async () => {
    try {
      const state = await gameApi.resume();
      setGameState(state);
    } catch (error) {
      console.error('Failed to resume game:', error);
    }
  };

  const handleStop = async () => {
    if (isStopping) return;
    
    if (!confirm('Stop the current game? Players will no longer be able to make moves, but scores and history will be preserved.')) {
      return;
    }

    setIsStopping(true);
    try {
      const state = await gameApi.stop();
      setGameState(state);
      // Clear scenario when game is stopped to prepare for next game
      setCurrentScenario(null);
      const { setCurrentScenario: setStoreScenario } = useGameStore.getState();
      setStoreScenario(null);
      console.log('[GM] Game stopped successfully');
    } catch (error: any) {
      const errorMessage = error.response?.data?.detail || error.message || 'Failed to stop game';
      console.error('Failed to stop game:', error);
      alert(`Failed to stop game: ${errorMessage}`);
    } finally {
      setIsStopping(false);
    }
  };

  const handleReset = async () => {
    if (isResetting) return;
    
    if (!confirm('Reset the game to lobby? This will clear all scores, attacks, actions, and game history. This action cannot be undone.')) {
      return;
    }
    
    setIsResetting(true);
    try {
      // Reset will also stop the game session if it's running
      const state = await gameApi.reset();
      setGameState(state);
      setCurrentScenario(null);
      
      // Also reset score in store and clear all events/alerts/actions
      const { setScore, clearEvents, setCurrentScenario: setStoreScenario } = useGameStore.getState();
      setScore({ red: 0, blue: 0, mttd: undefined, mttc: undefined, round_breakdown: [] });
      clearEvents();
      setStoreScenario(null); // Clear scenario from store too
      
      // Reload game state to ensure consistency
      await loadGameState();
      
      console.log('[GM] Game reset and stopped successfully');
    } catch (error: any) {
      console.error('Failed to reset game:', error);
      const errorMessage = error?.response?.data?.detail || error?.message || 'Unknown error';
      alert(`Failed to reset game: ${errorMessage}`);
    } finally {
      setIsResetting(false);
    }
  };

  const handleRotateCodes = async () => {
    if (!codesOn() || !session) return;
    
    setSessionLoading(true);
    try {
      const updated = await sessionsApi.rotateCodes(session.id);
      setSession(updated);
    } catch (error: any) {
      console.error('Failed to rotate codes:', error);
      alert(error.response?.data?.detail || 'Failed to rotate codes');
    } finally {
      setSessionLoading(false);
    }
  };

  const handleLogout = () => {
    setAuthToken(null);
    setSessionId(null);
    setSession(null);
    setRole(null as any);
    navigate('/', { replace: true });
  };

  const handleBackToLobby = () => {
    // Clear role so user can see the lobby (but keep auth token for now)
    // If they want to fully logout, they can use the Logout button
    setRole(null);
    navigate('/', { replace: true });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    // Could show a toast notification here
  };

  // Show loading or redirect to login
  const authEnabled = authOn();
  if (authEnabled && !authToken) {
    // Will redirect in useEffect, but show loading while redirecting
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <div>Redirecting to login...</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <div>Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Game Banner */}
      <GameBanner />
      
      <div className="container mx-auto px-4 sm:px-6 py-6 max-w-7xl">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div className="flex items-center gap-4 min-w-0 flex-1">
            <h1 className="text-2xl sm:text-3xl font-bold truncate">Game Manager Console</h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
            {authOn() && (
              <button
                onClick={handleLogout}
                className="px-3 sm:px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm sm:text-base whitespace-nowrap"
              >
                Logout
              </button>
            )}
            <button
              onClick={handleBackToLobby}
              className="px-3 sm:px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm sm:text-base whitespace-nowrap"
            >
              Back to Lobby
            </button>
          </div>
        </div>


        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Scenario Picker */}
            <div className="bg-slate-800 rounded-2xl p-6">
              <h2 className="text-xl font-semibold mb-4">Scenarios</h2>
              <div className="space-y-3">
                {scenarios.map((scenario) => {
                  const isActive = gameState?.status === 'running' && gameState?.current_scenario_id === scenario.id;
                  const isRunning = gameState?.status === 'running';
                  
                  return (
                    <div
                      key={scenario.id}
                      className={`p-4 rounded-lg ${
                        isActive 
                          ? 'bg-gradient-to-r from-blue-900/50 to-purple-900/50 border-2 border-blue-500/50' 
                          : 'bg-slate-700'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <div className="font-semibold truncate">{scenario.name}</div>
                            {isActive && (
                              <span className="px-2 py-1 bg-green-600 rounded-full text-xs font-semibold flex items-center gap-1 flex-shrink-0">
                                <span className="w-1.5 h-1.5 bg-green-300 rounded-full animate-pulse"></span>
                                Active
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-slate-400 line-clamp-2 break-words">{scenario.description}</div>
                        </div>
                        <button
                          onClick={() => handleStart(scenario.id)}
                          disabled={(isRunning && !isActive) || isStarting || isStopping || isResetting}
                          className={`px-3 sm:px-4 py-2 rounded-lg font-semibold text-sm sm:text-base whitespace-nowrap flex-shrink-0 ${
                            isRunning && !isActive
                              ? 'bg-slate-600 cursor-not-allowed opacity-50'
                              : isActive
                              ? 'bg-orange-600 hover:bg-orange-700'
                              : 'bg-blue-600 hover:bg-blue-700'
                          }`}
                        >
                          {isActive ? 'Running' : isRunning ? 'Game Running' : 'Run'}
                        </button>
                      </div>
                      
                      {/* Show join codes when this scenario is active and running */}
                      {isActive && codesOn() && session && (
                        <div className="mt-4 pt-4 border-t border-slate-600">
                          <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-semibold text-slate-300">Join Codes</h3>
                            <button
                              onClick={handleRotateCodes}
                              disabled={sessionLoading}
                              className="px-2 py-1 bg-yellow-600 hover:bg-yellow-700 disabled:bg-slate-600 disabled:cursor-not-allowed rounded text-xs"
                            >
                              {sessionLoading ? 'Rotating...' : 'Rotate'}
                            </button>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <div className="p-2 bg-slate-800/50 rounded border border-slate-700 overflow-hidden">
                              <div className="text-xs text-slate-400 mb-1">Red Team</div>
                              <div className="flex items-center gap-1 min-w-0">
                                <span className="font-mono text-sm font-bold truncate flex-1">{session.red_code}</span>
                                <button
                                  onClick={() => {
                                    copyToClipboard(session.red_code);
                                    alert('Red team code copied!');
                                  }}
                                  className="px-1.5 py-0.5 bg-red-600 hover:bg-red-700 rounded text-xs flex-shrink-0"
                                  title="Copy code"
                                >
                                  Copy
                                </button>
                              </div>
                            </div>
                            <div className="p-2 bg-slate-800/50 rounded border border-slate-700 overflow-hidden">
                              <div className="text-xs text-slate-400 mb-1">Blue Team</div>
                              <div className="flex items-center gap-1 min-w-0">
                                <span className="font-mono text-sm font-bold truncate flex-1">{session.blue_code}</span>
                                <button
                                  onClick={() => {
                                    copyToClipboard(session.blue_code);
                                    alert('Blue team code copied!');
                                  }}
                                  className="px-1.5 py-0.5 bg-blue-600 hover:bg-blue-700 rounded text-xs flex-shrink-0"
                                  title="Copy code"
                                >
                                  Copy
                                </button>
                              </div>
                            </div>
                            <div className="p-2 bg-slate-800/50 rounded border border-slate-700 overflow-hidden">
                              <div className="text-xs text-slate-400 mb-1">Audience</div>
                              <div className="flex items-center gap-1 min-w-0">
                                <span className="font-mono text-sm font-bold truncate flex-1">{session.audience_code}</span>
                                <button
                                  onClick={() => {
                                    copyToClipboard(session.audience_code);
                                    alert('Audience code copied!');
                                  }}
                                  className="px-1.5 py-0.5 bg-green-600 hover:bg-green-700 rounded text-xs flex-shrink-0"
                                  title="Copy code"
                                >
                                  Copy
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Game Controls */}
            <div className="bg-slate-800 rounded-2xl p-6">
              <h2 className="text-xl font-semibold mb-4">Game Controls</h2>
              
              {/* Playback Controls */}
              <div className="mb-4">
                <div className="text-sm text-slate-400 mb-2">Playback</div>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={handlePause}
                    disabled={gameState?.status !== 'running'}
                    className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-lg font-medium transition-colors"
                  >
                    Pause
                  </button>
                  <button
                    onClick={handleResume}
                    disabled={gameState?.status !== 'paused'}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-lg font-medium transition-colors"
                  >
                    Resume
                  </button>
                </div>
              </div>

              {/* Game Management */}
              <div className="border-t border-slate-700 pt-4">
                <div className="text-sm text-slate-400 mb-2">Game Management</div>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={handleStop}
                    disabled={(gameState?.status !== 'running' && gameState?.status !== 'paused') || isStopping}
                    className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-lg font-medium transition-colors"
                  >
                    {isStopping ? 'Stopping...' : 'Stop Game'}
                  </button>
                  <button
                    onClick={handleReset}
                    disabled={isResetting}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-700 disabled:opacity-50 rounded-lg font-medium transition-colors"
                  >
                    {isResetting ? 'Resetting...' : 'Reset to Lobby'}
                  </button>
                </div>
                <div className="mt-2 text-xs text-slate-500 space-y-1 break-words">
                  <div>• <strong>Stop:</strong> Ends the game but preserves scores and history</div>
                  <div>• <strong>Reset:</strong> Clears everything and returns to lobby</div>
                </div>
              </div>
            </div>

          </div>

          {/* Score Panel */}
          <div>
            <ScorePanel />
          </div>
        </div>
      </div>
    </div>
  );
}


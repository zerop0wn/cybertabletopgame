import { useGameStore } from '../store/useGameStore';
import { useEffect, useState, useRef, memo, useCallback, useMemo } from 'react';
import { gameApi } from '../api/client';
import { shallow } from 'zustand/shallow';

const SCENARIO_DURATION_LIMIT = 1800; // 30 minutes in seconds
const TURN_TIME_LIMIT = 300; // 5 minutes in seconds

function GameBanner() {
  // Subscribe only to the specific fields we need for visibility
  // Use shallow comparison to prevent re-renders when other gameState fields change
  // Also subscribe to turn_start_time to detect turn changes
  const { gameStatus, redBriefingDismissed, currentTurn, turnTimeLimit, turnStartTime, role, setGameState } = useGameStore(
    (state) => ({
      gameStatus: state.gameState?.status,
      redBriefingDismissed: state.gameState?.red_briefing_dismissed,
      currentTurn: state.gameState?.current_turn,
      turnTimeLimit: state.gameState?.turn_time_limit,
      turnStartTime: state.gameState?.turn_start_time,
      role: state.role,
      setGameState: state.setGameState,
    }),
    shallow
  );
  
  // Use ref to access full gameState without causing re-renders
  const gameStateRef = useRef(useGameStore.getState().gameState);
  
  // Update ref when gameState changes (but don't trigger re-render)
  useEffect(() => {
    const unsubscribe = useGameStore.subscribe(
      (state) => state.gameState,
      (gameState) => {
        gameStateRef.current = gameState;
      }
    );
    return unsubscribe;
  }, []);
  
  const [isStopping, setIsStopping] = useState(false);
  const [gameTimeRemaining, setGameTimeRemaining] = useState(SCENARIO_DURATION_LIMIT);
  const [turnTimeRemaining, setTurnTimeRemaining] = useState(TURN_TIME_LIMIT);
  
  // Calculate effective turn time limit (must be defined before use in useEffect)
  const effectiveTurnTimeLimit = turnTimeLimit || TURN_TIME_LIMIT;

  // Use refs to store latest subscribed values for use in interval
  const turnStartTimeRef = useRef(turnStartTime);
  const currentTurnRef = useRef(currentTurn);
  const turnTimeLimitRef = useRef(turnTimeLimit);
  const gameStatusRef = useRef(gameStatus);
  
  // Update refs when subscribed values change
  useEffect(() => {
    turnStartTimeRef.current = turnStartTime;
    currentTurnRef.current = currentTurn;
    turnTimeLimitRef.current = turnTimeLimit;
    gameStatusRef.current = gameStatus;
  }, [turnStartTime, currentTurn, turnTimeLimit, gameStatus]);

  // Calculate game time remaining
  useEffect(() => {
    const calculateGameTime = () => {
      const currentGameState = gameStateRef.current;
      
      if (!currentGameState || currentGameState.status !== 'running') {
        return SCENARIO_DURATION_LIMIT;
      }

      // Always calculate from start_time in real-time for smooth countdown
      // Backend timer is only updated every 5 seconds, so we need to calculate locally
      if (currentGameState.start_time) {
        try {
          const now = new Date().getTime();
          let start: number;
          const startTimeStr = currentGameState.start_time;
          
          if (typeof startTimeStr === 'string' && !startTimeStr.endsWith('Z') && !startTimeStr.includes('+') && !startTimeStr.includes('-', 10)) {
            start = new Date(startTimeStr + 'Z').getTime();
            if (isNaN(start)) {
              start = new Date(startTimeStr).getTime();
            }
          } else {
            start = new Date(startTimeStr).getTime();
          }
          
          if (isNaN(start) || start > now) {
            // If start_time is invalid, fall back to backend timer if available
            if (currentGameState.timer !== undefined && currentGameState.timer !== null) {
              const elapsed = Math.max(0, Math.min(currentGameState.timer, SCENARIO_DURATION_LIMIT));
              return Math.max(0, SCENARIO_DURATION_LIMIT - elapsed);
            }
            return SCENARIO_DURATION_LIMIT;
          }
          
          const elapsed = Math.floor((now - start) / 1000);
          return Math.max(0, SCENARIO_DURATION_LIMIT - elapsed);
        } catch (e) {
          // Fallback to backend timer if calculation fails
          if (currentGameState.timer !== undefined && currentGameState.timer !== null) {
            const elapsed = Math.max(0, Math.min(currentGameState.timer, SCENARIO_DURATION_LIMIT));
            return Math.max(0, SCENARIO_DURATION_LIMIT - elapsed);
          }
          return SCENARIO_DURATION_LIMIT;
        }
      }
      
      // Fallback to backend timer if start_time is not available
      if (currentGameState.timer !== undefined && currentGameState.timer !== null) {
        const elapsed = Math.max(0, Math.min(currentGameState.timer, SCENARIO_DURATION_LIMIT));
        return Math.max(0, SCENARIO_DURATION_LIMIT - elapsed);
      }
      
      return SCENARIO_DURATION_LIMIT;
    };

    const calculateTurnTime = () => {
      // Use refs to get latest subscribed values (updated by useEffect above)
      // This ensures we use the most up-to-date value when turn changes
      const currentGameState = gameStateRef.current;
      
      // Use refs for subscribed values (they're updated by the useEffect above)
      const effectiveTurnStartTime = turnStartTimeRef.current || currentGameState?.turn_start_time;
      const effectiveCurrentTurn = currentTurnRef.current || currentGameState?.current_turn;
      const effectiveTurnTimeLimit = turnTimeLimitRef.current || currentGameState?.turn_time_limit || TURN_TIME_LIMIT;
      const effectiveGameStatus = gameStatusRef.current;
      
      if (!currentGameState || effectiveGameStatus !== 'running' || !effectiveCurrentTurn || !effectiveTurnStartTime) {
        return effectiveTurnTimeLimit;
      }

      try {
        const now = new Date().getTime();
        let start: number;
        const startTimeStr = effectiveTurnStartTime;
        
        if (typeof startTimeStr === 'string' && !startTimeStr.endsWith('Z') && !startTimeStr.includes('+') && !startTimeStr.includes('-', 10)) {
          start = new Date(startTimeStr + 'Z').getTime();
          if (isNaN(start)) {
            start = new Date(startTimeStr).getTime();
          }
        } else {
          start = new Date(startTimeStr).getTime();
        }
        
        if (isNaN(start)) {
          return effectiveTurnTimeLimit;
        }
        
        if (start > now) {
          // Start time is in the future - return full limit
          return effectiveTurnTimeLimit;
        }
        
        const elapsed = Math.floor((now - start) / 1000);
        return Math.max(0, effectiveTurnTimeLimit - elapsed);
      } catch (e) {
        return effectiveTurnTimeLimit;
      }
    };

    const updateTimes = () => {
      const gameRemaining = calculateGameTime();
      const turnRemaining = calculateTurnTime();
      // Only update state if values actually changed (prevent unnecessary re-renders)
      setGameTimeRemaining(prev => {
        // Round to nearest second to prevent micro-updates
        const roundedPrev = Math.floor(prev);
        const roundedNew = Math.floor(gameRemaining);
        return roundedPrev !== roundedNew ? gameRemaining : prev;
      });
      setTurnTimeRemaining(prev => {
        // Round to nearest second to prevent micro-updates
        const roundedPrev = Math.floor(prev);
        const roundedNew = Math.floor(turnRemaining);
        return roundedPrev !== roundedNew ? turnRemaining : prev;
      });
    };

    // Initial update
    updateTimes();

    // Update every second
    const interval = setInterval(updateTimes, 1000);

    return () => clearInterval(interval);
  }, []); // Empty deps - interval runs continuously, reads from refs

  // Track previous values to prevent unnecessary updates
  const prevStartTimeRef = useRef<string | null>(null);
  const prevTurnStartTimeRef = useRef<string | null>(null);
  const prevCurrentTurnRef = useRef<string | null>(null);
  
  // Force update when gameState changes (for initial sync and when start_time/turn_start_time changes)
  // But NOT when only timer values change (to prevent flickering)
  // Use subscribed turnStartTime value directly to detect changes immediately
  useEffect(() => {
    const gameState = gameStateRef.current;
    if (gameStatus === 'running' && gameState) {
      // Only update if start_time or turn_start_time actually changed
      const startTimeChanged = gameState?.start_time !== prevStartTimeRef.current;
      // Use subscribed turnStartTime to detect changes immediately (not from ref which updates async)
      const turnStartTimeChanged = turnStartTime !== prevTurnStartTimeRef.current;
      const turnChanged = currentTurn !== prevCurrentTurnRef.current;
      
      // Game time - only update if start_time changed
      if (startTimeChanged && gameState?.start_time) {
        prevStartTimeRef.current = gameState.start_time;
        try {
          const now = new Date().getTime();
          let start: number;
          const startTimeStr = gameState.start_time;
          
          if (typeof startTimeStr === 'string' && !startTimeStr.endsWith('Z') && !startTimeStr.includes('+') && !startTimeStr.includes('-', 10)) {
            start = new Date(startTimeStr + 'Z').getTime();
            if (isNaN(start)) {
              start = new Date(startTimeStr).getTime();
            }
          } else {
            start = new Date(startTimeStr).getTime();
          }
          
          if (!isNaN(start) && start <= now) {
            const elapsed = Math.floor((now - start) / 1000);
            setGameTimeRemaining(Math.max(0, SCENARIO_DURATION_LIMIT - elapsed));
          } else if (gameState.timer !== undefined && gameState.timer !== null) {
            // Fallback to backend timer if start_time is invalid
            const elapsed = Math.max(0, Math.min(gameState.timer, SCENARIO_DURATION_LIMIT));
            setGameTimeRemaining(Math.max(0, SCENARIO_DURATION_LIMIT - elapsed));
          }
        } catch (e) {
          // Fallback to backend timer on error
          if (gameState.timer !== undefined && gameState.timer !== null) {
            const elapsed = Math.max(0, Math.min(gameState.timer, SCENARIO_DURATION_LIMIT));
            setGameTimeRemaining(Math.max(0, SCENARIO_DURATION_LIMIT - elapsed));
          }
        }
      } else if (!gameState?.start_time && gameState.timer !== undefined && gameState.timer !== null) {
        // Fallback to backend timer if start_time is not available (only on initial load)
        if (prevStartTimeRef.current === null) {
          const elapsed = Math.max(0, Math.min(gameState.timer, SCENARIO_DURATION_LIMIT));
          setGameTimeRemaining(Math.max(0, SCENARIO_DURATION_LIMIT - elapsed));
        }
      }

      // Turn time - only update if turn_start_time or current_turn changed
      // When turn changes, immediately reset to full time limit, then calculate from new start time
      // Use subscribed turnStartTime value directly (not from gameState ref) to detect changes immediately
      if ((turnStartTimeChanged || turnChanged) && currentTurn && turnStartTime) {
        prevTurnStartTimeRef.current = turnStartTime;
        prevCurrentTurnRef.current = currentTurn;
        const effectiveLimit = turnTimeLimit || TURN_TIME_LIMIT;
        
        try {
          const now = new Date().getTime();
          let start: number;
          const startTimeStr = turnStartTime;
          
          if (typeof startTimeStr === 'string' && !startTimeStr.endsWith('Z') && !startTimeStr.includes('+') && !startTimeStr.includes('-', 10)) {
            start = new Date(startTimeStr + 'Z').getTime();
            if (isNaN(start)) {
              start = new Date(startTimeStr).getTime();
            }
          } else {
            start = new Date(startTimeStr).getTime();
          }
          
          if (!isNaN(start)) {
            if (start <= now) {
              // Calculate elapsed time from the new turn start time
              const elapsed = Math.floor((now - start) / 1000);
              setTurnTimeRemaining(Math.max(0, effectiveLimit - elapsed));
            } else {
              // Start time is in the future (timezone issue) - set to full limit
              setTurnTimeRemaining(effectiveLimit);
            }
          } else {
            // Invalid start time - set to full limit
            setTurnTimeRemaining(effectiveLimit);
          }
        } catch (e) {
          // On error, reset to full time limit
          setTurnTimeRemaining(effectiveLimit);
        }
      } else if (turnChanged && currentTurn && !turnStartTime) {
        // Turn changed but no turn_start_time yet - reset to full limit
        const effectiveLimit = turnTimeLimit || TURN_TIME_LIMIT;
        setTurnTimeRemaining(effectiveLimit);
        prevCurrentTurnRef.current = currentTurn;
      }
    } else {
      // Reset refs when game is not running
      prevStartTimeRef.current = null;
      prevTurnStartTimeRef.current = null;
      prevCurrentTurnRef.current = null;
      setGameTimeRemaining(SCENARIO_DURATION_LIMIT);
      setTurnTimeRemaining(effectiveTurnTimeLimit);
    }
  }, [gameStatus, effectiveTurnTimeLimit, currentTurn, turnStartTime]); // Add turnStartTime to detect turn changes

  // Calculate visibility based on subscribed values
  // Use useMemo to prevent recalculation on every render
  // Use ref to track previous visibility to prevent flickering
  const prevShouldShowRef = useRef<boolean>(false);
  const shouldShow = useMemo(() => {
    if (!gameStatus || gameStatus !== 'running') {
      return false;
    }
    // Only hide for Red team when briefing hasn't been dismissed
    if (role === 'red' && !redBriefingDismissed) {
      return false;
    }
    return true;
  }, [gameStatus, role, redBriefingDismissed]);
  
  // Update ref when visibility changes
  useEffect(() => {
    prevShouldShowRef.current = shouldShow;
  }, [shouldShow]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Memoize computed values to prevent recalculation on every render
  const isRunning = useMemo(() => gameStatus === 'running', [gameStatus]);
  const isRedTurn = useMemo(() => currentTurn === 'red', [currentTurn]);
  const isBlueTurn = useMemo(() => currentTurn === 'blue', [currentTurn]);

  const gameTimeStr = useMemo(() => formatTime(gameTimeRemaining), [gameTimeRemaining]);
  const turnTimeStr = useMemo(() => formatTime(turnTimeRemaining), [turnTimeRemaining]);
  
  const gameTimeWarning = useMemo(() => gameTimeRemaining < 300, [gameTimeRemaining]); // Less than 5 minutes
  const gameTimeCritical = useMemo(() => gameTimeRemaining < 60, [gameTimeRemaining]); // Less than 1 minute
  const gameTimeExpired = useMemo(() => gameTimeRemaining === 0, [gameTimeRemaining]);
  
  const turnTimeWarning = useMemo(() => turnTimeRemaining < 30, [turnTimeRemaining]); // Less than 30 seconds
  const turnTimeCritical = useMemo(() => turnTimeRemaining < 10, [turnTimeRemaining]); // Less than 10 seconds
  const turnTimeExpired = useMemo(() => turnTimeRemaining === 0, [turnTimeRemaining]);

  const isGameManager = useMemo(() => role === 'gm', [role]);

  const handleStop = async () => {
    if (!confirm('Are you sure you want to stop the current game session? The game will be ended and players will no longer be able to make moves.')) {
      return;
    }

    setIsStopping(true);
    try {
      const state = await gameApi.stop();
      setGameState(state);
      console.log('[GameBanner] Game stopped successfully');
    } catch (error: any) {
      const errorMessage = error.response?.data?.detail || error.message || 'Failed to stop game';
      console.error('[GameBanner] Failed to stop game:', error);
      alert(`Failed to stop game: ${errorMessage}`);
    } finally {
      setIsStopping(false);
    }
  };

  // Always render but use CSS class to control visibility
  // This prevents layout shifts while keeping the component mounted
  // Use CSS visibility instead of conditional return to prevent unmount/remount flickering
  return (
    <div className={`w-full bg-gradient-to-r from-slate-800 via-slate-800/95 to-slate-800 border-b-2 border-slate-700/50 shadow-lg ${!shouldShow ? 'hidden' : ''}`}>
      <div className="container mx-auto px-4 sm:px-6 py-3 max-w-7xl">
        <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-6">
                {/* Turn Indicator */}
                <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-shrink-0">
                  <div className={`w-3 h-3 rounded-full flex-shrink-0 ${
                    isRedTurn ? 'bg-red-500' : isBlueTurn ? 'bg-blue-500' : 'bg-slate-500'
                  } ${turnTimeCritical ? 'animate-pulse' : ''}`} />
                  <div className="flex flex-col min-w-0">
                    <div className="text-xs text-slate-400 uppercase tracking-wider text-[10px]">Current Turn</div>
                    <div className={`text-base sm:text-lg font-bold truncate ${
                      isRedTurn ? 'text-red-400' : isBlueTurn ? 'text-blue-400' : 'text-slate-400'
                    }`}>
                      {isRedTurn ? 'RED TEAM' : isBlueTurn ? 'BLUE TEAM' : 'WAITING'}
                    </div>
                  </div>
                </div>

                {/* Turn Time */}
                <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-shrink-0">
                  <div className="flex flex-col items-end min-w-0">
                    <div className="text-xs text-slate-400 uppercase tracking-wider text-[10px]">Turn Time</div>
                    <div className={`text-xl sm:text-2xl font-mono font-bold ${
                      turnTimeExpired ? 'text-red-500' :
                      turnTimeCritical ? 'text-red-400 animate-pulse' :
                      turnTimeWarning ? 'text-yellow-400' :
                      isRedTurn ? 'text-red-300' : 'text-blue-300'
                    }`}>
                      {turnTimeStr}
                    </div>
                  </div>
                  {/* Turn time progress bar */}
                  <div className="w-12 sm:w-16 bg-slate-700/50 rounded-full h-2 flex-shrink-0">
                    <div
                      className={`h-2 rounded-full transition-all duration-1000 ${
                        turnTimeExpired ? 'bg-red-500' :
                        turnTimeCritical ? 'bg-red-400' :
                        turnTimeWarning ? 'bg-yellow-400' :
                        isRedTurn ? 'bg-red-500/50' : 'bg-blue-500/50'
                      }`}
                      style={{
                        width: `${Math.max(0, Math.min(100, (turnTimeRemaining / effectiveTurnTimeLimit) * 100))}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Divider */}
                <div className="hidden sm:block flex-1 border-l border-slate-700/50 min-w-[1px]" />

                {/* Game Time */}
                <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-shrink-0">
                  <div className="flex flex-col items-end min-w-0">
                    <div className="text-xs text-slate-400 uppercase tracking-wider text-[10px]">Game Time</div>
                    <div className={`text-xl sm:text-2xl font-mono font-bold ${
                      gameTimeExpired ? 'text-red-500' :
                      gameTimeCritical ? 'text-red-400 animate-pulse' :
                      gameTimeWarning ? 'text-yellow-400' :
                      'text-green-400'
                    }`}>
                      {gameTimeStr}
                    </div>
                  </div>
                  {/* Game time progress bar */}
                  <div className="w-12 sm:w-16 bg-slate-700/50 rounded-full h-2 flex-shrink-0">
                    <div
                      className={`h-2 rounded-full transition-all duration-1000 ${
                        gameTimeExpired ? 'bg-red-500' :
                        gameTimeCritical ? 'bg-red-400' :
                        gameTimeWarning ? 'bg-yellow-400' :
                        'bg-green-400'
                      }`}
                      style={{
                        width: `${Math.max(0, Math.min(100, (gameTimeRemaining / SCENARIO_DURATION_LIMIT) * 100))}%`,
                      }}
                    />
                  </div>
                </div>

          {/* Stop Button (Game Manager Only) */}
          {isGameManager && (
            <>
              <div className="hidden sm:block flex-1 border-l border-slate-700/50 min-w-[1px]" />
              <div className="flex items-center flex-shrink-0">
                <button
                  onClick={handleStop}
                  disabled={isStopping || (gameStatus !== 'running' && gameStatus !== 'paused')}
                  className={`px-3 sm:px-4 py-2 rounded-lg font-semibold text-sm transition-colors whitespace-nowrap ${
                    isStopping || (gameStatus !== 'running' && gameStatus !== 'paused')
                      ? 'bg-slate-600 cursor-not-allowed opacity-50'
                      : 'bg-orange-600 hover:bg-orange-700 text-white'
                  }`}
                  title="Stop the current game session"
                >
                  {isStopping ? 'Stopping...' : 'Stop Game'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Memoize the component - since it has no props, it will only re-render when
// the Zustand subscriptions change (which we've optimized with shallow comparison)
export default memo(GameBanner);


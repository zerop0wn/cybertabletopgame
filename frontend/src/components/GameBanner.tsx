import { useGameStore } from '../store/useGameStore';
import { useEffect, useState, useRef, memo, useCallback, useMemo } from 'react';
import { gameApi } from '../api/client';
import { shallow } from 'zustand/shallow';
import { useThrottledTimer } from '../hooks/useThrottledTimer';

const SCENARIO_DURATION_LIMIT = 1800; // 30 minutes in seconds
const TURN_TIME_LIMIT = 300; // 5 minutes in seconds

function GameBanner() {
  // Subscribe only to the specific fields we need for visibility
  // Use shallow comparison to prevent re-renders when other gameState fields change
  const { gameStatus, redBriefingDismissed, currentTurn, turnTimeLimit, turnStartTime, role, setGameState, gameState } = useGameStore(
    (state) => ({
      gameStatus: state.gameState?.status,
      redBriefingDismissed: state.gameState?.red_briefing_dismissed,
      currentTurn: state.gameState?.current_turn,
      turnTimeLimit: state.gameState?.turn_time_limit,
      turnStartTime: state.gameState?.turn_start_time,
      role: state.role,
      setGameState: state.setGameState,
      gameState: state.gameState,
    }),
    shallow
  );

  const [isStopping, setIsStopping] = useState(false);
  
  // Use optimized timer hooks
  const gameTimeRemaining = useThrottledTimer({
    startTime: gameState?.start_time,
    timeLimit: SCENARIO_DURATION_LIMIT,
    throttleSeconds: 2, // Update every 2 seconds for game time
    isActive: gameStatus === 'running',
    fallbackTimer: gameState?.timer,
  });

  const turnTimeRemaining = useThrottledTimer({
    startTime: turnStartTime,
    timeLimit: turnTimeLimit || TURN_TIME_LIMIT,
    throttleSeconds: 1, // Update every 1 second for turn time
    isActive: gameStatus === 'running' && !!currentTurn && !!turnStartTime,
  });

  // Calculate effective turn time limit
  const effectiveTurnTimeLimit = turnTimeLimit || TURN_TIME_LIMIT;

  // Calculate visibility - memoized to prevent recalculation
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

  // Memoize format function
  const formatTime = useCallback((seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // Memoize all computed values
  const isRunning = useMemo(() => gameStatus === 'running', [gameStatus]);
  const isRedTurn = useMemo(() => currentTurn === 'red', [currentTurn]);
  const isBlueTurn = useMemo(() => currentTurn === 'blue', [currentTurn]);
  const isGameManager = useMemo(() => role === 'gm', [role]);

  const gameTimeStr = useMemo(() => formatTime(gameTimeRemaining), [gameTimeRemaining, formatTime]);
  const turnTimeStr = useMemo(() => formatTime(turnTimeRemaining), [turnTimeRemaining, formatTime]);
  
  const gameTimeWarning = useMemo(() => gameTimeRemaining < 300, [gameTimeRemaining]);
  const gameTimeCritical = useMemo(() => gameTimeRemaining < 60, [gameTimeRemaining]);
  const gameTimeExpired = useMemo(() => gameTimeRemaining === 0, [gameTimeRemaining]);
  
  const turnTimeWarning = useMemo(() => turnTimeRemaining < 30, [turnTimeRemaining]);
  const turnTimeCritical = useMemo(() => turnTimeRemaining < 10, [turnTimeRemaining]);
  const turnTimeExpired = useMemo(() => turnTimeRemaining === 0, [turnTimeRemaining]);

  // Memoize progress bar widths
  const gameProgressWidth = useMemo(() => {
    return Math.max(0, Math.min(100, (gameTimeRemaining / SCENARIO_DURATION_LIMIT) * 100));
  }, [gameTimeRemaining]);

  const turnProgressWidth = useMemo(() => {
    return Math.max(0, Math.min(100, (turnTimeRemaining / effectiveTurnTimeLimit) * 100));
  }, [turnTimeRemaining, effectiveTurnTimeLimit]);

  const handleStop = useCallback(async () => {
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
  }, [setGameState]);

  // Always render but use CSS visibility/opacity to control visibility
  // This prevents layout shifts and DOM removal which causes flickering
  return (
    <div 
      className="w-full bg-gradient-to-r from-slate-800 via-slate-800/95 to-slate-800 border-b-2 border-slate-700/50 shadow-lg"
      style={{
        opacity: shouldShow ? 1 : 0,
        visibility: shouldShow ? 'visible' : 'hidden',
        pointerEvents: shouldShow ? 'auto' : 'none',
        height: shouldShow ? 'auto' : '0',
        overflow: shouldShow ? 'visible' : 'hidden',
        transition: 'opacity 0.2s ease-out',
        willChange: shouldShow ? 'opacity' : 'auto',
      }}
    >
      <div className="container mx-auto px-4 sm:px-6 py-3 max-w-7xl">
        <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-6">
          {/* Turn Indicator */}
          <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-shrink-0">
            <div 
              className={`w-3 h-3 rounded-full flex-shrink-0 ${
                isRedTurn ? 'bg-red-500' : isBlueTurn ? 'bg-blue-500' : 'bg-slate-500'
              } ${turnTimeCritical ? 'animate-pulse' : ''}`}
              style={{ willChange: turnTimeCritical ? 'opacity' : 'auto' }}
            />
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
              <div 
                className={`text-xl sm:text-2xl font-mono font-bold ${
                  turnTimeExpired ? 'text-red-500' :
                  turnTimeCritical ? 'text-red-400 animate-pulse' :
                  turnTimeWarning ? 'text-yellow-400' :
                  isRedTurn ? 'text-red-300' : 'text-blue-300'
                }`}
                style={{ willChange: turnTimeCritical ? 'color' : 'auto' }}
              >
                {turnTimeStr}
              </div>
            </div>
            {/* Turn time progress bar */}
            <div className="w-12 sm:w-16 bg-slate-700/50 rounded-full h-2 flex-shrink-0 overflow-hidden">
              <div
                className={`h-2 rounded-full ${
                  turnTimeExpired ? 'bg-red-500' :
                  turnTimeCritical ? 'bg-red-400' :
                  turnTimeWarning ? 'bg-yellow-400' :
                  isRedTurn ? 'bg-red-500/50' : 'bg-blue-500/50'
                }`}
                style={{
                  width: `${turnProgressWidth}%`,
                  transition: 'width 0.3s ease-out',
                  willChange: 'width',
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
              <div 
                className={`text-xl sm:text-2xl font-mono font-bold ${
                  gameTimeExpired ? 'text-red-500' :
                  gameTimeCritical ? 'text-red-400 animate-pulse' :
                  gameTimeWarning ? 'text-yellow-400' :
                  'text-green-400'
                }`}
                style={{ willChange: gameTimeCritical ? 'color' : 'auto' }}
              >
                {gameTimeStr}
              </div>
            </div>
            {/* Game time progress bar */}
            <div className="w-12 sm:w-16 bg-slate-700/50 rounded-full h-2 flex-shrink-0 overflow-hidden">
              <div
                className={`h-2 rounded-full ${
                  gameTimeExpired ? 'bg-red-500' :
                  gameTimeCritical ? 'bg-red-400' :
                  gameTimeWarning ? 'bg-yellow-400' :
                  'bg-green-400'
                }`}
                style={{
                  width: `${gameProgressWidth}%`,
                  transition: 'width 0.3s ease-out',
                  willChange: 'width',
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

// Memoize the component - it will only re-render when subscribed values change
export default memo(GameBanner);

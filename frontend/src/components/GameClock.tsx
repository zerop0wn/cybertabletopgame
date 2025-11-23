import { memo, useMemo } from 'react';
import { useGameStore } from '../store/useGameStore';
import { useThrottledTimer } from '../hooks/useThrottledTimer';
import { shallow } from 'zustand/shallow';

const SCENARIO_DURATION_LIMIT = 1800; // 30 minutes in seconds

const GameClock = memo(function GameClock() {
  // Subscribe only to specific fields to prevent unnecessary re-renders
  const { gameStatus, gameState } = useGameStore(
    (state) => ({
      gameStatus: state.gameState?.status,
      gameState: state.gameState,
    }),
    shallow
  );

  // Use optimized timer hook
  const gameTimeRemaining = useThrottledTimer({
    startTime: gameState?.start_time,
    timeLimit: SCENARIO_DURATION_LIMIT,
    throttleSeconds: 2, // Update every 2 seconds
    isActive: gameStatus === 'running',
    fallbackTimer: gameState?.timer,
  });

  const elapsed = SCENARIO_DURATION_LIMIT - gameTimeRemaining;

  // Memoize format function
  const formatTime = (seconds: number): string => {
    const clampedSeconds = Math.max(0, Math.min(seconds, SCENARIO_DURATION_LIMIT));
    const mins = Math.floor(clampedSeconds / 60);
    const secs = clampedSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Memoize all computed values
  const remainingStr = useMemo(() => formatTime(gameTimeRemaining), [gameTimeRemaining]);
  const isWarning = useMemo(() => gameTimeRemaining < 300, [gameTimeRemaining]);
  const isCritical = useMemo(() => gameTimeRemaining < 60, [gameTimeRemaining]);
  const isExpired = useMemo(() => gameTimeRemaining === 0, [gameTimeRemaining]);
  const isRunning = useMemo(() => gameStatus === 'running', [gameStatus]);

  // Memoize progress bar width
  const progressWidth = useMemo(() => {
    return Math.max(0, Math.min(100, (gameTimeRemaining / SCENARIO_DURATION_LIMIT) * 100));
  }, [gameTimeRemaining]);

  return (
    <div className="bg-slate-800 rounded-2xl p-4 border-2 border-slate-700">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm font-semibold text-slate-300">Game Time Remaining</div>
        {isExpired && (
          <span 
            className="text-xs font-bold text-red-500 animate-pulse"
            style={{ willChange: 'opacity' }}
          >
            TIME UP
          </span>
        )}
        {!isRunning && (
          <span className="text-xs text-slate-500">Not Running</span>
        )}
      </div>
      
      <div className="space-y-3">
        {/* Countdown Display - Large and Prominent */}
        <div className="text-center">
          <span 
            className={`text-4xl font-mono font-bold ${
              !isRunning ? 'text-slate-500' :
              isExpired ? 'text-red-500' :
              isCritical ? 'text-red-400 animate-pulse' :
              isWarning ? 'text-yellow-400' :
              'text-green-400'
            }`}
            style={{ willChange: isCritical ? 'color' : 'auto' }}
          >
            {remainingStr}
          </span>
        </div>
        
        {/* Progress Bar - optimized with will-change */}
        <div className="w-full bg-slate-700 rounded-full h-3 mt-2 overflow-hidden">
          <div
            className={`h-3 rounded-full ${
              !isRunning ? 'bg-slate-600' :
              isExpired ? 'bg-red-500' :
              isCritical ? 'bg-red-400' :
              isWarning ? 'bg-yellow-400' :
              'bg-green-400'
            }`}
            style={{
              width: `${progressWidth}%`,
              transition: 'width 0.3s ease-out',
              willChange: 'width',
            }}
          />
        </div>
        
        {/* Status Text */}
        <div className="text-center text-xs text-slate-400">
          {!isRunning && 'Game not started'}
          {isRunning && isExpired && 'Time limit reached'}
          {isRunning && !isExpired && isCritical && 'Less than 1 minute remaining'}
          {isRunning && !isExpired && !isCritical && isWarning && 'Less than 5 minutes remaining'}
          {isRunning && !isExpired && !isCritical && !isWarning && 'Game in progress'}
        </div>
      </div>
    </div>
  );
});

GameClock.displayName = 'GameClock';

export default GameClock;

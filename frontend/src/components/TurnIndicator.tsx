import { useEffect, useRef, memo, useMemo } from 'react';
import { useGameStore } from '../store/useGameStore';
import { useThrottledTimer } from '../hooks/useThrottledTimer';
import { shallow } from 'zustand/shallow';

const TURN_TIME_LIMIT = 300; // 5 minutes in seconds

const TurnIndicator = memo(function TurnIndicator() {
  // Subscribe only to specific fields to prevent unnecessary re-renders
  const { gameStatus, currentTurn, turnStartTime, turnTimeLimit, redTurnCount, blueTurnCount, maxTurns } = useGameStore(
    (state) => ({
      gameStatus: state.gameState?.status,
      currentTurn: state.gameState?.current_turn,
      turnStartTime: state.gameState?.turn_start_time,
      turnTimeLimit: state.gameState?.turn_time_limit,
      redTurnCount: state.gameState?.red_turn_count,
      blueTurnCount: state.gameState?.blue_turn_count,
      maxTurns: state.gameState?.max_turns_per_side,
    }),
    shallow
  );

  // Use optimized timer hook
  const turnTimeRemaining = useThrottledTimer({
    startTime: turnStartTime,
    timeLimit: turnTimeLimit || TURN_TIME_LIMIT,
    throttleSeconds: 1, // Update every 1 second
    isActive: gameStatus === 'running' && !!currentTurn && !!turnStartTime,
  });

  // Memoize computed values
  const isRunning = useMemo(() => gameStatus === 'running', [gameStatus]);
  const isRedTurn = useMemo(() => currentTurn === 'red', [currentTurn]);
  const isBlueTurn = useMemo(() => currentTurn === 'blue', [currentTurn]);
  
  const effectiveTurnTimeLimit = useMemo(() => turnTimeLimit || TURN_TIME_LIMIT, [turnTimeLimit]);
  
  // Calculate current turn number (1-indexed for display)
  const currentTurnNumber = useMemo(() => {
    return isRedTurn ? (redTurnCount || 0) + 1 : (blueTurnCount || 0) + 1;
  }, [isRedTurn, redTurnCount, blueTurnCount]);

  const formatTime = (seconds: number): string => {
    const clampedSeconds = Math.max(0, Math.min(seconds, effectiveTurnTimeLimit));
    const mins = Math.floor(clampedSeconds / 60);
    const secs = clampedSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const turnTimeStr = useMemo(() => formatTime(turnTimeRemaining), [turnTimeRemaining, effectiveTurnTimeLimit]);
  const isWarning = useMemo(() => turnTimeRemaining < 30, [turnTimeRemaining]); // Less than 30 seconds
  const isCritical = useMemo(() => turnTimeRemaining < 10, [turnTimeRemaining]); // Less than 10 seconds
  const isExpired = useMemo(() => turnTimeRemaining === 0, [turnTimeRemaining]);
  
  // Memoize progress bar width to prevent recalculation
  const progressWidth = useMemo(() => {
    return Math.max(0, Math.min(100, (turnTimeRemaining / effectiveTurnTimeLimit) * 100));
  }, [turnTimeRemaining, effectiveTurnTimeLimit]);

  if (!isRunning) {
    return (
      <div className="rounded-2xl p-4 border-2 bg-slate-800/50 border-slate-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 rounded-full bg-slate-500" />
            <div>
              <div className="text-xs text-slate-400 mb-1">Current Turn</div>
              <div className="text-xl font-bold text-slate-500">
                Waiting for game...
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl p-4 border-2 ${
      isRedTurn 
        ? 'bg-red-900/20 border-red-500/50' 
        : 'bg-blue-900/20 border-blue-500/50'
    }`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div 
            className={`w-4 h-4 rounded-full ${
              isRedTurn ? 'bg-red-500' : 'bg-blue-500'
            } ${isCritical ? 'animate-pulse' : ''}`}
            style={{ willChange: isCritical ? 'opacity' : 'auto' }}
          />
          <div>
            <div className="text-xs text-slate-400 mb-1">Current Turn</div>
            <div className={`text-xl font-bold ${
              isRedTurn ? 'text-red-400' : 'text-blue-400'
            }`}>
              {isRedTurn ? 'RED TEAM' : 'BLUE TEAM'}
            </div>
            {maxTurns && (
              <div className="text-xs text-slate-500 mt-0.5">
                Turn {currentTurnNumber}/{maxTurns}
              </div>
            )}
          </div>
        </div>
        
        <div className="text-right">
          <div className="text-xs text-slate-400 mb-1">Turn Time</div>
          <div 
            className={`text-lg font-mono font-bold ${
              isExpired ? 'text-red-500' :
              isCritical ? 'text-red-400 animate-pulse' :
              isWarning ? 'text-yellow-400' :
              isRedTurn ? 'text-red-300' : 'text-blue-300'
            }`}
            style={{ willChange: isCritical ? 'color' : 'auto' }}
          >
            {turnTimeStr}
          </div>
        </div>
      </div>
      
      {/* Turn time progress bar - optimized with will-change */}
      <div className="mt-3 w-full bg-slate-700/50 rounded-full h-1.5 overflow-hidden">
        <div
          className={`h-1.5 rounded-full ${
            isExpired ? 'bg-red-500' :
            isCritical ? 'bg-red-400' :
            isWarning ? 'bg-yellow-400' :
            isRedTurn ? 'bg-red-500/50' : 'bg-blue-500/50'
          }`}
          style={{
            width: `${progressWidth}%`,
            transition: 'width 0.3s ease-out',
            willChange: 'width',
          }}
        />
      </div>
    </div>
  );
});

TurnIndicator.displayName = 'TurnIndicator';

export default TurnIndicator;

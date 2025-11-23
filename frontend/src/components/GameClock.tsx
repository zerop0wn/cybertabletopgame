import { useEffect, useState, useRef, memo } from 'react';
import { useGameStore } from '../store/useGameStore';

const SCENARIO_DURATION_LIMIT = 1800; // 30 minutes in seconds

const GameClock = memo(function GameClock() {
  const { gameState } = useGameStore();
  const [displayTime, setDisplayTime] = useState({ elapsed: 0, remaining: SCENARIO_DURATION_LIMIT });
  const gameStateRef = useRef(gameState);
  const prevDisplayTimeRef = useRef({ elapsed: 0, remaining: SCENARIO_DURATION_LIMIT });

  // Keep ref updated with latest gameState
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    // Calculate elapsed time - always use current time for real-time updates
    const calculateElapsed = () => {
      const currentGameState = gameStateRef.current;
      
      if (!currentGameState || currentGameState.status !== 'running') {
        return 0;
      }
      
      // Always calculate from start_time using current time for real-time updates
      if (currentGameState.start_time) {
        try {
          const now = new Date().getTime();
          // Parse start_time - backend sends UTC time, ensure we parse it correctly
          let start: number;
          const startTimeStr = currentGameState.start_time;
          
          // If the string doesn't end with 'Z' or have timezone info, assume it's UTC
          if (typeof startTimeStr === 'string' && !startTimeStr.endsWith('Z') && !startTimeStr.includes('+') && !startTimeStr.includes('-', 10)) {
            // Parse as UTC by appending 'Z' or using Date.UTC
            start = new Date(startTimeStr + 'Z').getTime();
            // If that fails, try parsing as-is (might already be correct)
            if (isNaN(start)) {
              start = new Date(startTimeStr).getTime();
            }
          } else {
            start = new Date(startTimeStr).getTime();
          }
          
          // Check if start_time is valid
          if (isNaN(start)) {
            console.warn('[GameClock] Invalid start_time:', currentGameState.start_time);
            return 0;
          }
          
          // If start appears to be in the future, it's likely a timezone issue
          // In that case, use the timer value from the backend if available
          if (start > now) {
            // Check if we have a timer value from backend (which is calculated server-side)
            if (currentGameState.timer !== undefined && currentGameState.timer !== null) {
              // Removed console.log to reduce noise
              return Math.max(0, Math.min(currentGameState.timer, SCENARIO_DURATION_LIMIT));
            }
            // Only log warnings for actual issues, not routine timezone handling
            // console.warn('[GameClock] start_time is in the future, using 0 elapsed');
            return 0;
          }
          
          const calculated = Math.floor((now - start) / 1000);
          // Ensure non-negative and cap at limit
          return Math.max(0, Math.min(calculated, SCENARIO_DURATION_LIMIT));
        } catch (e) {
          console.error('[GameClock] Error calculating elapsed time:', e);
          return 0;
        }
      }
      
      return 0;
    };

    const updateTime = () => {
      const elapsed = calculateElapsed();
      const remaining = Math.max(0, SCENARIO_DURATION_LIMIT - elapsed);
      
      // Only update if values changed significantly (2+ seconds) to prevent flickering
      const elapsedChanged = Math.abs(prevDisplayTimeRef.current.elapsed - elapsed) >= 2;
      const remainingChanged = Math.abs(prevDisplayTimeRef.current.remaining - remaining) >= 2;
      if (elapsedChanged || remainingChanged) {
        prevDisplayTimeRef.current = { elapsed, remaining };
        setDisplayTime({ elapsed, remaining });
      }
    };

    // Initial update
    // Removed console.log to reduce noise
    updateTime();

    // Update every second for smooth countdown
    const interval = setInterval(updateTime, 1000);
    // Removed console.log to reduce noise

    return () => clearInterval(interval);
  }, []); // Empty deps - interval runs continuously, reads from ref

  // Force update when gameState changes (to ensure we recalculate immediately)
  // But only when status or start_time changes, not on every timer update
  const prevStatusRef = useRef(gameState?.status);
  const prevStartTimeRef = useRef(gameState?.start_time);
  
  useEffect(() => {
    const statusChanged = gameState?.status !== prevStatusRef.current;
    const startTimeChanged = gameState?.start_time !== prevStartTimeRef.current;
    
    // Only update if status or start_time actually changed (not just timer)
    if (!statusChanged && !startTimeChanged) {
      return; // Skip update to prevent flickering
    }
    
    // Update refs
    prevStatusRef.current = gameState?.status;
    prevStartTimeRef.current = gameState?.start_time;
    
    if (gameState?.status === 'running') {
      // Prefer backend timer value if available (calculated server-side, avoids timezone issues)
      if (gameState.timer !== undefined && gameState.timer !== null) {
        const elapsed = Math.max(0, Math.min(gameState.timer, SCENARIO_DURATION_LIMIT));
        const remaining = Math.max(0, SCENARIO_DURATION_LIMIT - elapsed);
        setDisplayTime(prev => {
          // Only update if values actually changed
          if (prev.elapsed !== elapsed || prev.remaining !== remaining) {
            return { elapsed, remaining };
          }
          return prev;
        });
        return;
      }
      
      // Fallback to calculating from start_time if timer not available
      if (gameState?.start_time) {
        const now = new Date().getTime();
        let start: number;
        const startTimeStr = gameState.start_time;
        
        // Parse as UTC if no timezone info
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
          const remaining = Math.max(0, SCENARIO_DURATION_LIMIT - elapsed);
          setDisplayTime(prev => {
            // Only update if values actually changed
            if (prev.elapsed !== elapsed || prev.remaining !== remaining) {
              return { elapsed, remaining };
            }
            return prev;
          });
        }
      }
    } else if (gameState?.status && (gameState.status as string) !== 'running') {
      setDisplayTime(prev => {
        // Only update if values actually changed
        if (prev.elapsed !== 0 || prev.remaining !== SCENARIO_DURATION_LIMIT) {
          return { elapsed: 0, remaining: SCENARIO_DURATION_LIMIT };
        }
        return prev;
      });
    }
  }, [gameState?.status, gameState?.start_time]);

  const formatTime = (seconds: number): string => {
    // Ensure non-negative and within valid range
    const clampedSeconds = Math.max(0, Math.min(seconds, SCENARIO_DURATION_LIMIT));
    const mins = Math.floor(clampedSeconds / 60);
    const secs = clampedSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const elapsedStr = formatTime(displayTime.elapsed);
  const remainingStr = formatTime(displayTime.remaining);
  const isWarning = displayTime.remaining < 300; // Less than 5 minutes
  const isCritical = displayTime.remaining < 60; // Less than 1 minute
  const isExpired = displayTime.remaining === 0;

  const isRunning = gameState?.status === 'running';

  return (
    <div className="bg-slate-800 rounded-2xl p-4 border-2 border-slate-700">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm font-semibold text-slate-300">Game Time Remaining</div>
        {isExpired && (
          <span className="text-xs font-bold text-red-500 animate-pulse">TIME UP</span>
        )}
        {!isRunning && (
          <span className="text-xs text-slate-500">Not Running</span>
        )}
      </div>
      
      <div className="space-y-3">
        {/* Countdown Display - Large and Prominent */}
        <div className="text-center">
          <span className={`text-4xl font-mono font-bold ${
            !isRunning ? 'text-slate-500' :
            isExpired ? 'text-red-500' :
            isCritical ? 'text-red-400 animate-pulse' :
            isWarning ? 'text-yellow-400' :
            'text-green-400'
          }`}>
            {remainingStr}
          </span>
        </div>
        
        {/* Progress Bar */}
        <div className="w-full bg-slate-700 rounded-full h-3 mt-2">
          <div
            className={`h-3 rounded-full transition-all duration-1000 ${
              !isRunning ? 'bg-slate-600' :
              isExpired ? 'bg-red-500' :
              isCritical ? 'bg-red-400' :
              isWarning ? 'bg-yellow-400' :
              'bg-green-400'
            }`}
            style={{
              width: `${Math.max(0, Math.min(100, (displayTime.remaining / SCENARIO_DURATION_LIMIT) * 100))}%`,
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


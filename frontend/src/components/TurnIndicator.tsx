import { useEffect, useState, useRef } from 'react';
import { useGameStore } from '../store/useGameStore';

const TURN_TIME_LIMIT = 300; // 5 minutes in seconds

export default function TurnIndicator() {
  const { gameState } = useGameStore();
  const [turnTimeRemaining, setTurnTimeRemaining] = useState(TURN_TIME_LIMIT);
  const gameStateRef = useRef(gameState);

  // Keep ref updated with latest gameState
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);
  
  // Calculate turn time remaining
  useEffect(() => {
    const calculateTurnTime = () => {
      const currentGameState = gameStateRef.current;
      
      if (!currentGameState || currentGameState.status !== 'running' || !currentGameState.current_turn || !currentGameState.turn_start_time) {
        return currentGameState?.turn_time_limit || TURN_TIME_LIMIT;
      }

      try {
        const now = new Date().getTime();
        // Parse turn_start_time - backend sends UTC time, ensure we parse it correctly
        let start: number;
        const startTimeStr = currentGameState.turn_start_time;
        const turnTimeLimit = currentGameState.turn_time_limit || TURN_TIME_LIMIT;
        
        // If the string doesn't end with 'Z' or have timezone info, assume it's UTC
        if (typeof startTimeStr === 'string' && !startTimeStr.endsWith('Z') && !startTimeStr.includes('+') && !startTimeStr.includes('-', 10)) {
          // Parse as UTC by appending 'Z'
          start = new Date(startTimeStr + 'Z').getTime();
          // If that fails, try parsing as-is (might already be correct)
          if (isNaN(start)) {
            start = new Date(startTimeStr).getTime();
          }
        } else {
          start = new Date(startTimeStr).getTime();
        }
        
        if (isNaN(start)) {
          console.warn('[TurnIndicator] Invalid turn_start_time:', currentGameState.turn_start_time);
          return turnTimeLimit;
        }
        
        // If start appears to be in the future, it's likely a timezone issue
        // In that case, return the full time limit (turn hasn't started yet from client's perspective)
        if (start > now) {
          console.warn('[TurnIndicator] turn_start_time is in the future (timezone issue), using full time limit');
          return turnTimeLimit;
        }
        
        const elapsed = Math.floor((now - start) / 1000);
        const remaining = Math.max(0, turnTimeLimit - elapsed);
        return remaining;
      } catch (e) {
        console.error('[TurnIndicator] Error calculating turn time:', e);
        return currentGameState?.turn_time_limit || TURN_TIME_LIMIT;
      }
    };

    const updateTime = () => {
      const remaining = calculateTurnTime();
      setTurnTimeRemaining(prev => {
        // Only update if value actually changed
        if (prev !== remaining) {
          return remaining;
        }
        return prev;
      });
    };

    // Initial update
    updateTime();

    // Update every second
    const interval = setInterval(updateTime, 1000);

    return () => clearInterval(interval);
  }, []); // Empty deps - interval runs continuously, reads from ref

  // Force update when gameState changes (to ensure we recalculate immediately)
  // This is especially important when the turn switches due to timeout
  // But only update when turn actually changes, not on every state update
  const prevTurnRef = useRef(gameState?.current_turn);
  const prevTurnStartTimeRef = useRef(gameState?.turn_start_time);
  
  useEffect(() => {
    const turnChanged = gameState?.current_turn !== prevTurnRef.current;
    const turnStartTimeChanged = gameState?.turn_start_time !== prevTurnStartTimeRef.current;
    
    // Only update if turn or turn_start_time actually changed
    if (!turnChanged && !turnStartTimeChanged) {
      return; // Skip update to prevent flickering
    }
    
    // Update refs
    prevTurnRef.current = gameState?.current_turn;
    prevTurnStartTimeRef.current = gameState?.turn_start_time;
    
    if (gameState?.status === 'running' && gameState?.current_turn && gameState?.turn_start_time) {
      try {
        const now = new Date().getTime();
        let start: number;
        const startTimeStr = gameState.turn_start_time;
        const turnTimeLimit = gameState.turn_time_limit || TURN_TIME_LIMIT;
        
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
          const remaining = Math.max(0, turnTimeLimit - elapsed);
          // Immediately update when turn changes (reset to full time if turn just switched)
          setTurnTimeRemaining(prev => {
            // Only update if value actually changed
            if (prev !== remaining) {
              return remaining;
            }
            return prev;
          });
        } else if (start > now) {
          // Timezone issue - set to full time limit
          console.warn('[TurnIndicator] turn_start_time in future, using full time limit');
          setTurnTimeRemaining(prev => {
            if (prev !== turnTimeLimit) {
              return turnTimeLimit;
            }
            return prev;
          });
        }
      } catch (e) {
        console.error('[TurnIndicator] Error in force update:', e);
        const limit = gameState.turn_time_limit || TURN_TIME_LIMIT;
        setTurnTimeRemaining(prev => {
          if (prev !== limit) {
            return limit;
          }
          return prev;
        });
      }
    } else {
      const limit = gameState?.turn_time_limit || TURN_TIME_LIMIT;
      setTurnTimeRemaining(prev => {
        if (prev !== limit) {
          return limit;
        }
        return prev;
      });
    }
  }, [gameState?.status, gameState?.current_turn, gameState?.turn_start_time, gameState?.turn_time_limit]);
  
  const isRunning = gameState?.status === 'running';
  const currentTurn = gameState?.current_turn;
  const turnTimeLimit = gameState?.turn_time_limit || TURN_TIME_LIMIT;
  
  const formatTime = (seconds: number): string => {
    const clampedSeconds = Math.max(0, Math.min(seconds, turnTimeLimit));
    const mins = Math.floor(clampedSeconds / 60);
    const secs = clampedSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const turnTimeStr = formatTime(turnTimeRemaining);
  const isWarning = turnTimeRemaining < 30; // Less than 30 seconds
  const isCritical = turnTimeRemaining < 10; // Less than 10 seconds
  const isExpired = turnTimeRemaining === 0;
  
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

  const isRedTurn = currentTurn === 'red';
  const isBlueTurn = currentTurn === 'blue';
  
  // Get turn counts
  const redTurnCount = gameState?.red_turn_count || 0;
  const blueTurnCount = gameState?.blue_turn_count || 0;
  const maxTurns = gameState?.max_turns_per_side;
  
  // Calculate current turn number (1-indexed for display)
  const currentTurnNumber = isRedTurn ? redTurnCount + 1 : blueTurnCount + 1;

  return (
    <div className={`rounded-2xl p-4 border-2 ${
      isRedTurn 
        ? 'bg-red-900/20 border-red-500/50' 
        : 'bg-blue-900/20 border-blue-500/50'
    }`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-4 h-4 rounded-full ${
            isRedTurn ? 'bg-red-500' : 'bg-blue-500'
          } ${isCritical ? 'animate-pulse' : ''}`} />
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
          <div className={`text-lg font-mono font-bold ${
            isExpired ? 'text-red-500' :
            isCritical ? 'text-red-400 animate-pulse' :
            isWarning ? 'text-yellow-400' :
            isRedTurn ? 'text-red-300' : 'text-blue-300'
          }`}>
            {turnTimeStr}
          </div>
        </div>
      </div>
      
      {/* Turn time progress bar */}
      <div className="mt-3 w-full bg-slate-700/50 rounded-full h-1.5">
        <div
          className={`h-1.5 rounded-full transition-all duration-1000 ${
            isExpired ? 'bg-red-500' :
            isCritical ? 'bg-red-400' :
            isWarning ? 'bg-yellow-400' :
            isRedTurn ? 'bg-red-500/50' : 'bg-blue-500/50'
          }`}
          style={{
            width: `${Math.max(0, Math.min(100, (turnTimeRemaining / turnTimeLimit) * 100))}%`,
          }}
        />
      </div>
    </div>
  );
}


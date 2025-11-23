/**
 * Optimized timer hook that uses requestAnimationFrame for smooth updates
 * and throttles state updates to prevent flickering.
 * 
 * This hook calculates time remaining from a start time and only updates
 * state when the value changes by a significant amount (throttleMs).
 */
import { useEffect, useState, useRef, useCallback } from 'react';

interface UseThrottledTimerOptions {
  /** Start time in ISO string format */
  startTime: string | null | undefined;
  /** Time limit in seconds */
  timeLimit: number;
  /** Only update state if time changed by this many seconds (default: 1) */
  throttleSeconds?: number;
  /** Whether the timer is active */
  isActive?: boolean;
  /** Fallback timer value from backend (in seconds) */
  fallbackTimer?: number | null;
}

export function useThrottledTimer({
  startTime,
  timeLimit,
  throttleSeconds = 1,
  isActive = true,
  fallbackTimer,
}: UseThrottledTimerOptions): number {
  const [timeRemaining, setTimeRemaining] = useState(timeLimit);
  const prevTimeRef = useRef(timeLimit);
  const rafRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(0);

  // Parse start time once and cache it
  const parseStartTime = useCallback((timeStr: string | null | undefined): number | null => {
    if (!timeStr) return null;
    
    try {
      // Parse as UTC if no timezone info
      let start: number;
      if (typeof timeStr === 'string' && !timeStr.endsWith('Z') && !timeStr.includes('+') && !timeStr.includes('-', 10)) {
        start = new Date(timeStr + 'Z').getTime();
        if (isNaN(start)) {
          start = new Date(timeStr).getTime();
        }
      } else {
        start = new Date(timeStr).getTime();
      }
      
      return isNaN(start) ? null : start;
    } catch {
      return null;
    }
  }, []);

  // Calculate time remaining
  const calculateTime = useCallback((): number => {
    if (!isActive) {
      return timeLimit;
    }

    // Try to use start time first
    if (startTime) {
      const start = parseStartTime(startTime);
      if (start) {
        const now = Date.now();
        if (start <= now) {
          const elapsed = Math.floor((now - start) / 1000);
          return Math.max(0, timeLimit - elapsed);
        }
      }
    }

    // Fallback to backend timer if available
    if (fallbackTimer !== null && fallbackTimer !== undefined) {
      const elapsed = Math.max(0, Math.min(fallbackTimer, timeLimit));
      return Math.max(0, timeLimit - elapsed);
    }

    return timeLimit;
  }, [startTime, timeLimit, isActive, fallbackTimer, parseStartTime]);

  // Update function using requestAnimationFrame for smooth updates
  const updateTime = useCallback(() => {
    const now = performance.now();
    // Throttle updates to at most every 100ms (10fps for timer updates is plenty)
    if (now - lastUpdateRef.current < 100) {
      rafRef.current = requestAnimationFrame(updateTime);
      return;
    }
    lastUpdateRef.current = now;

    const remaining = calculateTime();
    
    // Only update state if value changed by throttle amount
    if (Math.abs(prevTimeRef.current - remaining) >= throttleSeconds) {
      prevTimeRef.current = remaining;
      setTimeRemaining(remaining);
    }

    // Continue animation loop
    rafRef.current = requestAnimationFrame(updateTime);
  }, [calculateTime, throttleSeconds]);

  // Start/stop animation loop
  useEffect(() => {
    if (isActive) {
      // Initial update
      const initial = calculateTime();
      prevTimeRef.current = initial;
      setTimeRemaining(initial);
      
      // Start animation loop
      rafRef.current = requestAnimationFrame(updateTime);
      
      return () => {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      };
    } else {
      // Reset when inactive
      prevTimeRef.current = timeLimit;
      setTimeRemaining(timeLimit);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }
  }, [isActive, updateTime, calculateTime, timeLimit]);

  // Force update when startTime changes significantly
  useEffect(() => {
    if (isActive && startTime) {
      const remaining = calculateTime();
      if (Math.abs(prevTimeRef.current - remaining) >= throttleSeconds) {
        prevTimeRef.current = remaining;
        setTimeRemaining(remaining);
      }
    }
  }, [startTime, isActive, calculateTime, throttleSeconds]);

  return timeRemaining;
}


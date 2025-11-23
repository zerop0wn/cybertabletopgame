/** Zustand store for game state. */
import { create } from 'zustand';
import { Event, GameState, Scenario, Score, Alert, BlueAction, GameStatus } from '../api/types';
import { persist } from 'zustand/middleware';

interface GameStore {
  // UI state
  role: 'gm' | 'red' | 'blue' | 'audience' | null;
  playerName: string;
  darkMode: boolean;
  
  // Auth state (only used if FEATURE_AUTH_GM or FEATURE_JOIN_CODES is True)
  authToken: string | null;
  sessionId: string | null;
  session: any | null; // SessionCreateResponse
  
  // Game state
  gameState: GameState | null;
  currentScenario: Scenario | null;
  score: Score;
  
  // Events (last 100)
  events: Event[];
  
  // Alerts (for Blue team)
  alerts: Alert[];
  
  // Actions (for Blue team)
  actions: BlueAction[];
  
  // v2 fields (only used if FEATURE_WS_SNAPSHOT is enabled)
  serverAnchorTs?: string;
  
  // Actions
  setRole: (role: 'gm' | 'red' | 'blue' | 'audience') => void;
  setPlayerName: (name: string) => void;
  setDarkMode: (dark: boolean) => void;
  setAuthToken: (token: string | null) => void;
  setSessionId: (sessionId: string | null) => void;
  setSession: (session: any | null) => void;
  setGameState: (state: GameState) => void;
  setCurrentScenario: (scenario: Scenario | null) => void;
  setScore: (score: Score) => void;
  addEvent: (event: Event) => void;
  addAlert: (alert: Alert) => void;
  addAction: (action: BlueAction) => void;
      clearEvents: () => void;
      setServerAnchorTs?: (ts: string) => void;
}

export const useGameStore = create<GameStore>()(
  persist(
    (set) => ({
      role: null,
      playerName: '',
      darkMode: true,
      authToken: null,
      sessionId: null,
      session: null,
      gameState: null,
      currentScenario: null,
      score: { red: 0, blue: 0, round_breakdown: [] },
      events: [],
      alerts: [],
      actions: [],
      serverAnchorTs: undefined,
      
      setRole: (role) => set({ role }),
      setPlayerName: (name) => set({ playerName: name }),
      setDarkMode: (dark) => set({ darkMode: dark }),
      setAuthToken: (token) => set({ authToken: token }),
      setSessionId: (sessionId) => set({ sessionId }),
      setSession: (session) => set({ session }),
      setGameState: (state) => set((currentState) => {
        // Prevent unnecessary updates by comparing state
        // Only update if state actually changed (shallow comparison of key fields)
        if (currentState.gameState) {
          const current = currentState.gameState;
          const newState = state;
          
          // CRITICAL: If game was running and new state shows 'lobby' or 'finished' with lower round, this is likely stale
          // Check if we have indicators that the game is actually still running (scenario ID, round, etc.)
          const gameWasRunning = current.status === GameStatus.RUNNING;
          const hasRunningIndicators = current.current_scenario_id || current.round || current.start_time;
          const newStateShowsLobby = newState.status === GameStatus.LOBBY || String(newState.status) === 'lobby';
          const newStateShowsFinished = newState.status === GameStatus.FINISHED || String(newState.status) === 'finished';
          
          // If game was running and new state shows finished, check if it's a stale state (lower round number)
          if (gameWasRunning && hasRunningIndicators && newStateShowsFinished) {
            const currentRound = current.round || 0;
            const newRound = newState.round || 0;
            // If new state has a lower round number, it's from a previous game - ignore it
            if (newRound < currentRound) {
              console.warn('[Store] Ignoring stale finished status - current round', currentRound, 'new round', newRound);
              const preservedState = { 
                ...newState, 
                status: GameStatus.RUNNING,
                // Preserve critical running state fields
                current_turn: newState.current_turn || current.current_turn,
                turn_start_time: newState.turn_start_time || current.turn_start_time,
                start_time: newState.start_time || current.start_time,
                current_scenario_id: newState.current_scenario_id || current.current_scenario_id,
                round: current.round, // Keep current round, not the stale one
                // Preserve scan fields
                red_scan_completed: newState.red_scan_completed ?? current.red_scan_completed,
                red_scan_success: newState.red_scan_success ?? current.red_scan_success,
                red_scan_tool: newState.red_scan_tool || current.red_scan_tool,
                red_scan_results: newState.red_scan_results || current.red_scan_results,
              };
              return { gameState: preservedState };
            }
          }
          
          if (gameWasRunning && hasRunningIndicators && newStateShowsLobby) {
            // Game was running with clear indicators, but new state shows lobby - this is stale
            // Preserve running status and merge other fields
            console.warn('[Store] Ignoring stale lobby status - game was running with scenario/round');
            const preservedState = { 
              ...newState, 
              status: GameStatus.RUNNING,
              // Preserve critical running state fields
              current_turn: newState.current_turn || current.current_turn,
              turn_start_time: newState.turn_start_time || current.turn_start_time,
              start_time: newState.start_time || current.start_time,
              current_scenario_id: newState.current_scenario_id || current.current_scenario_id,
              round: newState.round || current.round,
              // Preserve scan fields
              red_scan_completed: newState.red_scan_completed ?? current.red_scan_completed,
              red_scan_success: newState.red_scan_success ?? current.red_scan_success,
              red_scan_tool: newState.red_scan_tool || current.red_scan_tool,
              red_scan_results: newState.red_scan_results || current.red_scan_results,
            };
            return { gameState: preservedState };
          }
          
          // Quick check: if it's just a timer update and timer hasn't changed significantly, skip
          // Timer updates every second, but we only need to update UI every 5 seconds to prevent flickering
          if (current.status === newState.status && 
              current.status === GameStatus.RUNNING &&
              current.timer !== undefined && 
              newState.timer !== undefined &&
              Math.abs((current.timer || 0) - (newState.timer || 0)) < 5) {
            // Check if only timer field changed by comparing key fields
            const keyFields = ['status', 'current_turn', 'turn_start_time', 'start_time', 'current_scenario_id', 
                              'red_scan_completed', 'red_scan_success', 'red_scan_tool',
                              'red_vulnerability_identified', 'blue_ip_identified', 'blue_action_identified',
                              'blue_investigation_completed', 'red_pivot_strategy_selected', 'red_attack_selected', 'round'];
            const otherFieldsChanged = keyFields.some(field => current[field] !== newState[field]);
            
            if (!otherFieldsChanged) {
              // Only timer changed by less than 5 seconds - skip update to prevent flickering
              return currentState;
            }
          }
          
          // Check if state actually changed (compare key fields)
          const keyFields = ['status', 'current_turn', 'turn_start_time', 'start_time', 'current_scenario_id', 'round'];
          let hasSignificantChange = keyFields.some(field => current[field] !== newState[field]) ||
            (current.timer !== undefined && newState.timer !== undefined && Math.abs((current.timer || 0) - (newState.timer || 0)) >= 5);
          
          // Check array/object fields for changes (only if they exist)
          if (!hasSignificantChange) {
            const currentScans = current.red_scan_results || [];
            const newScans = newState.red_scan_results || [];
            if (currentScans.length !== newScans.length) {
              hasSignificantChange = true;
            } else {
              // Quick check: compare scan IDs
              for (let i = 0; i < currentScans.length; i++) {
                if (currentScans[i]?.scan_id !== newScans[i]?.scan_id) {
                  hasSignificantChange = true;
                  break;
                }
              }
            }
          }
          
          if (!hasSignificantChange && current.status === GameStatus.RUNNING && newState.status === GameStatus.RUNNING) {
            // No significant change - preserve existing state to prevent flickering
            return currentState;
          }
        }
        
        // IMPORTANT: If game was running and new state has invalid/missing status, preserve running status
        // This prevents flickering when periodic refreshes temporarily return incomplete state
        if (currentState.gameState && currentState.gameState.status === GameStatus.RUNNING) {
          // Game was running - if new state shows 'lobby' or has invalid status, preserve running status
          // 'lobby' status during a running game is likely a stale/incorrect response
          const isValidStatus = state.status === GameStatus.RUNNING || state.status === GameStatus.PAUSED || state.status === GameStatus.FINISHED;
          if (!state.status || state.status === GameStatus.LOBBY || String(state.status) === 'lobby' || !isValidStatus) {
            // New state has invalid/missing/lobby status - preserve running status and merge other fields
            const preservedState = { 
              ...state, 
              status: GameStatus.RUNNING,
              // Preserve critical running state fields
              current_turn: state.current_turn || currentState.gameState.current_turn,
              turn_start_time: state.turn_start_time || currentState.gameState.turn_start_time,
              start_time: state.start_time || currentState.gameState.start_time,
              current_scenario_id: state.current_scenario_id || currentState.gameState.current_scenario_id,
              round: state.round || currentState.gameState.round,
            };
            return { gameState: preservedState };
          }
        }
        
        // Preserve scan fields if game is still running and new state doesn't have them
        // This prevents scan data from being lost during periodic refreshes
        if (currentState.gameState && state.status === GameStatus.RUNNING && currentState.gameState.status === GameStatus.RUNNING) {
          // Game is still running - preserve scan fields if they're not in the new state
          const preservedState = { ...state };
          if (currentState.gameState.red_scan_completed && !state.red_scan_completed) {
            preservedState.red_scan_completed = currentState.gameState.red_scan_completed;
          }
          if (currentState.gameState.red_scan_success && !state.red_scan_success) {
            preservedState.red_scan_success = currentState.gameState.red_scan_success;
          }
          if (currentState.gameState.red_scan_tool && !state.red_scan_tool) {
            preservedState.red_scan_tool = currentState.gameState.red_scan_tool;
          }
          return { gameState: preservedState };
        }
        // Game was reset or initial load - use new state as-is
        return { gameState: state };
      }),
      setCurrentScenario: (scenario) => set({ currentScenario: scenario }),
      setScore: (scoreUpdate) =>
        set((state) => {
          // If scoreUpdate has round_breakdown, it's a full score update
          // Otherwise, treat it as absolute values from backend
          const isFullUpdate = 'round_breakdown' in scoreUpdate && scoreUpdate.round_breakdown !== undefined;
          
          const newScore = isFullUpdate
            ? {
                red: scoreUpdate.red ?? state.score.red,
                blue: scoreUpdate.blue ?? state.score.blue,
                mttd: scoreUpdate.mttd ?? state.score.mttd,
                mttc: scoreUpdate.mttc ?? state.score.mttc,
                round_breakdown: scoreUpdate.round_breakdown ?? state.score.round_breakdown,
              }
            : {
                // Backend sends absolute values, so use them directly
                red: scoreUpdate.red ?? state.score.red,
                blue: scoreUpdate.blue ?? state.score.blue,
                mttd: scoreUpdate.mttd ?? state.score.mttd,
                mttc: scoreUpdate.mttc ?? state.score.mttc,
                round_breakdown: state.score.round_breakdown,
              };
          return { score: newScore };
        }),
      
      addEvent: (event) =>
        set((state) => {
          // Check if event with this ID already exists to prevent duplicates
          const existingIndex = state.events.findIndex(e => e.id === event.id);
          if (existingIndex !== -1) {
            // Event already exists, don't add duplicate (silently skip to reduce console noise)
            return state;
          }
          // Add new event and keep only last 100
          const newEvents = [...state.events, event].slice(-100);
          // Only log important events to reduce console noise
          if (event.kind === 'attack_launched' || event.kind === 'attack_resolved' || 
              event.kind === 'round_started' || event.kind === 'round_ended' ||
              event.kind === 'turn_changed' || event.kind === 'action_taken') {
            console.log('[Store] Added event:', event.kind, 'Total events:', newEvents.length);
          }
          return { events: newEvents };
        }),
      
      addAlert: (alert) =>
        set((state) => {
          // Check if alert with this ID already exists to prevent duplicates
          const existingIndex = state.alerts.findIndex(a => a.id === alert.id);
          if (existingIndex !== -1) {
            // Alert already exists, don't add duplicate (silently skip to reduce console noise)
            return state;
          }
          const newAlerts = [...state.alerts, alert];
          return { alerts: newAlerts };
        }),
      
      addAction: (action) =>
        set((state) => {
          const newActions = [...state.actions, action];
          return { actions: newActions };
        }),
      
      clearEvents: () => set({ events: [], alerts: [], actions: [], serverAnchorTs: undefined }),
      
      setServerAnchorTs: (ts) => set({ serverAnchorTs: ts }),
    }),
    {
      name: 'pewpew-storage',
      partialize: (state) => ({
        role: state.role,
        playerName: state.playerName,
        darkMode: state.darkMode,
        authToken: state.authToken,
        sessionId: state.sessionId,
        session: state.session,
      }),
    }
  )
);


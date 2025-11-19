/** Zustand store for game state. */
import { create } from 'zustand';
import { Event, GameState, Scenario, Score, Alert, BlueAction } from '../api/types';
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
        // Preserve scan fields if game is still running and new state doesn't have them
        // This prevents scan data from being lost during periodic refreshes
        if (currentState.gameState && state.status === 'running' && currentState.gameState.status === 'running') {
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


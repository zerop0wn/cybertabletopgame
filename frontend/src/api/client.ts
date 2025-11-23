/** API client for backend communication. */
import axios from 'axios';
import { Scenario, GameState, AttackLaunchRequest, ActionRequest, Score, ScanRequest, ScanResult, VoteRequest, VoteResponse, PlayerChoice, VotingStatus, ChatRequest, ChatMessage, ActivityRequest, ActivityEvent, PresenceStatus } from './types';
import { useGameStore } from '../store/useGameStore';

/**
 * Get the API base URL dynamically based on environment and host.
 * Supports both localhost (with Vite proxy) and remote hosts.
 * 
 * Note: VITE_BACKEND_URL is only used for Vite proxy configuration.
 * In the browser, we always use window.location to determine the backend URL.
 */
function getApiBaseUrl(): string {
  // In the browser, always use window.location to determine the backend URL
  // VITE_BACKEND_URL is only for Vite proxy config, not for browser requests
  if (typeof window !== 'undefined') {
    // Check if we're in development on localhost (use Vite proxy)
    if (import.meta.env.DEV && 
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      return '/api';
    }
    
    // For production or remote hosts, construct URL from current host
    // Use same protocol and hostname, but port 8000 for backend
    // If VITE_PUBLIC_BACKEND_URL is set, use that instead (for production builds)
    const publicBackendUrl = import.meta.env.VITE_PUBLIC_BACKEND_URL;
    if (publicBackendUrl) {
      return `${publicBackendUrl}/api`;
    }
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    return `${protocol}//${hostname}:8000/api`;
  }
  
  // Fallback (shouldn't happen in browser, but for SSR safety)
  return 'http://localhost:8000/api';
}

const api = axios.create({
  baseURL: getApiBaseUrl(),
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests if available
api.interceptors.request.use((config) => {
  const token = useGameStore.getState().authToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const scenariosApi = {
  list: async (): Promise<Scenario[]> => {
    const baseURL = getApiBaseUrl();
    console.log('[scenariosApi] Calling list with baseURL:', baseURL);
    try {
      const { data } = await api.get('/scenarios');
      console.log('[scenariosApi] Received scenarios:', data?.length || 0);
      return data;
    } catch (error: any) {
      console.error('[scenariosApi] Error loading scenarios:', {
        message: error?.message,
        response: error?.response?.data,
        status: error?.response?.status,
        url: error?.config?.url,
        baseURL: error?.config?.baseURL,
        fullURL: error?.config?.baseURL + error?.config?.url,
      });
      throw error;
    }
  },
  
  get: async (id: string): Promise<Scenario> => {
    const baseURL = getApiBaseUrl();
    console.log('[scenariosApi] Calling get with baseURL:', baseURL, 'id:', id);
    try {
      const { data } = await api.get(`/scenarios/${id}`);
      console.log('[scenariosApi] Received scenario:', data?.id);
      return data;
    } catch (error: any) {
      console.error('[scenariosApi] Error loading scenario:', {
        message: error?.message,
        response: error?.response?.data,
        status: error?.response?.status,
        url: error?.config?.url,
        baseURL: error?.config?.baseURL,
      });
      throw error;
    }
  },
};

export const gameApi = {
  getState: async (): Promise<GameState> => {
    const { data } = await api.get('/game/state');
    return data;
  },
  
  start: async (scenarioId: string): Promise<GameState> => {
    const { data } = await api.post('/game/start', { scenario_id: scenarioId });
    return data;
  },
  
  pause: async (): Promise<GameState> => {
    const { data } = await api.post('/game/pause');
    return data;
  },
  
  resume: async (): Promise<GameState> => {
    const { data } = await api.post('/game/resume');
    return data;
  },
  
  stop: async (): Promise<GameState> => {
    const { data } = await api.post('/game/stop');
    return data;
  },
  
  reset: async (): Promise<GameState> => {
    const { data } = await api.post('/game/reset');
    return data;
  },
  
  dismissBriefing: async (): Promise<GameState> => {
    const { data } = await api.post('/game/dismiss-briefing');
    return data;
  },
  
};

export const attacksApi = {
  launch: async (request: AttackLaunchRequest) => {
    const { data } = await api.post('/attacks/launch', request);
    return data;
  },
};

export const scansApi = {
  scan: async (request: ScanRequest): Promise<ScanResult> => {
    const { data } = await api.post('/scans/scan', request);
    return data;
  },
  identifyVulnerability: async (playerName: string, scanTool: string) => {
    const { data } = await api.post('/scans/identify-vulnerability', {
      player_name: playerName,
      scan_tool: scanTool,
    });
    return data;
  },
  selectAttack: async (playerName: string, attackId: string) => {
    const { data } = await api.post('/scans/select-attack', {
      player_name: playerName,
      attack_id: attackId,
    });
    return data;
  },
};

export const actionsApi = {
  submit: async (request: ActionRequest) => {
    const { data } = await api.post('/actions', request);
    return data;
  },
};

export const scoreApi = {
  get: async (): Promise<Score> => {
    const { data } = await api.get('/score');
    return data;
  },
};

// Auth API (only used if FEATURE_AUTH_GM is True)
export const authApi = {
  login: async (username: string, password: string) => {
    console.log('[authApi] Calling /auth/gm/login', { username });
    try {
      const { data } = await api.post('/auth/gm/login', { username, password });
      console.log('[authApi] Login response received', data);
      return data;
    } catch (error: any) {
      console.error('[authApi] Login error', error);
      throw error;
    }
  },
};

// Sessions API (only used if FEATURE_JOIN_CODES is True)
export const sessionsApi = {
  create: async () => {
    const { data } = await api.post('/sessions');
    return data;
  },
  
  rotateCodes: async (sessionId: string) => {
    const { data } = await api.post(`/sessions/rotate-codes?session_id=${sessionId}`);
    return data;
  },
  
  join: async (code: string) => {
    const { data } = await api.post('/sessions/join', { code });
    return data;
  },
  
  get: async (sessionId: string) => {
    const { data } = await api.get(`/sessions/${sessionId}`);
    return data;
  },
  
  getActive: async () => {
    const { data } = await api.get('/sessions/active');
    return data;
  },
};

// Voting API
export const votingApi = {
  vote: async (request: VoteRequest): Promise<VoteResponse> => {
    const { data } = await api.post('/voting/vote', request);
    return data;
  },
  
  submitChoice: async (choice: PlayerChoice): Promise<VoteResponse> => {
    const { data } = await api.post('/voting/choice', choice);
    return data;
  },
  
  getStatus: async (role: string): Promise<VotingStatus> => {
    const { data } = await api.get(`/voting/status?role=${role}`);
    return data;
  },
};

// Chat API
export const chatApi = {
  send: async (request: ChatRequest): Promise<{ success: boolean; message_id: string }> => {
    const { data } = await api.post('/chat/send', request);
    return data;
  },
  
  getHistory: async (role: string): Promise<{ role: string; messages: ChatMessage[] }> => {
    const { data } = await api.get(`/chat/history?role=${role}`);
    return data;
  },
};

// Activity API
export const activityApi = {
  track: async (request: ActivityRequest): Promise<{ success: boolean; activity_id: string }> => {
    const { data } = await api.post('/activity/track', request);
    return data;
  },
  
  getRecent: async (role: string, limit: number = 20): Promise<{ role: string; activities: ActivityEvent[] }> => {
    const { data } = await api.get(`/activity/recent?role=${role}&limit=${limit}`);
    return data;
  },
};

// Presence API
export const playersApi = {
  assignName: async (role: 'red' | 'blue', sessionId?: string) => {
    const { data } = await api.post('/players/assign-name', {
      role,
      session_id: sessionId || null,
    });
    return data;
  },
  releaseName: async (playerName: string, role: 'red' | 'blue', sessionId?: string) => {
    const { data } = await api.post('/players/release-name', {
      player_name: playerName,
      role,
      session_id: sessionId || null,
    });
    return data;
  },
  getTeamSize: async (role: 'red' | 'blue', sessionId?: string) => {
    const { data } = await api.get('/players/team-size', {
      params: {
        role,
        session_id: sessionId || null,
      },
    });
    return data;
  },
};

export const presenceApi = {
  update: async (playerName: string, role: string, currentActivity?: string): Promise<{ success: boolean }> => {
    const { data } = await api.post('/presence/update', null, {
      params: { player_name: playerName, role, current_activity: currentActivity },
    });
    return data;
  },
  
  getStatus: async (role: string): Promise<PresenceStatus> => {
    const { data } = await api.get(`/presence/status?role=${role}`);
    return data;
  },
  
  heartbeat: async (playerName: string, role: string): Promise<{ success: boolean }> => {
    const { data } = await api.post('/presence/heartbeat', null, {
      params: { player_name: playerName, role },
    });
    return data;
  },
};


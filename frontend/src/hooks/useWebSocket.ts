/** WebSocket hook for real-time events. */
import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Event, EventKind, Alert, BlueAction, WebSocketEventPayload } from '../api/types';
import { useGameStore } from '../store/useGameStore';
import { gameApi } from '../api/client';

// Feature flags (default false for backward compatibility)
const FEATURE_WS_SNAPSHOT = import.meta.env.VITE_FEATURE_WS_SNAPSHOT === 'true';
const FEATURE_TIMELINE_SLA = import.meta.env.VITE_FEATURE_TIMELINE_SLA === 'true';
const FEATURE_AUTH_GM = import.meta.env.VITE_FEATURE_AUTH_GM === 'true';
const FEATURE_JOIN_CODES = import.meta.env.VITE_FEATURE_JOIN_CODES === 'true';

/**
 * Get the WebSocket URL dynamically based on environment and host.
 * Supports both localhost (with Vite proxy) and remote hosts.
 * Returns the base URL (without /socket.io path) - Socket.IO handles the path internally.
 * 
 * Note: VITE_BACKEND_URL is only used for Vite proxy configuration.
 * In the browser, we always use window.location to determine the backend URL.
 */
function getWebSocketUrl(): string | undefined {
  // In the browser, always use window.location to determine the backend URL
  // VITE_BACKEND_URL is only for Vite proxy config, not for browser requests
  if (typeof window !== 'undefined') {
    // Check if we're in development on localhost (use Vite proxy)
    if (import.meta.env.DEV && 
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      // Return undefined to use relative URL (Vite proxy handles it)
      return undefined;
    }
    
    // Check if VITE_PUBLIC_BACKEND_URL is set and points to an ALB (old deployment)
    // If it does, ignore it and use relative URLs (for EC2 deployment with Nginx)
    const publicBackendUrl = import.meta.env.VITE_PUBLIC_BACKEND_URL;
    if (publicBackendUrl) {
      // If it's an ALB URL, ignore it and use relative URLs (Nginx will proxy)
      if (publicBackendUrl.includes('.elb.amazonaws.com') || 
          publicBackendUrl.includes('apprunner') ||
          publicBackendUrl.includes('cloudfront.net')) {
        // Use relative URL - Nginx will proxy to backend
        return undefined;
      }
      // Otherwise, use the provided URL (for other deployments)
      return publicBackendUrl;
    }
    
    // For EC2 deployment with Nginx, use relative URLs (Nginx proxies both frontend and backend)
    // For other deployments, construct URL from current host
    // Check if we're on the same domain (EC2 with Nginx) - use relative URL
    // Otherwise, try to construct backend URL
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    
    // If we're on a standard port (80/443), assume Nginx is proxying - use relative URL
    const isStandardPort = window.location.port === '' || 
                          window.location.port === '80' || 
                          window.location.port === '443';
    
    if (isStandardPort) {
      // Use relative URL - Nginx will proxy to backend
      return undefined;
    }
    
    // Otherwise, construct backend URL with port 8000
    return `${protocol}//${hostname}:8000`;
  }
  
  // Fallback (shouldn't happen in browser, but for SSR safety)
  return 'http://localhost:8000';
}

export function useWebSocket(role: 'gm' | 'red' | 'blue' | 'audience' | null) {
  const socketRef = useRef<Socket | null>(null);
  const storeRef = useRef(useGameStore.getState());
  const lastErrorRef = useRef<string>('');
  const errorCountRef = useRef<number>(0);
  const isConnectingRef = useRef<boolean>(false);
  const roleRef = useRef(role);

  // Update role ref when it changes
  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  // Update store ref when store changes
  useEffect(() => {
    const unsubscribe = useGameStore.subscribe((state) => {
      storeRef.current = state;
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!role) {
      // Clean up existing socket if role is removed
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      isConnectingRef.current = false;
      return;
    }

    // If socket already exists and is connected, reuse it - don't create a new one
    if (socketRef.current) {
      if (socketRef.current.connected) {
        // Already connected, just ensure we're in the right room
        // Don't log or re-join unnecessarily to prevent spam
        isConnectingRef.current = false;
        return;
      } else if (isConnectingRef.current) {
        // Already in the process of connecting, don't create another connection
        return;
      } else {
        // Clean up disconnected socket before creating a new one
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    }

    // Mark as connecting to prevent duplicate connections
    isConnectingRef.current = true;

    // Get WebSocket URL dynamically based on environment
    const wsUrl = getWebSocketUrl();
    const displayUrl = wsUrl || '/socket.io (via proxy)';
    console.log(`[WebSocket] Connecting to: ${displayUrl}`);
    
    // Socket.IO options - if wsUrl is undefined, use relative URL (Vite proxy)
    const socketOptions: any = {
      path: '/socket.io',
      transports: ['polling', 'websocket'], // Try polling first, then upgrade to websocket
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 10, // Increased from 5 to 10 for better reliability
      timeout: 20000,
      forceNew: false, // Allow connection reuse
      upgrade: true,
      rememberUpgrade: true,
    };
    
    // Only add URL if it's defined (for remote hosts), otherwise use relative (for localhost with proxy)
    const socket = wsUrl ? io(wsUrl, socketOptions) : io(socketOptions);

    socketRef.current = socket;

    let joinTimeout: ReturnType<typeof setTimeout> | null = null;

    socket.on('connect', () => {
      // Reset error counters and connecting flag on successful connection
      lastErrorRef.current = '';
      errorCountRef.current = 0;
      isConnectingRef.current = false;
      const currentRole = roleRef.current; // Use ref to get current role
      console.log(`[WebSocket] Connected successfully to ${displayUrl}, joining room:`, currentRole);
      // Wait a bit before joining to ensure connection is fully established
      joinTimeout = setTimeout(() => {
        if (socket.connected && currentRole) {
          const store = storeRef.current;
          // If auth/join codes are enabled, send token if available
          if (FEATURE_AUTH_GM || FEATURE_JOIN_CODES) {
            const token = store.authToken;
            if (token) {
              console.log('[WebSocket] Joining with token');
              socket.emit('join', { role: currentRole, token });
            } else {
              // No token yet - use legacy behavior (backend will allow it)
              console.log('[WebSocket] No token available, using legacy join');
              socket.emit('join', { role: currentRole });
            }
          } else {
            // Legacy behavior: no token
            socket.emit('join', { role: currentRole });
          }
        }
      }, 200);
    });

    socket.on('joined', (data) => {
      console.log('Successfully joined room:', data);
    });

    socket.on('connect_error', (error) => {
      // Throttle error logging to avoid console spam
      const errorMessage = error.message || String(error);
      if (lastErrorRef.current !== errorMessage) {
        lastErrorRef.current = errorMessage;
        errorCountRef.current = 0;
      }
      errorCountRef.current++;
      // Log first error with full details, then throttle
      if (errorCountRef.current === 1) {
        console.error(`[WebSocket] Connection error (attempt ${errorCountRef.current}):`, errorMessage);
        console.error(`[WebSocket] Attempted URL: ${displayUrl}`);
        console.error(`[WebSocket] Error details:`, error);
      } else if (errorCountRef.current % 10 === 0) {
        console.warn(`[WebSocket] Connection error (attempt ${errorCountRef.current}):`, errorMessage);
      }
    });

    socket.on('disconnect', (reason) => {
      console.log('WebSocket disconnected:', reason);
      if (joinTimeout) {
        clearTimeout(joinTimeout);
        joinTimeout = null;
      }
      // Reset connecting flag on disconnect
      isConnectingRef.current = false;
      // Only clear socket ref if it's a forced disconnect or error
      if (reason === 'io server disconnect' || reason === 'transport close') {
        socketRef.current = null;
      }
    });

    socket.on('game_event', (payload: any) => {
      const store = storeRef.current;
      
      // Handle both legacy format (Event directly) and v2 format (wrapped in payload)
      let event: Event;
      if (payload && typeof payload === 'object' && 'type' in payload && payload.type === 'game_event' && payload.event) {
        // v2 format: { type: "game_event", v?: "2", event: {...} }
        event = payload.event as Event;
        // Only log non-timer events to reduce console noise
        if (event.kind !== 'timer_update' && event.kind !== 'TIMER_UPDATE') {
          console.log('[WebSocket] v2 event received:', event.kind, payload.v || 'v1');
        }
      } else if (payload && typeof payload === 'object' && 'id' in payload && 'kind' in payload) {
        // Legacy format: Event directly (or unwrapped v2 format)
        event = payload as Event;
        // Only log non-timer events to reduce console noise
        if (event.kind !== 'timer_update' && event.kind !== 'TIMER_UPDATE') {
          console.log('[WebSocket] Legacy/v1 event received:', event.kind);
        }
      } else {
        console.warn('[WebSocket] Invalid event payload:', payload);
        return;
      }
      
      // Handle timer_update events separately - they update game state but shouldn't be in timeline
      // Debounce timer updates to prevent flickering (only update every 5 seconds)
      if (event.kind === 'timer_update' || event.kind === 'TIMER_UPDATE') {
        if (store.gameState) {
          const timerValue = event.payload.timer || event.payload.elapsed || 0;
          const validTimer = Math.max(0, timerValue);
          const currentTimer = store.gameState.timer || 0;
          
          // Only update if timer changed by more than 5 seconds to prevent flickering
          // This reduces re-renders from every second to every 5 seconds
          if (Math.abs(validTimer - currentTimer) >= 5 || validTimer === 0) {
            store.setGameState({
              ...store.gameState,
              timer: validTimer,
            });
          }
        }
        // Don't add timer_update events to the timeline - they're too frequent and not meaningful
        return; // Early return to skip adding to timeline
      }

      // Handle scan_completed events - update gameState with scan results
      if (event.kind === 'scan_completed' || event.kind === 'SCAN_COMPLETED') {
        if (store.gameState) {
          // Update gameState with scan completion info
          // The tool value from backend is already a string (enum value)
          const scanTool = event.payload?.tool;
          const scanSuccess = event.payload?.success || false;
          
          // Add new scan result to the list
          const newScanResult = {
            scan_id: event.payload?.scan_id || '',
            tool: scanTool,
            target_node: event.payload?.target_node || '',
            success: scanSuccess,
            results: event.payload?.results || {},
            timestamp: event.payload?.timestamp || new Date().toISOString(),
            message: event.payload?.message || '',
            player_name: event.payload?.player_name,
            source_ip: event.payload?.source_ip,  // Include source IP
          };
          
          // Get existing scan results or initialize empty array
          const existingResults = Array.isArray(store.gameState.red_scan_results) 
            ? store.gameState.red_scan_results 
            : [];
          
          // Check if this scan_id already exists (prevent duplicates)
          const scanExists = existingResults.some(s => s && s.scan_id === newScanResult.scan_id);
          
          const updatedResults = scanExists 
            ? existingResults 
            : [...existingResults, newScanResult];
          
          store.setGameState({
            ...store.gameState,
            red_scan_completed: true,
            red_scan_tool: scanTool,
            red_scan_success: scanSuccess,
            red_scan_results: updatedResults,
          });
          console.log('[WebSocket] Scan completed event - tool:', scanTool, 'success:', scanSuccess, 'total scans:', updatedResults.length, 'scan_id:', newScanResult.scan_id);
        } else {
          console.warn('[WebSocket] Scan completed event received but gameState is null');
        }
      }

      // Handle vulnerability_identified events
      if (event.kind === 'vulnerability_identified' || event.kind === 'VULNERABILITY_IDENTIFIED') {
        if (store.gameState) {
          const votes = event.payload?.votes || {};  // Full votes dict (player_name -> tool)
          const totalVotes = event.payload?.total_votes || 0;
          
          store.setGameState({
            ...store.gameState,
            red_vulnerability_identified: event.payload?.majority_is_correct || false,
            red_vulnerability_votes: votes,
          });
          console.log('[WebSocket] Vulnerability identification event - total votes:', totalVotes, 'majority correct:', event.payload?.majority_is_correct);
        }
      }
      
      // Handle ip_identified events
      if (event.kind === EventKind.IP_IDENTIFIED || event.kind === 'ip_identified' || event.kind === 'IP_IDENTIFIED') {
        if (store.gameState) {
          const votes = event.payload?.votes || {};  // Full votes dict (player_name -> ip)
          const totalVotes = event.payload?.total_votes || 0;
          
          store.setGameState({
            ...store.gameState,
            blue_ip_identified: event.payload?.majority_is_correct || false,
            blue_ip_votes: votes,
          });
          console.log('[WebSocket] IP identification event - total votes:', totalVotes, 'majority correct:', event.payload?.majority_is_correct);
        }
      }
      
      // Handle action_identified events
      if (event.kind === EventKind.ACTION_IDENTIFIED || event.kind === 'action_identified' || event.kind === 'ACTION_IDENTIFIED') {
        if (store.gameState) {
          const votes = event.payload?.votes || {};  // Full votes dict (player_name -> action_type)
          const totalVotes = event.payload?.total_votes || 0;
          
          store.setGameState({
            ...store.gameState,
            blue_action_identified: event.payload?.majority_is_correct || false,
            blue_action_votes: votes,
          });
          console.log('[WebSocket] Action identification event - total votes:', totalVotes, 'majority correct:', event.payload?.majority_is_correct);
        }
      }
      
      // Handle investigation_completed events
      if (event.kind === EventKind.INVESTIGATION_COMPLETED || event.kind === 'investigation_completed' || event.kind === 'INVESTIGATION_COMPLETED') {
        if (store.gameState) {
          const votes = event.payload?.votes || {};  // Full votes dict (player_name -> attack_status)
          const totalVotes = event.payload?.total_votes || 0;
          
          store.setGameState({
            ...store.gameState,
            blue_investigation_completed: event.payload?.majority_is_correct || false,
            blue_investigation_votes: votes,
          });
          console.log('[WebSocket] Investigation completed event - total votes:', totalVotes, 'majority correct:', event.payload?.majority_is_correct);
        }
      }
      
      // Handle pivot_strategy_selected events
      if (event.kind === EventKind.PIVOT_STRATEGY_SELECTED || event.kind === 'pivot_strategy_selected' || event.kind === 'PIVOT_STRATEGY_SELECTED') {
        if (store.gameState) {
          const votes = event.payload?.votes || {};  // Full votes dict (player_name -> pivot_strategy)
          const totalVotes = event.payload?.total_votes || 0;
          
          store.setGameState({
            ...store.gameState,
            red_pivot_strategy_selected: event.payload?.majority_is_correct || false,
            red_pivot_votes: votes,
          });
          console.log('[WebSocket] Pivot strategy selected event - total votes:', totalVotes, 'majority correct:', event.payload?.majority_is_correct);
        }
      }
      
      // Handle attack_selected events
      if (event.kind === EventKind.ATTACK_SELECTED || event.kind === 'attack_selected' || event.kind === 'ATTACK_SELECTED') {
        if (store.gameState) {
          const votes = event.payload?.votes || {};  // Full votes dict (player_name -> attack_id)
          const totalVotes = event.payload?.total_votes || 0;
          
          store.setGameState({
            ...store.gameState,
            red_attack_selected: event.payload?.has_majority || false,
            red_attack_votes: votes,
          });
          console.log('[WebSocket] Attack selected event - total votes:', totalVotes, 'majority reached:', event.payload?.has_majority, 'majority correct:', event.payload?.majority_is_correct);
        }
      }
      
      // Add events to the events array for timeline display (excluding timer_update which we handled above)
      store.addEvent(event);
      // Only log important events to reduce console noise
      if (event.kind === EventKind.ATTACK_LAUNCHED || event.kind === 'attack_launched' ||
          event.kind === EventKind.ATTACK_RESOLVED || event.kind === 'attack_resolved' ||
          event.kind === EventKind.ROUND_STARTED || event.kind === 'round_started' ||
          event.kind === EventKind.ROUND_ENDED || event.kind === 'round_ended' ||
          event.kind === EventKind.TURN_CHANGED || event.kind === 'turn_changed' ||
          event.kind === EventKind.ACTION_TAKEN || event.kind === 'action_taken') {
        const updatedStore = useGameStore.getState();
        console.log('[WebSocket] Event received:', event.kind, 'Total events:', updatedStore.events.length);
      }
      if (event.kind === EventKind.ATTACK_LAUNCHED || event.kind === 'attack_launched' || event.kind === 'ATTACK_LAUNCHED') {
        console.log('[WebSocket] attack_launched event received - attack_id:', event.payload?.attack_id, 'attack_type:', event.payload?.attack_type, 'from:', event.payload?.from, 'to:', event.payload?.to);
      }
      if (event.kind === 'attack_resolved') {
        console.log('[WebSocket] attack_resolved event - attack_id:', event.payload?.attack_id, 'result:', event.payload?.result, 'preliminary:', event.payload?.preliminary);
      }

      // Handle specific event types
      // Note: event.kind comes as a string from WebSocket, so we compare with enum values as strings
      switch (event.kind) {
        case EventKind.ALERT_EMITTED:
        case 'alert_emitted':
          // Always add alerts - they're filtered by role when displayed
          const alertData = event.payload as unknown as Alert;
          // Ensure timestamp is a string (Alert interface expects string)
          const alertWithTimestamp: Alert = { 
            ...alertData,
            timestamp: typeof alertData.timestamp === 'string' 
              ? alertData.timestamp 
              : (alertData.timestamp && typeof alertData.timestamp === 'object' && 'toISOString' in alertData.timestamp
                  ? (alertData.timestamp as Date).toISOString()
                  : new Date().toISOString())
          };
          console.log('[WebSocket] Received alert:', alertData.id, alertData.source, alertData.severity);
          store.addAlert(alertWithTimestamp);
          break;

        case EventKind.ACTION_TAKEN:
        case 'action_taken':
          console.log('[WebSocket] ACTION_TAKEN event received:', event.payload);
          // Add action to actions list (separate from events)
          if (role === 'blue' || role === 'gm' || role === 'red' || role === 'audience') {
            // Add action for all roles so they can see it
            store.addAction(event.payload as unknown as BlueAction);
          }
          console.log('[WebSocket] Added action_taken event to store. Event kind:', event.kind);
          break;

        case EventKind.SCORE_UPDATE:
        case 'score_update':
          // Ensure payload has required Score fields
          const scorePayload = event.payload as any;
          store.setScore({
            red: scorePayload.red || 0,
            blue: scorePayload.blue || 0,
            mttd: scorePayload.mttd,
            mttc: scorePayload.mttc,
            round_breakdown: scorePayload.round_breakdown || []
          });
          break;
        
        case EventKind.ROUND_STARTED:
        case 'round_started':
          // When round starts, fetch updated gameState to get start_time
          console.log('[WebSocket] Round started, fetching game state. Scenario:', event.payload?.scenario_id);
          // Immediately clear old scenario to prevent conflicts
          store.setCurrentScenario(null);
          gameApi.getState().then((state) => {
            console.log('[WebSocket] Fetched game state after round_started:', state);
            console.log('[WebSocket] Game status:', state.status, 'Scenario:', state.current_scenario_id, 'Round:', state.round);
            // Clear events when a new round starts to start fresh
            store.clearEvents();
            // Clear current scenario to force reload of new scenario
            store.setCurrentScenario(null);
            // Update game state - this will trigger scenario loading in Red/Blue pages
            store.setGameState(state);
            // Force a re-render by updating the store
            if (state.status === 'running') {
              console.log('[WebSocket] Game is now running, state updated, events cleared, scenario will be loaded');
            }
          }).catch((err) => {
            console.error('[WebSocket] Failed to fetch game state after round_started:', err);
            // Still clear scenario even on error
            store.setCurrentScenario(null);
          });
          break;
        
        case EventKind.ROUND_ENDED:
        case 'round_ended':
          // When round ends (game stopped/reset), fetch updated gameState
          console.log('[WebSocket] Round ended, fetching game state. Reason:', event.payload?.reason);
          // Immediately clear scenario to prevent loading old scenario
          store.setCurrentScenario(null);
          gameApi.getState().then((state) => {
            console.log('[WebSocket] Fetched game state after round_ended:', state);
            console.log('[WebSocket] Game status:', state.status, 'Scenario:', state.current_scenario_id);
            // Update game state (but don't clear events - let them persist for history)
            store.setGameState(state);
            // Always clear current scenario when round ends (game stopped/reset)
            // It will be reloaded if a new game starts
            store.setCurrentScenario(null);
          }).catch((err) => {
            console.error('[WebSocket] Failed to fetch game state after round_ended:', err);
            // Still clear scenario even on error
            store.setCurrentScenario(null);
          });
          break;
        
        case EventKind.TURN_CHANGED:
        case 'turn_changed':
          // Update game state with turn info
          console.log('[WebSocket] TURN_CHANGED event received:', {
            turn: event.payload.turn,
            reason: event.payload.reason,
            previous_turn: event.payload.previous_turn,
            turn_start_time: event.payload.turn_start_time,
          });
          // Note: Event is already added to store at line 190, so it will appear in timeline
          if (store.gameState) {
            const oldTurn = store.gameState.current_turn;
            const oldTurnStartTime = store.gameState.turn_start_time;
            // Use the turn_start_time from the event payload (backend sets it correctly)
            // If not provided, use current time as fallback
            const newTurnStartTime = event.payload.turn_start_time || new Date().toISOString();
            const newTurn = event.payload.turn;
            
            // Only update if values actually changed (prevent duplicate updates from multiple connections)
            if (oldTurn !== newTurn || oldTurnStartTime !== newTurnStartTime) {
              store.setGameState({
                ...store.gameState,
                current_turn: newTurn,
                turn_start_time: newTurnStartTime,
              });
              console.log(`[WebSocket] Turn updated from ${oldTurn} to ${newTurn}, turn_start_time: ${newTurnStartTime}`);
            } else {
              console.log(`[WebSocket] Turn unchanged (${oldTurn}), skipping state update`);
            }
          } else {
            console.warn('[WebSocket] TURN_CHANGED event received but gameState is null');
            // Try to fetch game state if we don't have it
            gameApi.getState()
              .then((state) => {
                store.setGameState(state);
                console.log('[WebSocket] Fetched game state after TURN_CHANGED');
              })
              .catch((err) => {
                console.error('[WebSocket] Failed to fetch game state after TURN_CHANGED:', err);
              });
          }
          break;
        
        case EventKind.TURN_TIMEOUT:
        case 'turn_timeout':
          // Handle turn timeout - update game state
          console.log('[WebSocket] TURN_TIMEOUT event received:', {
            expired_turn: event.payload.expired_turn,
            new_turn: event.payload.new_turn,
            reason: event.payload.reason,
            turn_start_time: event.payload.turn_start_time,
          });
          store.addEvent(event);
          if (store.gameState) {
            const oldTurn = store.gameState.current_turn;
            // Use turn_start_time from event payload if available, otherwise use current time
            const newTurnStartTime = event.payload.turn_start_time || new Date().toISOString();
            store.setGameState({
              ...store.gameState,
              current_turn: event.payload.new_turn,
              turn_start_time: newTurnStartTime,
            });
            console.log(`[WebSocket] Turn updated from ${oldTurn} to ${event.payload.new_turn} (timeout), turn_start_time: ${newTurnStartTime}`);
          } else {
            console.warn('[WebSocket] TURN_TIMEOUT event received but gameState is null');
            // Try to fetch game state if we don't have it
            gameApi.getState()
              .then((state) => {
                store.setGameState(state);
                console.log('[WebSocket] Fetched game state after TURN_TIMEOUT');
              })
              .catch((err) => {
                console.error('[WebSocket] Failed to fetch game state after TURN_TIMEOUT:', err);
              });
          }
          break;
      }
    });
    
    // Handle snapshot state (only if feature flag enabled)
    if (FEATURE_WS_SNAPSHOT) {
      socket.on('snapshot_state', (snapshot: WebSocketEventPayload) => {
        console.log('[WebSocket] Snapshot state received');
        const store = storeRef.current;
        
        // Update game state if provided
        if (snapshot.game_state) {
          store.setGameState(snapshot.game_state);
        }
        
        // Restore events from snapshot
        if (snapshot.events && Array.isArray(snapshot.events)) {
          snapshot.events.forEach((event: Event) => {
            store.addEvent(event);
          });
          console.log('[WebSocket] Restored', snapshot.events.length, 'events from snapshot');
        }
        
        // Store server timestamp anchor for resync
        if (snapshot.server_ts && storeRef.current.serverAnchorTs === undefined) {
          // Store timestamp for future resync requests
          storeRef.current.setServerAnchorTs?.(snapshot.server_ts);
        }
      });
      
      // Handle events_since RPC (if backend supports it)
      socket.on('events_since', (data: { events: Event[]; server_ts: string }) => {
        console.log('[WebSocket] events_since received:', data.events.length, 'events');
        const store = storeRef.current;
        
        data.events.forEach((event: Event) => {
          store.addEvent(event);
        });
        
        if (data.server_ts) {
          storeRef.current.setServerAnchorTs?.(data.server_ts);
        }
      });
    }

    return () => {
      // Only clean up if role changes or component unmounts
      // Don't disconnect on every re-render - this causes excessive reconnections
      if (joinTimeout) {
        clearTimeout(joinTimeout);
        joinTimeout = null;
      }
      // Reset connecting flag when role changes or component unmounts
      isConnectingRef.current = false;
      // Don't disconnect here - let the socket persist across re-renders
      // Only disconnect if role is null (handled at the start of useEffect)
    };
  }, [role]); // Only depend on role

  return socketRef.current;
}


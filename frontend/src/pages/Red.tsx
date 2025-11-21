import { useEffect, useState, useMemo, memo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../store/useGameStore';
import { scenariosApi, attacksApi, gameApi, activityApi, playersApi } from '../api/client';
import { Scenario, Attack, EventKind, Node, Link, Event, ScanResult } from '../api/types';
import { useWebSocket } from '../hooks/useWebSocket';
import { codesOn } from '../lib/flags';
import PewPewMap from '../components/PewPewMap';
import GameBanner from '../components/GameBanner';
import ScanToolSelector from '../components/ScanToolSelector';
import ScanResultsBoard from '../components/ScanResultsBoard';
import VulnerabilityIdentification from '../components/VulnerabilityIdentification';
import PivotStrategy from '../components/PivotStrategy';
import AttackSelection from '../components/AttackSelection';
import RedBriefing from '../components/RedBriefing';
import ScorePanel from '../components/ScorePanel';
import TeamChat from '../components/TeamChat';
import ActivityFeed from '../components/ActivityFeed';
import PresenceIndicator from '../components/PresenceIndicator';
import AttackConfirmModal from '../components/AttackConfirmModal';

// Memoized map component to prevent unnecessary re-renders
const MemoizedMap = memo(({ nodes, links, liveEvents }: { nodes: Node[]; links: Link[]; liveEvents: Event[] }) => {
  const memoizedNodes = useMemo(() => nodes, [JSON.stringify(nodes.map(n => n.id).sort())]);
  const memoizedLinks = useMemo(() => links, [JSON.stringify(links.map(l => `${l.from_id}-${l.to_id}`).sort())]);
  const memoizedEvents = useMemo(() => liveEvents, [liveEvents.length, liveEvents.map(e => e.id).join(',')]);
  
  return (
    <PewPewMap
      nodes={memoizedNodes}
      links={memoizedLinks}
      liveEvents={memoizedEvents}
    />
  );
});

MemoizedMap.displayName = 'MemoizedMap';

export default function Red() {
  const navigate = useNavigate();
  const { gameState, currentScenario, setCurrentScenario, setGameState, events, authToken, role, sessionId, playerName, setPlayerName } = useGameStore();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selectedAttack, setSelectedAttack] = useState<Attack | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [activeTab, setActiveTab] = useState<'reconnaissance' | 'artifacts' | 'attacks' | 'history'>('reconnaissance');
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [showBriefing, setShowBriefing] = useState(false);
  const [hasCheckedAuth, setHasCheckedAuth] = useState(false);
  const briefingShownRef = useRef<Set<string>>(new Set());
  const [hasSeenRunning, setHasSeenRunning] = useState(false); // Track if we've seen the game running
  const scanStateRef = useRef<{
    completed: boolean;
    success: boolean;
    tool: string | null;
  }>({ completed: false, success: false, tool: null }); // Stable reference for scan state

  // Define functions before they're used in useEffect hooks
  const loadScenarios = async () => {
    try {
      const data = await scenariosApi.list();
      setScenarios(data);
    } catch (error) {
      console.error('Failed to load scenarios:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadGameState = async () => {
    try {
      const state = await gameApi.getState();
      const { setGameState } = useGameStore.getState();
      setGameState(state);
      console.log('[Red] Loaded game state:', state);
      console.log('[Red] Scan results in loaded state:', state.red_scan_results?.length || 0, 'results');
      return state;
    } catch (error) {
      console.error('[Red] Failed to load game state:', error);
      return null;
    }
  };

  const loadScenario = async (id: string) => {
    try {
      console.log('Loading scenario:', id);
      const scenario = await scenariosApi.get(id);
      console.log('Scenario loaded:', scenario.id, 'Attacks:', scenario.attacks.length);
      setCurrentScenario(scenario);
    } catch (error) {
      console.error('Failed to load scenario:', error);
    }
  };

  // Track if we've had time to check authentication (prevents premature redirects)
  // This MUST be called before any early returns to ensure hooks are called in the same order
  useEffect(() => {
    // Give authentication check time to run
    const timer = setTimeout(() => {
      setHasCheckedAuth(true);
    }, 200);
    return () => clearTimeout(timer);
  }, []);

  // Check authentication immediately
  // If codes are enabled, require auth/session only if they used a code
  // If codes are disabled OR no code was used (lobby mode), allow access
  useEffect(() => {
    // Small delay to allow store to hydrate and role to be set
    const timer = setTimeout(() => {
      if (codesOn()) {
        // Codes enabled - check if player used a code (has authToken/sessionId)
        // If they have a code, require it; if not (lobby mode), allow access
        if (authToken && sessionId) {
          // Player used a code - verify it matches their role
          if (role && role !== 'red') {
            console.log('[Red] Role mismatch - redirecting to lobby. Role:', role, 'Expected: red');
            navigate('/', { replace: true });
            setIsAuthenticated(false);
            return;
          }
          // If role is null/undefined, wait a bit more for it to be set
          if (role === 'red') {
            setIsAuthenticated(true);
          } else if (role === null || role === undefined) {
            // Role not set yet, wait for it (don't redirect yet)
            console.log('[Red] Waiting for role to be set...');
            setIsAuthenticated(false);
          } else {
            // Role is set but not 'red' - redirect
            console.log('[Red] Invalid role - redirecting to lobby. Role:', role);
            navigate('/', { replace: true });
            setIsAuthenticated(false);
          }
        } else {
          // No code used - lobby mode, allow access if role is set to 'red'
          if (role === 'red') {
            setIsAuthenticated(true);
          } else if (role === null || role === undefined) {
            // Role not set yet, wait for it (don't redirect yet)
            console.log('[Red] Lobby mode - waiting for role to be set...');
            setIsAuthenticated(false);
          } else {
            // Role is set but not 'red' - this shouldn't happen in lobby mode, but don't redirect
            // Just wait for role to be corrected
            console.log('[Red] Lobby mode - role is:', role, 'waiting for it to be set to red');
            setIsAuthenticated(false);
          }
        }
      } else {
        // Codes disabled - legacy mode, allow access if role is set
        if (role === 'red') {
          setIsAuthenticated(true);
        } else if (role === null || role === undefined) {
          // Role not set yet, wait for it
          setIsAuthenticated(false);
        } else {
          // Role is set but not 'red' - don't allow access
          setIsAuthenticated(false);
        }
      }
    }, 100); // Small delay to allow store hydration
    
    return () => clearTimeout(timer);
  }, [authToken, sessionId, role, navigate]);

  useWebSocket('red');

  // Ensure player has a name assigned when joining Red team
  useEffect(() => {
    const ensurePlayerName = async () => {
      // Only assign name if we don't have one and we're authenticated as red team
      if (!playerName && role === 'red' && isAuthenticated) {
        try {
          console.log('[Red] No player name found, assigning one...');
          // In lobby mode, sessionId might be null - that's okay, backend will handle it
          const currentSessionId = sessionId || undefined;
          const nameResponse = await playersApi.assignName('red', currentSessionId);
          setPlayerName(nameResponse.player_name);
          console.log('[Red] Assigned name:', nameResponse.player_name);
        } catch (error: any) {
          console.error('[Red] Failed to assign name:', error);
          // Don't block the page if name assignment fails - user can still play
          // This can happen if team is full or session is invalid
        }
      }
    };
    
    // Only run this check after authentication is confirmed
    if (isAuthenticated) {
      ensurePlayerName();
    }
  }, [role, playerName, isAuthenticated, sessionId, setPlayerName]);

  // Load game state and scenarios on mount and when tab becomes visible
  // Only initialize after authentication is confirmed to prevent session conflicts
  useEffect(() => {
    if (!isAuthenticated && codesOn()) {
      // Wait for authentication before loading game state
      return;
    }
    
    const initialize = async () => {
      try {
        const state = await loadGameState();
        await loadScenarios();
        // If game is not running, we're done loading (no scenario to load)
        if (state && state.status !== 'running') {
          setLoading(false);
        }
        // If game is running, scenario loading will be handled by the scenario loading effect
      } catch (error) {
        console.error('[Red] Failed to initialize:', error);
        setLoading(false);
      }
    };
    
    // Initialize immediately
    initialize();
    
    // Also reload when tab becomes visible (user tabs back in)
    const handleVisibilityChange = () => {
      if (!document.hidden && (codesOn() ? isAuthenticated : true)) {
        console.log('[Red] Tab became visible, reloading game state...');
        initialize();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isAuthenticated]); // Only run when authentication status changes

  // Periodically refresh game state to ensure we have the latest status
  // This helps catch when the game starts even if WebSocket events are missed
  // Also reloads when tab becomes visible
  // Use refs to track previous values to avoid unnecessary updates
  const prevGameStatusRef = useRef<string | null>(null);
  const prevScenarioIdRef = useRef<string | null>(null);
  
  useEffect(() => {
    // Don't start periodic refresh until authenticated (if codes are enabled)
    if (codesOn() && !isAuthenticated) {
      return;
    }
    
    const refreshGameState = async () => {
      // Only refresh if tab is visible (to avoid unnecessary requests when tabbed out)
      if (document.hidden) {
        return;
      }
      
      try {
        const state = await loadGameState();
        if (!state) return;
        
        // Only update if status or scenario actually changed (prevent unnecessary re-renders)
        const statusChanged = state.status !== prevGameStatusRef.current;
        const scenarioChanged = state.current_scenario_id !== prevScenarioIdRef.current;
        
        if (statusChanged) {
          prevGameStatusRef.current = state.status;
        }
        if (scenarioChanged) {
          prevScenarioIdRef.current = state.current_scenario_id || null;
        }
        
        // Only load scenario if game is running and scenario changed
        if (state.status === 'running' && state.current_scenario_id && scenarioChanged && (!currentScenario || currentScenario.id !== state.current_scenario_id)) {
          loadScenario(state.current_scenario_id).catch(err => console.error('[Red] Failed to load scenario:', err));
        }
      } catch (err) {
        console.error('[Red] Failed to refresh game state:', err);
      }
    };
    
    // Initialize refs
    if (gameState) {
      prevGameStatusRef.current = gameState.status;
      prevScenarioIdRef.current = gameState.current_scenario_id || null;
    }
    
    // Initial refresh
    refreshGameState();
    
    // Refresh when tab becomes visible
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        console.log('[Red] Tab became visible, refreshing game state...');
        refreshGameState();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Periodic refresh every 10 seconds (reduced from 5 to minimize updates)
    const interval = setInterval(refreshGameState, 10000);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isAuthenticated]); // Only depend on isAuthenticated, not currentScenario

  // Load scenario when game state changes (only when game is running)
  // Don't load scenario if game is stopped/finished to prevent conflicts
  useEffect(() => {
    // Only load scenario if game is running and there's a scenario ID
    if (gameState?.status === 'running' && gameState?.current_scenario_id) {
      // Reload scenario if it changed or if we don't have one loaded
      if (!currentScenario || currentScenario.id !== gameState.current_scenario_id) {
        console.log('[Red] Scenario changed or not loaded:', {
          current: currentScenario?.id,
          new: gameState.current_scenario_id,
          status: gameState.status,
          round: gameState.round
        });
        // Clear scan state when scenario changes (new game)
        if (currentScenario && currentScenario.id !== gameState.current_scenario_id) {
          scanStateRef.current = { completed: false, success: false, tool: null };
          setScanResult(null);
        }
        loadScenario(gameState.current_scenario_id);
      }
    } else if (gameState && (gameState.status !== 'running' || !gameState.current_scenario_id)) {
      // Game is not running or scenario was cleared - clear local scenario
      if (currentScenario) {
        console.log('[Red] Game stopped or scenario cleared, clearing local scenario. Status:', gameState.status);
        setCurrentScenario(null);
        scanStateRef.current = { completed: false, success: false, tool: null };
        setScanResult(null);
      }
    }
    // Only depend on current_scenario_id and status, not currentScenario to avoid reload loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.current_scenario_id, gameState?.status, gameState?.round]);

  // Track if we've seen the game running to prevent flickering
  // Use refs to track previous values to avoid unnecessary state updates
  const prevStatusRef = useRef<string | null>(null);
  const prevRoundRef = useRef<number | null>(null);
  
  useEffect(() => {
    if (!gameState) return;
    
    const statusChanged = gameState.status !== prevStatusRef.current;
    const roundChanged = gameState.round !== prevRoundRef.current;
    
    // Update refs
    prevStatusRef.current = gameState.status;
    prevRoundRef.current = gameState.round;
    
    if (gameState.status === 'running') {
      if (!hasSeenRunning) {
        setHasSeenRunning(true);
      }
      // Reset scan state ref when a new round starts (round number changes)
      // This ensures scan state is cleared for new games
      if (roundChanged && gameState.round && gameState.round > 1) {
        // New round detected - reset scan state
        scanStateRef.current = { completed: false, success: false, tool: null };
      }
    } else if (statusChanged && (gameState.status === 'lobby' || gameState.status === 'finished')) {
      // Only reset hasSeenRunning when status actually changes to lobby/finished
      // This prevents flickering from temporary state updates
      setHasSeenRunning(false);
      scanStateRef.current = { completed: false, success: false, tool: null };
    }
  }, [gameState?.status, gameState?.round, hasSeenRunning]);

  // Release name when component unmounts or player navigates away
  useEffect(() => {
    return () => {
      // Cleanup: release name when leaving the page
      if (playerName && role === 'red') {
        playersApi.releaseName(playerName, 'red', sessionId || undefined)
          .catch(error => {
            console.error('[Red] Failed to release name on unmount:', error);
          });
        // Clear player name from store
        setPlayerName('');
      }
    };
  }, [playerName, role, sessionId, setPlayerName]);

  // Stabilize scan state to prevent flickering
  // This ref maintains stable values even when gameState temporarily updates
  // CRITICAL: Only update ref when we have valid scan data - don't reset to false/null
  useEffect(() => {
    if (gameState) {
      // Only update from gameState when it has valid, non-reset values
      // This prevents the ref from being reset when gameState temporarily doesn't have scan data
      let updated = false;
      
      // Only update completed if it's explicitly true (don't reset to false)
      if (gameState.red_scan_completed === true && !scanStateRef.current.completed) {
        scanStateRef.current.completed = true;
        updated = true;
      }
      
      // Only update success if it's explicitly true (don't reset to false)
      if (gameState.red_scan_success === true && !scanStateRef.current.success) {
        scanStateRef.current.success = true;
        updated = true;
      }
      
      // Only update tool if it's a valid non-null value (don't reset to null)
      if (gameState.red_scan_tool && gameState.red_scan_tool !== null && scanStateRef.current.tool !== gameState.red_scan_tool) {
        scanStateRef.current.tool = gameState.red_scan_tool;
        updated = true;
      }
      
      // Only reset scan state if game is explicitly reset (status changes to lobby/finished)
      // This allows the scan state to persist even if gameState temporarily doesn't have scan data
      if (gameState.status === 'lobby' || gameState.status === 'finished') {
        // Game was reset - clear scan state
        if (scanStateRef.current.completed || scanStateRef.current.success || scanStateRef.current.tool) {
          scanStateRef.current.completed = false;
          scanStateRef.current.success = false;
          scanStateRef.current.tool = null;
          updated = true;
        }
      }
      
      if (updated) {
        console.log('[Red] Scan state ref updated:', {
          completed: scanStateRef.current.completed,
          success: scanStateRef.current.success,
          tool: scanStateRef.current.tool,
          reason: gameState.status === 'lobby' || gameState.status === 'finished' ? 'game reset' : 'scan data update',
        });
      }
    }
  }, [gameState?.red_scan_completed, gameState?.red_scan_success, gameState?.red_scan_tool, gameState?.status]);

  // Show briefing when scenario loads and game is running
  useEffect(() => {
    if (
      gameState?.status === 'running' &&
      currentScenario?.id &&
      currentScenario.red_briefing &&
      !briefingShownRef.current.has(currentScenario.id)
    ) {
      setShowBriefing(true);
      briefingShownRef.current.add(currentScenario.id);
    }
  }, [gameState?.status, currentScenario]);

  // Reload game state when scan completes to get updated scan status
  const handleScanComplete = async (result: ScanResult) => {
    setScanResult(result);
    // Update scan state ref immediately with scan result
    scanStateRef.current.completed = true;
    scanStateRef.current.success = result.success;
    scanStateRef.current.tool = result.tool;
    
    // Reload game state to get updated scan status from backend (including all scan results)
    try {
      const updatedState = await gameApi.getState();
      const store = useGameStore.getState();
      store.setGameState(updatedState);
      
      // Ensure scan state ref is updated with the latest from backend
      if (updatedState.red_scan_completed !== undefined) {
        scanStateRef.current.completed = updatedState.red_scan_completed;
      }
      if (updatedState.red_scan_success !== undefined) {
        scanStateRef.current.success = updatedState.red_scan_success;
      }
      if (updatedState.red_scan_tool !== undefined) {
        scanStateRef.current.tool = updatedState.red_scan_tool;
      }
      
      console.log('[Red] Scan completed, updated gameState and scanStateRef:', {
        completed: scanStateRef.current.completed,
        success: scanStateRef.current.success,
        tool: scanStateRef.current.tool,
        total_scan_results: updatedState.red_scan_results?.length || 0,
      });
    } catch (error) {
      console.error('Failed to reload game state after scan:', error);
    }
  };

  if (codesOn() && hasCheckedAuth && !isAuthenticated) {
    // Show loading state instead of returning null to prevent unmounting
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-xl mb-4">Loading...</div>
        </div>
      </div>
    );
  }

  // Show briefing overlay
  if (showBriefing && currentScenario?.red_briefing) {
    return (
      <RedBriefing
        briefing={currentScenario.red_briefing}
        onDismiss={() => setShowBriefing(false)}
      />
    );
  }

  const handleLaunchClick = () => {
    if (!selectedAttack) return;
    setShowConfirmModal(true);
  };

  const handleConfirmLaunch = async () => {
    if (!selectedAttack || !currentScenario) return;

    setIsLaunching(true);
    setShowConfirmModal(false);

    // Refresh game state to ensure we have the latest turn information
    try {
      const latestState = await gameApi.getState();
      useGameStore.getState().setGameState(latestState);
      
      // Use the latest state for validation
      const currentState = latestState;
      
      // Check game state before attempting launch
      if (!currentState || currentState.status !== 'running') {
        alert('Game is not running. Please wait for the Game Manager to start the game.');
        setIsLaunching(false);
        return;
      }

      // Check if it's Red team's turn
      if (currentState.current_turn !== 'red') {
        alert(`It's not Red team's turn. Current turn: ${currentState.current_turn || 'unknown'}. Please wait for your turn.`);
        setIsLaunching(false);
        return;
      }

      if (currentState.current_scenario_id !== currentScenario.id) {
        alert(`Scenario mismatch. Current scenario: ${currentState.current_scenario_id}, Expected: ${currentScenario.id}`);
        setIsLaunching(false);
        return;
      }

      // Check if scan is required and completed
      if (selectedAttack.requires_scan) {
        // Use gameState (persists across turns)
        const scanCompleted = currentState.red_scan_completed || false;
        const scanResults = currentState.red_scan_results || [];
        const normalizedRequiredTool = selectedAttack.required_scan_tool ? String(selectedAttack.required_scan_tool) : null;
        const hasMatchingScan = normalizedRequiredTool
          ? scanResults.some(scan => String(scan.tool) === normalizedRequiredTool)
          : true;
        
        if (!scanCompleted || scanResults.length === 0) {
          alert('This attack requires a successful reconnaissance scan first. Please complete the scan in the Reconnaissance tab.');
          setIsLaunching(false);
          return;
        }
        // Check if the correct scan tool was used
        if (normalizedRequiredTool && !hasMatchingScan) {
          alert(`This attack requires a ${selectedAttack.required_scan_tool} scan. Please run the correct scan tool first.`);
          setIsLaunching(false);
          return;
        }
      }

      try {
      // Track activity: preparing to launch attack
      if (playerName) {
        try {
          await activityApi.track({
            player_name: playerName,
            role: 'red',
            activity_type: 'preparing_attack',
            description: `Preparing to launch ${selectedAttack.attack_type} attack`,
            metadata: { attack_id: selectedAttack.id, attack_type: selectedAttack.attack_type },
          });
        } catch (err) {
          console.error('[Red] Failed to track activity:', err);
        }
      }
      
      console.log('Launching attack:', {
        attack_id: selectedAttack.id,
        from_node: selectedAttack.from_node,
        to_node: selectedAttack.to_node,
        current_scenario: currentScenario.id,
        game_state_scenario: currentState?.current_scenario_id,
        game_status: currentState?.status,
        current_turn: currentState?.current_turn,
      });
      
      const result = await attacksApi.launch({
        attack_id: selectedAttack.id,
        from_node: selectedAttack.from_node,
        to_node: selectedAttack.to_node,
        player_name: playerName || undefined,
      });
      
      // Manually add attack event and alerts to store since WebSocket might not be working
      const { addEvent, addAlert } = useGameStore.getState();
      
      // If alerts are included in the response, add them manually
      if (result.alerts && Array.isArray(result.alerts)) {
        console.log('Adding alerts from API response:', result.alerts.length);
        result.alerts.forEach((alert: any) => {
          // Ensure timestamp is a Date object
          if (typeof alert.timestamp === 'string') {
            alert.timestamp = new Date(alert.timestamp);
          }
          addAlert(alert);
        });
      }
      // Use string literals to avoid import issues
      const attackLaunchedKind = EventKind?.ATTACK_LAUNCHED || 'attack_launched';
      const attackResolvedKind = EventKind?.ATTACK_RESOLVED || 'attack_resolved';
      
      addEvent({
        id: `manual-${Date.now()}`,
        kind: attackLaunchedKind,
        ts: new Date().toISOString(),
        payload: {
          attack_id: selectedAttack.id,
          attack_type: selectedAttack.attack_type,
          from: selectedAttack.from_node,
          to: selectedAttack.to_node,
        },
      });
      
      // Add resolved event too (only if result is not pending)
      // For misses, the result is immediate and final (preliminary: false)
      // For correct attacks, result is pending (no resolved event yet)
      if (result.result && result.result !== 'pending') {
        addEvent({
          id: `manual-resolved-${Date.now()}`,
          kind: attackResolvedKind,
          ts: new Date().toISOString(),
          payload: {
            attack_id: selectedAttack.id,
            result: result.result,
            preliminary: result.result === 'miss' ? false : true, // Misses are final, others are preliminary
          },
        });
      }
      
      setSelectedAttack(null);
      
      // Refresh game state after successful attack launch to get updated turn
      try {
        const refreshedState = await gameApi.getState();
        useGameStore.getState().setGameState(refreshedState);
      } catch (refreshError) {
        console.error('Failed to refresh game state after attack:', refreshError);
      }
      
      alert(`Attack launched! Result: ${result.result}\nAlerts generated: ${result.alerts_count}`);
      setIsLaunching(false);
      } catch (error: any) {
        console.error('Failed to launch attack:', error);
        const message = error.response?.data?.detail || error.message || 'Failed to launch attack';
        
        // If the error is about turn, refresh game state to show correct turn
      if (error.response?.status === 403 && message.includes('turn')) {
        try {
          const refreshedState = await gameApi.getState();
          useGameStore.getState().setGameState(refreshedState);
        } catch (refreshError) {
          console.error('Failed to refresh game state:', refreshError);
        }
      }
      
      alert(`Failed to launch attack: ${message}`);
      setIsLaunching(false);
      }
    } catch (stateError: any) {
      console.error('Failed to refresh game state:', stateError);
      alert('Failed to refresh game state. Please try again.');
      setIsLaunching(false);
    }
  };

  const handleCancelLaunch = () => {
    setShowConfirmModal(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <div>Loading...</div>
      </div>
    );
  }

  // Only show waiting screen if we've never seen the game running AND game is not currently running
  // This prevents flickering when gameState temporarily updates
  // Use a more stable check: only show waiting if we've never seen running AND gameState exists but is not running
  const shouldShowWaiting = !hasSeenRunning && gameState && gameState.status !== 'running';
  
  if (shouldShowWaiting) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <div className="text-center max-w-md">
          <h1 className="text-3xl font-bold mb-4 text-red-400">Red Team Operations</h1>
          <div className="text-xl mb-4">Waiting for game to start...</div>
          <div className="text-sm text-slate-400 mb-6">
            The Game Manager needs to select a scenario and start the game before you can join.
            {gameState && (
              <div className="mt-2 text-xs space-y-1">
                <div>Current status: {gameState.status || 'unknown'}</div>
                {gameState.current_scenario_id && (
                  <div>Scenario ID: {gameState.current_scenario_id}</div>
                )}
                {currentScenario && (
                  <div className="mt-2 pt-2 border-t border-slate-700">
                    <div className="text-red-300 font-semibold">{currentScenario.name}</div>
                    {currentScenario.description && (
                      <div className="text-xs text-slate-500 mt-1">{currentScenario.description}</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex gap-3 justify-center">
            <button
              onClick={async () => {
                console.log('[Red] Manually refreshing game state...');
                try {
                  const state = await gameApi.getState();
                  console.log('[Red] Refreshed game state:', state);
                  setGameState(state);
                  // Load scenario if there's a scenario ID (regardless of game status)
                  if (state.current_scenario_id && (!currentScenario || currentScenario.id !== state.current_scenario_id)) {
                    await loadScenario(state.current_scenario_id);
                  }
                } catch (error) {
                  console.error('[Red] Failed to refresh game state:', error);
                  alert('Failed to refresh game state. Please try again.');
                }
              }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg"
            >
              Refresh Status
            </button>
            <button
              onClick={() => navigate('/')}
              className="px-4 py-2 bg-slate-600 hover:bg-slate-700 rounded-lg"
            >
              Back to Lobby
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Don't show "game ended" screen if we've already seen it running - keep the UI visible
  // This prevents flickering when gameState.status changes
  // Only show ended screen if we've never seen it running (shouldn't happen, but safety check)
  if (!hasSeenRunning && gameState && gameState.status !== 'running' && gameState.status !== 'paused') {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-xl mb-4">Game has ended or is paused</div>
          <div className="text-sm text-slate-400 mb-4">Status: {gameState.status}</div>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg"
          >
            Back to Lobby
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Game Banner */}
      <GameBanner />
      
      <div className="container mx-auto px-4 sm:px-6 py-6 max-w-7xl">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div className="flex items-center gap-4 min-w-0 flex-1">
            <h1 className="text-2xl sm:text-3xl font-bold text-red-400 truncate">Red Team Operations</h1>
          </div>
          <div className="flex items-center gap-4 flex-shrink-0">
            <button
              onClick={() => navigate('/')}
              className="px-3 sm:px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm sm:text-base whitespace-nowrap"
            >
              Back to Lobby
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Map */}
            <div className="bg-slate-800 rounded-2xl p-6">
              <h2 className="text-xl font-semibold mb-4">Attack Map</h2>
              <div className="h-96">
                {currentScenario ? (
                  <MemoizedMap
                    nodes={currentScenario.topology.nodes}
                    links={currentScenario.topology.links}
                    liveEvents={events}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-slate-400">
                    No scenario loaded
                  </div>
                )}
              </div>
            </div>

            {/* Tabs */}
            <div className="bg-slate-800 rounded-2xl p-6">
              <div className="flex gap-2 sm:gap-4 mb-4 border-b border-slate-700 overflow-x-auto">
                {(['reconnaissance', 'artifacts', 'attacks', 'history'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`pb-2 px-2 sm:px-4 font-semibold capitalize text-sm sm:text-base whitespace-nowrap flex-shrink-0 ${
                      activeTab === tab
                        ? 'border-b-2 border-red-500 text-red-400'
                        : 'text-slate-400 hover:text-slate-300'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {/* Reconnaissance Tab */}
              {activeTab === 'reconnaissance' && (
                <div className="space-y-6">
                  {/* Scan Tool Selector */}
                  {currentScenario ? (
                    <ScanToolSelector
                      scenarioId={currentScenario.id}
                      targetNode="web-1"
                      scenario={currentScenario}
                      onScanComplete={handleScanComplete}
                      disabled={gameState?.current_turn !== 'red' || gameState?.status !== 'running'}
                      playerName={playerName}
                    />
                  ) : (
                    <div className="text-slate-400 text-center py-8">No scenario loaded</div>
                  )}

                  {/* Intel Board - Show all scan results */}
                  {(() => {
                    const hasScanResults = gameState?.red_scan_results && gameState.red_scan_results.length > 0;
                    if (hasScanResults) {
                      console.log('[Red] Rendering Intel Board with', gameState.red_scan_results.length, 'scan results');
                    } else {
                      console.log('[Red] No scan results to display. red_scan_results:', gameState?.red_scan_results);
                    }
                    return hasScanResults ? (
                      <ScanResultsBoard scanResults={gameState.red_scan_results} />
                    ) : null;
                  })()}

                  {/* Vulnerability Identification Voting */}
                  {gameState?.red_scan_results && gameState.red_scan_results.length > 0 && (
                    <VulnerabilityIdentification
                      scanResults={gameState.red_scan_results}
                      votes={gameState.red_vulnerability_votes || {}}
                      vulnerabilityIdentified={gameState.red_vulnerability_identified || false}
                    />
                  )}

                  {/* Pivot Strategy Selection (Turn 4) */}
                  <PivotStrategy
                    votes={gameState.red_pivot_votes || {}}
                    strategySelected={gameState.red_pivot_strategy_selected || false}
                  />

                  {/* Legacy scan status message (keep for backward compatibility) */}
                  {gameState?.red_scan_completed && (!gameState?.red_scan_results || gameState.red_scan_results.length === 0) && (
                    <div className={`mt-4 p-4 rounded-lg border-2 ${
                      gameState.red_scan_success
                        ? 'border-green-500 bg-green-900/20'
                        : 'border-yellow-500 bg-yellow-900/20'
                    }`}>
                      <div className="font-semibold mb-2">
                        {gameState.red_scan_success ? '✅ Scan Successful!' : '⚠️ Scan Complete'}
                      </div>
                      <div className="text-sm text-slate-300">
                        {gameState.red_scan_success
                          ? 'Vulnerability identified. You can now proceed to launch attacks.'
                          : 'Scan completed, but no critical vulnerabilities identified. You may still attempt attacks.'}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Artifacts Tab */}
              {activeTab === 'artifacts' && (
                <div className="space-y-4">
                  {!gameState?.red_scan_completed ? (
                    <div className="text-slate-400 text-center py-8">
                      <div className="text-lg font-semibold mb-2">No artifacts available</div>
                      <div className="text-sm">Complete a reconnaissance scan to reveal artifacts.</div>
                    </div>
                  ) : currentScenario && gameState?.red_scan_tool ? (
                    // Show scan results based on the tool used
                    (() => {
                      const scanTool = gameState.red_scan_tool;
                      const scanArtifacts = currentScenario.scan_artifacts?.[scanTool] || {};
                      
                      if (Object.keys(scanArtifacts).length === 0) {
                        return (
                          <div className="text-slate-400 text-center py-8">
                            <div className="text-lg font-semibold mb-2">No scan results available</div>
                            <div className="text-sm">Scan completed but no artifacts were revealed.</div>
                          </div>
                        );
                      }
                      
                      return Object.entries(scanArtifacts).map(([key, value]) => (
                        <div key={key} className="bg-slate-700 rounded-lg p-4">
                          <div className="font-semibold mb-2 uppercase">{key.replace(/_/g, ' ')}</div>
                          <pre className="text-sm text-slate-300 whitespace-pre-wrap font-mono">
                            {String(value)}
                          </pre>
                        </div>
                      ));
                    })()
                  ) : (
                    <div className="text-slate-400 text-center py-8">No scan results available</div>
                  )}
                </div>
              )}

              {/* Attacks Tab */}
              {activeTab === 'attacks' && (
                <div className="space-y-4">
                  {/* Attack Selection Voting (Turn 3) */}
                  {gameState?.current_turn === 'red' && (gameState?.red_turn_count || 0) === 1 && currentScenario?.attacks && (
                    <AttackSelection
                      attacks={currentScenario.attacks}
                      votes={gameState.red_attack_votes || {}}
                      attackSelected={gameState.red_attack_selected || false}
                    />
                  )}

                  {currentScenario ? (
                    currentScenario.attacks && currentScenario.attacks.length > 0 ? (
                    currentScenario.attacks.map((attack) => {
                      const requiresScan = attack.requires_scan || false;
                      
                      // Check scan state from gameState (persists across turns)
                      const scanCompleted = gameState?.red_scan_completed || false;
                      const scanResults = gameState?.red_scan_results || [];
                      
                      // Check if any scan result matches the required scan tool
                      const normalizedRequiredTool = attack.required_scan_tool ? String(attack.required_scan_tool) : null;
                      const hasMatchingScan = normalizedRequiredTool
                        ? scanResults.some(scan => String(scan.tool) === normalizedRequiredTool)
                        : true; // No specific tool required
                      
                      const scanRequired = requiresScan && (
                        !scanCompleted || 
                        scanResults.length === 0 ||
                        !hasMatchingScan
                      );
                      
                      // Attacks that don't require scans should be available even without a scan
                      // Attacks that require scans need scan completion with matching tool
                      let canLaunch = requiresScan 
                        ? (!scanRequired && scanCompleted && hasMatchingScan)
                        : true; // No scan required, so always available
                      
                      // In Turn 3, require voting before launching
                      const redTurnCount = gameState?.red_turn_count || 0;
                      const attackSelected = gameState?.red_attack_selected || false;
                      const attackVotes = gameState?.red_attack_votes || {};
                      
                      // Determine majority attack ID
                      const voteCounts: Record<string, number> = {};
                      Object.values(attackVotes).forEach((attackId) => {
                        voteCounts[String(attackId)] = (voteCounts[String(attackId)] || 0) + 1;
                      });
                      const majorityAttackId = Object.entries(voteCounts).find(
                        ([_, count]) => count > (Object.keys(attackVotes).length / 2)
                      )?.[0];
                      
                      // In Turn 3, only allow launching if:
                      // 1. Attack has been selected via voting (majority reached)
                      // 2. This attack matches the majority vote
                      if (redTurnCount === 1) {
                        if (!attackSelected) {
                          canLaunch = false; // Must vote first
                        } else if (majorityAttackId && attack.id !== majorityAttackId) {
                          canLaunch = false; // Can only launch the majority-selected attack
                        }
                      }
                      
                      const votingRequired = redTurnCount === 1 && !attackSelected;
                      const notMajorityAttack = redTurnCount === 1 && attackSelected && majorityAttackId && attack.id !== majorityAttackId;
                      
                      return (
                        <div
                          key={attack.id}
                          className={`p-4 rounded-lg border-2 transition-colors ${
                            selectedAttack?.id === attack.id
                              ? 'border-red-500 bg-red-900/20'
                              : scanRequired || votingRequired || notMajorityAttack
                              ? 'border-slate-700 bg-slate-800 opacity-60 cursor-not-allowed'
                              : 'border-slate-600 bg-slate-700 hover:border-slate-500 cursor-pointer'
                          }`}
                          onClick={() => {
                            if (!scanRequired && canLaunch && !votingRequired && !notMajorityAttack) {
                              setSelectedAttack(attack);
                              setShowConfirmModal(true);
                            }
                          }}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                            <div className="font-semibold truncate flex-1 min-w-0">
                              {attack.effects?.impact 
                                ? attack.effects.impact.split('.')[0]  // Show first sentence of impact
                                : attack.attack_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                            </div>
                            {scanRequired && (
                              <span className="text-xs px-2 py-1 bg-yellow-900/50 text-yellow-300 rounded flex-shrink-0">
                                Scan Required
                              </span>
                            )}
                            {votingRequired && (
                              <span className="text-xs px-2 py-1 bg-blue-900/50 text-blue-300 rounded flex-shrink-0">
                                Vote Required
                              </span>
                            )}
                            {notMajorityAttack && (
                              <span className="text-xs px-2 py-1 bg-slate-900/50 text-slate-300 rounded flex-shrink-0">
                                Not Selected
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-slate-400 break-words">
                            {attack.from_node} → {attack.to_node}
                          </div>
                          {attack.effects?.impact && (
                            <div className="text-xs text-slate-500 mt-2 break-words">
                              {attack.effects.impact}
                            </div>
                          )}
                          {attack.preconditions.length > 0 && (
                            <div className="text-xs text-slate-500 mt-2 break-words">
                              Preconditions: {attack.preconditions.join(', ')}
                            </div>
                          )}
                          {scanRequired && (
                            <div className="text-xs text-yellow-400 mt-2">
                              ⚠️ Requires successful reconnaissance scan first
                            </div>
                          )}
                          {votingRequired && (
                            <div className="text-xs text-blue-400 mt-2">
                              ⚠️ Team must vote on attack selection first
                            </div>
                          )}
                          {notMajorityAttack && (
                            <div className="text-xs text-slate-400 mt-2">
                              Team selected a different attack
                            </div>
                          )}
                        </div>
                      );
                    })
                    ) : (
                      <div className="text-slate-400 text-center py-8">
                        No attacks available for this scenario
                        {currentScenario.id && ` (${currentScenario.id})`}
                      </div>
                    )
                  ) : (
                    <div className="text-slate-400 text-center py-8">No scenario loaded</div>
                  )}
                </div>
              )}

                    {/* History Tab */}
                    {activeTab === 'history' && (
                      <div className="space-y-2">
                        {events
                          .filter(
                            (e) =>
                              e.kind === EventKind?.ATTACK_LAUNCHED ||
                              e.kind === 'attack_launched' ||
                              e.kind === EventKind?.ATTACK_RESOLVED ||
                              e.kind === 'attack_resolved' ||
                              e.kind === EventKind?.ACTION_TAKEN ||
                              e.kind === 'action_taken'
                          )
                          .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
                          .map((event) => {
                            // Handle action_taken events (Blue team responses)
                            if (event.kind === 'action_taken' || event.kind === EventKind?.ACTION_TAKEN) {
                              const actionType = event.payload.type?.replace(/_/g, ' ') || 'Unknown';
                              const target = event.payload.target || 'Unknown';
                              const note = event.payload.note || '';
                              
                              return (
                                <div
                                  key={event.id}
                                  className="rounded-lg p-4 border-2 bg-blue-900/20 border-blue-500 ml-8"
                                >
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                      </svg>
                                      <div className="font-semibold text-blue-300 capitalize">
                                        Blue Team Response: {actionType}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="text-sm text-blue-200 mt-1">
                                    Target: {target}
                                  </div>
                                  {note && (
                                    <div className="text-xs text-blue-300 mt-1 italic">
                                      Note: {note}
                                    </div>
                                  )}
                                  <div className="text-xs text-slate-400 mt-1">
                                    {new Date(event.ts).toLocaleString()}
                                  </div>
                                </div>
                              );
                            }
                            
                            // Handle attack events
                            const isResolved = event.kind === 'attack_resolved' || event.kind === EventKind?.ATTACK_RESOLVED;
                            const result = event.payload.result;
                            const isBlocked = result === 'blocked';
                            const isPreliminary = event.payload.preliminary === true;
                            
                            return (
                              <div
                                key={event.id}
                                className={`rounded-lg p-4 border-2 ${
                                  isResolved && !isPreliminary
                                    ? isBlocked
                                      ? 'bg-red-900/30 border-red-500'
                                      : result === 'detected'
                                      ? 'bg-yellow-900/30 border-yellow-500'
                                      : 'bg-green-900/30 border-green-500'
                                    : 'bg-slate-700 border-slate-600'
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="font-semibold capitalize">
                                    {event.kind.replace(/_/g, ' ')}
                                    {isPreliminary && (
                                      <span className="ml-2 text-xs text-slate-400">(Preliminary)</span>
                                    )}
                                    {isResolved && !isPreliminary && (
                                      <span className="ml-2 text-xs text-red-300">(Final)</span>
                                    )}
                                  </div>
                                  {event.payload.result && (
                                    <span
                                      className={`px-2 py-1 rounded text-xs font-semibold ${
                                        event.payload.result === 'hit'
                                          ? 'bg-red-600 text-white'
                                          : event.payload.result === 'blocked'
                                          ? 'bg-green-600 text-white'
                                          : 'bg-yellow-600 text-white'
                                      }`}
                                    >
                                      {event.payload.result.toUpperCase()}
                                    </span>
                                  )}
                                </div>
                                <div className="text-sm text-slate-400 mt-1">
                                  {new Date(event.ts).toLocaleString()}
                                </div>
                                {event.payload.attack_id && (
                                  <div className="text-xs text-slate-500 mt-1">
                                    Attack ID: {event.payload.attack_id}
                                  </div>
                                )}
                                {event.payload.attack_type && (
                                  <div className="text-xs text-slate-500">
                                    Type: {event.payload.attack_type}
                                  </div>
                                )}
                                {event.payload.from && event.payload.to && (
                                  <div className="text-xs text-slate-500">
                                    Path: {event.payload.from} → {event.payload.to}
                                  </div>
                                )}
                                {isResolved && !isPreliminary && event.payload.blue_actions_count !== undefined && (
                                  <div className="text-xs text-blue-300 mt-2 pt-2 border-t border-slate-600">
                                    <div className="font-semibold mb-1">Blue Team responded with {event.payload.blue_actions_count} action(s)</div>
                                    {event.payload.blue_actions && Array.isArray(event.payload.blue_actions) && event.payload.blue_actions.length > 0 && (
                                      <div className="ml-2 mt-1 space-y-1">
                                        {event.payload.blue_actions.map((action: any, idx: number) => (
                                          <div key={idx} className="text-xs">
                                            • {action.type?.replace(/_/g, ' ')} → {action.target}
                                            {action.note && (
                                              <span className="text-slate-400 italic"> - {action.note}</span>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                                
                                {/* Show Blue team actions that occurred after this attack */}
                                {isResolved && !isPreliminary && (() => {
                                  const attackId = event.payload.attack_id;
                                  const attackTime = new Date(event.ts).getTime();
                                  const blueResponses = events
                                    .filter(e => 
                                      (e.kind === 'action_taken' || e.kind === EventKind?.ACTION_TAKEN) &&
                                      new Date(e.ts).getTime() > attackTime &&
                                      new Date(e.ts).getTime() < attackTime + 300000 // Within 5 minutes
                                    )
                                    .slice(0, 5); // Limit to 5 most recent
                                  
                                  if (blueResponses.length > 0) {
                                    return (
                                      <div className="text-xs text-blue-300 mt-2 pt-2 border-t border-slate-600">
                                        <div className="font-semibold mb-1">Blue Team Actions:</div>
                                        {blueResponses.map((response) => (
                                          <div key={response.id} className="ml-2 text-xs">
                                            • {response.payload.type?.replace(/_/g, ' ')} → {response.payload.target}
                                            {response.payload.note && (
                                              <span className="text-slate-400 italic"> - {response.payload.note}</span>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    );
                                  }
                                  return null;
                                })()}
                                {isResolved && !isPreliminary && event.payload.score_deltas && (
                                  <div className="text-xs mt-1 pt-1">
                                    <span className="text-red-400">
                                      Red: +{event.payload.score_deltas.red || 0}
                                    </span>{' '}
                                    <span className="text-blue-400">
                                      Blue: +{event.payload.score_deltas.blue || 0}
                                    </span>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        {events.filter((e) => e.kind === EventKind?.ATTACK_LAUNCHED || e.kind === 'attack_launched').length === 0 && (
                          <div className="text-slate-400 text-center py-8">No attack history</div>
                        )}
                      </div>
                    )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <PresenceIndicator role="red" />
            <ScorePanel />
            <ActivityFeed role="red" />
            <TeamChat role="red" />
          </div>
        </div>
      </div>

      {/* Attack Confirmation Modal */}
      <AttackConfirmModal
        attack={selectedAttack}
        isOpen={showConfirmModal}
        onConfirm={handleConfirmLaunch}
        onCancel={handleCancelLaunch}
        disabled={isLaunching || gameState?.current_turn !== 'red'}
      />
    </div>
  );
}


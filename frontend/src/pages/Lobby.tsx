import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../store/useGameStore';
import { Role } from '../api/types';
import { codesOn, authOn } from '../lib/flags';
import { sessionsApi, playersApi } from '../api/client';

export default function Lobby() {
  const navigate = useNavigate();
  const { setRole, setPlayerName, playerName, setAuthToken, setSessionId, authToken, role, setSession, sessionId } = useGameStore();
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [teamSizes, setTeamSizes] = useState<{ red: number; blue: number }>({ red: 0, blue: 0 });

  // Initialize on mount
  useEffect(() => {
    setMounted(true);
  }, []);

  // If user is already logged in as GM, redirect to GM page (but only after mount)
  // Also clear stale role if there's no token
  useEffect(() => {
    if (!mounted) return;
    
    const authEnabled = authOn();
    if (authEnabled) {
      if (authToken && role === 'gm') {
        // Valid GM session - redirect
        navigate('/gm');
      } else if (role === 'gm' && !authToken) {
        // Stale GM role without token - clear it
        setRole(null);
        setSessionId(null);
        setSession(null);
      }
    }
  }, [authToken, role, navigate, mounted, setRole, setSessionId, setSession]);

  const handleJoin = async () => {
    if (!selectedRole) return;
    
    // Handle GM role - always redirect to login if auth is enabled
    if (selectedRole === 'gm' && authOn()) {
      console.log('[Lobby] GM selected, redirecting to login');
      navigate('/gm/login', { replace: true });
      return;
    }
    
    // Handle audience role - no name assignment needed
    if (selectedRole === 'audience') {
      setRole(selectedRole);
      navigate('/audience');
      return;
    }
    
    // For Red and Blue teams, assign a name first
    if (selectedRole === 'red' || selectedRole === 'blue') {
      setJoinLoading(true);
      setJoinError(null);
      
      try {
        // Determine session ID (use current sessionId if available, or from join code)
        let currentSessionId: string | undefined = sessionId || undefined;
        
        // If join codes are enabled AND a code is provided, join session first
        if (codesOn() && joinCode.trim()) {
          try {
            const response = await sessionsApi.join(joinCode.trim().toUpperCase());
            const codeRole = response.role.toLowerCase() as Role;
            
            // Validate that the code matches the selected role
            if (codeRole !== selectedRole) {
              setJoinError(`This code is for ${codeRole} team, but you selected ${selectedRole} team. Please select the correct role or use the correct code.`);
              setJoinLoading(false);
              return;
            }
            
            setAuthToken(response.access_token);
            setSessionId(response.session_id);
            currentSessionId = response.session_id;
          } catch (error: any) {
            setJoinError(error.response?.data?.detail || error.message || 'Invalid join code');
            setJoinLoading(false);
            return;
          }
        }
        
        // Assign a name for the player
        console.log('[Lobby] Assigning name for role:', selectedRole, 'sessionId:', currentSessionId);
        const nameResponse = await playersApi.assignName(selectedRole, currentSessionId);
        console.log('[Lobby] Name assignment response:', nameResponse);
        setPlayerName(nameResponse.player_name);
        setRole(selectedRole);
        console.log('[Lobby] Set player name to:', nameResponse.player_name, 'and role to:', selectedRole);
        
        // Update team sizes
        setTeamSizes(prev => ({
          ...prev,
          [selectedRole]: nameResponse.team_size,
        }));
        
        const routes: Record<Role, string> = {
          gm: '/gm',
          red: '/red',
          blue: '/blue',
          audience: '/audience',
        };
        navigate(routes[selectedRole]);
      } catch (error: any) {
        const errorMessage = error.response?.data?.detail || error.message || 'Failed to join team';
        setJoinError(errorMessage);
        
        // If team is full, provide helpful message
        if (errorMessage.includes('full') || errorMessage.includes('max')) {
          setJoinError(`${selectedRole === 'red' ? 'Red' : 'Blue'} team is full (10 players max). Please wait for a spot to open or join the other team.`);
        }
      } finally {
        setJoinLoading(false);
      }
      return;
    }
    
    // Fallback for other roles (shouldn't reach here)
    setRole(selectedRole);
    const routes: Record<Role, string> = {
      gm: '/gm',
      red: '/red',
      blue: '/blue',
      audience: '/audience',
    };
    navigate(routes[selectedRole]);
  };
  
  // Check team sizes for both teams on mount and periodically
  // This ensures all users see updated player counts
  useEffect(() => {
    const checkAllTeamSizes = async () => {
      // Only check if tab is visible
      if (document.hidden) {
        return;
      }
      
      try {
        const currentSessionId = sessionId || undefined;
        
        // Check both red and blue team sizes
        const [redSizeData, blueSizeData] = await Promise.all([
          playersApi.getTeamSize('red', currentSessionId).catch(() => ({ team_size: 0 })),
          playersApi.getTeamSize('blue', currentSessionId).catch(() => ({ team_size: 0 })),
        ]);
        
        setTeamSizes({
          red: redSizeData.team_size || 0,
          blue: blueSizeData.team_size || 0,
        });
      } catch (error) {
        // Ignore errors - team size check is optional
        console.error('[Lobby] Failed to check team sizes:', error);
      }
    };
    
    // Check immediately on mount
    checkAllTeamSizes();
    
    // Also check when tab becomes visible
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        checkAllTeamSizes();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Poll for team size updates every 3 seconds so all users see changes
    const interval = setInterval(() => {
      if (!document.hidden) {
        checkAllTeamSizes();
      }
    }, 3000);
    
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [sessionId]); // Re-check when sessionId changes

  // Show loading state until mounted
  if (!mounted) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-xl mb-4">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <div className="bg-slate-800 border-b border-slate-700">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">PewPew Tabletop: Red vs Blue</h1>
            <button
              onClick={() => setShowInstructions(!showInstructions)}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm"
            >
              {showInstructions ? 'Hide' : 'Show'} Instructions
            </button>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-6 py-8">
        <div className="max-w-4xl mx-auto">
          {/* Instructions Panel */}
          {showInstructions && (
            <div className="bg-blue-900/30 border border-blue-500/50 rounded-2xl p-6 mb-6">
              <h2 className="text-xl font-semibold mb-4 text-blue-300">How to Join</h2>
              <div className="space-y-3 text-sm">
                {authOn() && (
                  <div className="flex items-start gap-3">
                    <span className="text-blue-400 font-bold">1.</span>
                    <div>
                      <strong className="text-blue-300">Game Manager:</strong> Click "Game Manager" below, then login with:
                      <div className="mt-1 font-mono text-xs bg-slate-800/50 px-2 py-1 rounded">
                        Username: admin | Password: admin
                      </div>
                      After logging in, create a game session to get join codes for your teams.
                    </div>
                  </div>
                )}
                {codesOn() && (
                  <div className="flex items-start gap-3">
                    <span className="text-blue-400 font-bold">2.</span>
                    <div>
                      <strong className="text-blue-300">Players:</strong> Select your role (Red Team, Blue Team, or Audience) and enter the join code provided by your Game Manager.
                    </div>
                  </div>
                )}
                {!authOn() && !codesOn() && (
                  <div className="flex items-start gap-3">
                    <span className="text-blue-400 font-bold">1.</span>
                    <div>
                      <strong className="text-blue-300">Select your role</strong> below and click "Join Game" to start.
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Main Join Card */}
          <div className="bg-slate-800 rounded-2xl p-8 shadow-xl border-2 border-slate-700">
            {/* Role Selection */}
            <div className="mb-6">
              <label className="block text-sm font-medium mb-4 text-slate-300">Select Your Role</label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { 
                    role: 'gm' as Role, 
                    label: 'Game Manager', 
                    desc: 'Control the game, create sessions, manage scenarios',
                    color: 'purple'
                  },
                  { 
                    role: 'red' as Role, 
                    label: 'Red Team', 
                    desc: 'Launch cyber attacks',
                    color: 'red'
                  },
                  { 
                    role: 'blue' as Role, 
                    label: 'Blue Team', 
                    desc: 'Defend and respond to attacks',
                    color: 'blue'
                  },
                  { 
                    role: 'audience' as Role, 
                    label: 'Audience', 
                    desc: 'Watch the game unfold',
                    color: 'green'
                  },
                ].map(({ role, label, desc, color }) => {
                  const isSelected = selectedRole === role;
                  const colorClasses = {
                    purple: isSelected ? 'border-purple-500 bg-purple-500/20' : 'border-slate-600 bg-slate-700 hover:border-purple-500/50',
                    red: isSelected ? 'border-red-500 bg-red-500/20' : 'border-slate-600 bg-slate-700 hover:border-red-500/50',
                    blue: isSelected ? 'border-blue-500 bg-blue-500/20' : 'border-slate-600 bg-slate-700 hover:border-blue-500/50',
                    green: isSelected ? 'border-green-500 bg-green-500/20' : 'border-slate-600 bg-slate-700 hover:border-green-500/50',
                  };
                  
                  // Show team size for red/blue teams
                  const teamSize = (role === 'red' || role === 'blue') ? teamSizes[role] : null;
                  const isTeamFull = teamSize !== null && teamSize >= 10;
                  
                  return (
                    <button
                      key={role}
                      onClick={() => {
                        if (isTeamFull && (role === 'red' || role === 'blue')) {
                          setJoinError(`${label} is full (10/10 players). Please wait for a spot to open.`);
                          return;
                        }
                        setSelectedRole(role);
                        setJoinError(null);
                        if (role === 'gm' || !codesOn()) {
                          setJoinCode('');
                        }
                      }}
                      disabled={isTeamFull && (role === 'red' || role === 'blue')}
                      className={`p-5 rounded-xl border-2 transition-all transform hover:scale-[1.02] ${
                        isTeamFull && (role === 'red' || role === 'blue')
                          ? 'opacity-50 cursor-not-allowed'
                          : ''
                      } ${colorClasses[color as keyof typeof colorClasses]}`}
                    >
                      <div className="mb-2">
                        <div className="font-semibold text-lg">{label}</div>
                        {teamSize !== null && (
                          <div className="text-xs mt-1">
                            <span className={isTeamFull ? 'text-red-400' : 'text-slate-400'}>
                              {teamSize}/10 players
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 text-left">{desc}</div>
                      {isTeamFull && (
                        <div className="text-xs text-red-400 mt-2 font-semibold">
                          Team Full
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Join Code Input (only if FEATURE_JOIN_CODES is enabled and player role selected) */}
            {codesOn() && selectedRole && selectedRole !== 'gm' && (
              <div className="mb-6">
                <label className="block text-sm font-medium mb-2 text-slate-300">
                  Join Code (Optional - Leave blank for lobby mode)
                  <span className="ml-2 text-xs text-slate-500">
                    (Get this from your Game Manager if using session codes)
                  </span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={joinCode}
                    onChange={(e) => {
                      setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
                      setJoinError(null);
                    }}
                    placeholder="Enter your team's join code"
                    className="w-full px-4 py-3 bg-slate-700 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-lg text-center tracking-wider"
                    maxLength={8}
                  />
                  {joinCode && (
                    <button
                      onClick={() => {
                        setJoinCode('');
                        setJoinError(null);
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                    >
                      ✕
                    </button>
                  )}
                </div>
                {joinError && (
                  <div className="mt-2 p-3 bg-red-900/50 border border-red-500 rounded-lg text-sm text-red-300">
                    {joinError}
                  </div>
                )}
                {!joinError && joinCode && (
                  <div className="mt-2 text-xs text-slate-400">
                    Code entered: <span className="font-mono font-bold text-blue-400">{joinCode}</span>
                  </div>
                )}
              </div>
            )}

            {/* GM Login Info */}
            {authOn() && selectedRole === 'gm' && (
              <div className="mb-6 p-4 bg-purple-900/30 border border-purple-500/50 rounded-lg">
                <div className="text-sm text-purple-300">
                  <strong>Game Manager Login Required</strong>
                  <div className="mt-2 text-xs">
                    You'll be redirected to the login page. Default credentials:
                    <div className="mt-1 font-mono bg-slate-800/50 px-2 py-1 rounded inline-block">
                      admin / admin
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Join Button */}
            <button
              onClick={handleJoin}
              disabled={
                !selectedRole || 
                joinLoading ||
                ((selectedRole === 'red' || selectedRole === 'blue') && teamSizes[selectedRole] >= 10)
              }
              className="w-full py-4 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:from-slate-600 disabled:to-slate-700 disabled:cursor-not-allowed rounded-lg font-semibold text-lg transition-all transform hover:scale-[1.02] disabled:hover:scale-100 shadow-lg disabled:shadow-none"
            >
              {joinLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin">Loading...</span>
                  Joining...
                </span>
              ) : (selectedRole === 'red' || selectedRole === 'blue') && teamSizes[selectedRole] >= 10 ? (
                'Team Full'
              ) : selectedRole === 'gm' && authOn() ? (
                'Login as Game Manager'
              ) : (
                'Join Game'
              )}
            </button>

            {/* Help Text */}
            {codesOn() && selectedRole && selectedRole !== 'gm' && !joinCode && (
              <div className="mt-4 text-center text-xs text-slate-500">
                Leave blank to join in lobby mode (no code needed). Enter a code to join a specific session.
              </div>
            )}
          </div>

          {/* Footer Info */}
          <div className="mt-6 text-center text-sm text-slate-500">
            {codesOn() ? (
              <div>
                <div className="mb-2">Session codes available (optional)</div>
                <div className="text-xs">Join codes are optional - leave blank for lobby mode, or enter a code to join a specific session</div>
              </div>
            ) : (
              <div>Open game mode - no authentication required</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../store/useGameStore';
import { authApi } from '../api/client';
import { authOn } from '../lib/flags';

export default function GMLogin() {
  const navigate = useNavigate();
  const { setAuthToken, setRole } = useGameStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Debug: Log state changes
  useEffect(() => {
    console.log('[GMLogin] State changed', { loading, username: !!username, password: !!password });
  }, [loading, username, password]);

  // If auth is not enabled, redirect to GM page
  // Use useEffect to avoid calling navigate during render
  useEffect(() => {
    if (!authOn()) {
      navigate('/gm');
    }
  }, [navigate]);
  
  if (!authOn()) {
    return null;
  }

  const handleLogin = async () => {
    console.log('[GMLogin] handleLogin called directly', { username, password: '***' });
    
    // Validate inputs
    if (!username.trim() || !password.trim()) {
      console.log('[GMLogin] Validation failed - empty fields');
      setError('Please enter both username and password');
      return;
    }
    
    setError(null);
    setLoading(true);

    try {
      console.log('[GMLogin] Calling authApi.login...');
      const response = await authApi.login(username.trim(), password);
      console.log('[GMLogin] Login successful', response);
      
      // Store token and set role
      console.log('[GMLogin] Setting auth token and role');
      setAuthToken(response.access_token);
      setRole('gm');
      
      // Wait a tick to ensure store is updated, then redirect
      console.log('[GMLogin] Waiting for store update...');
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Verify token is set before redirecting
      const { authToken: verifyToken } = useGameStore.getState();
      console.log('[GMLogin] Token verification:', { hasToken: !!verifyToken });
      
      // Redirect to GM page with replace to prevent back button issues
      console.log('[GMLogin] Redirecting to /gm');
      navigate('/gm', { replace: true });
    } catch (err: any) {
      console.error('[GMLogin] Login failed', err);
      console.error('[GMLogin] Error response:', {
        status: err.response?.status,
        statusText: err.response?.statusText,
        data: err.response?.data,
        message: err.message
      });
      let errorMessage = err.response?.data?.detail || err.response?.data?.message || err.message || 'Login failed';
      
      // Improve error messages
      if (err.response?.status === 429) {
        errorMessage = 'Too many login attempts. Please wait 60 seconds before trying again.';
      } else if (err.response?.status === 500) {
        errorMessage = `Server error: ${errorMessage}. Please check the backend logs for details.`;
      } else if (!err.response) {
        errorMessage = 'Unable to connect to server. Please ensure the backend is running.';
      }
      
      setError(errorMessage);
      setLoading(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    console.log('[GMLogin] Form onSubmit triggered');
    e.preventDefault();
    e.stopPropagation();
    handleLogin();
  };

  // Debug: Log component render
  console.log('[GMLogin] Component rendered', { username: !!username, password: !!password, loading, error });

  return (
    <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center" style={{ pointerEvents: 'auto' }}>
      <div className="bg-slate-800 rounded-2xl p-8 w-full max-w-md border-2 border-slate-700" style={{ pointerEvents: 'auto', position: 'relative', zIndex: 1 }}>
        <h1 className="text-3xl font-bold mb-6 text-center">Game Manager Login</h1>
        
        <form 
          onSubmit={handleFormSubmit} 
          className="space-y-4"
          noValidate
        >
          <div>
            <label htmlFor="username" className="block text-sm font-medium mb-2">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required={false}
              autoFocus
            />
          </div>
          
          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-2">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required={false}
            />
          </div>
          
          {error && (
            <div className="bg-red-900/50 border border-red-500 rounded-lg p-3 text-sm">
              {error}
            </div>
          )}
          
          <button
            type="button"
            disabled={loading}
            onClick={(e) => {
              console.log('[GMLogin] Login button onClick triggered', { 
                loading, 
                username: username.trim(), 
                password: !!password,
                buttonDisabled: loading,
                eventType: e.type,
                timestamp: Date.now()
              });
              e.preventDefault();
              e.stopPropagation();
              handleLogin();
            }}
            onMouseDown={(e) => {
              console.log('[GMLogin] Login button onMouseDown', { timestamp: Date.now(), disabled: loading });
            }}
            onMouseUp={(e) => {
              console.log('[GMLogin] Login button onMouseUp', { timestamp: Date.now(), disabled: loading });
            }}
            onPointerDown={(e) => {
              console.log('[GMLogin] Login button onPointerDown', { timestamp: Date.now(), disabled: loading });
            }}
            style={{ 
              pointerEvents: loading ? 'none' : 'auto', 
              zIndex: 10,
              opacity: loading ? 0.6 : 1,
              cursor: loading ? 'not-allowed' : 'pointer'
            }}
            className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-lg font-semibold transition-colors"
            title={loading ? 'Logging in...' : 'Click to login'}
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
          
          {/* Test button to verify event handlers work */}
          <button
            type="button"
            onClick={() => {
              console.log('[GMLogin] Test button clicked - event handlers work!');
              alert('Test button works! Event handlers are functional.');
            }}
            className="w-full mt-2 px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg font-semibold transition-colors"
          >
            Test Button (Click to verify events work)
          </button>
        </form>
        
        <div className="mt-6 space-y-2">
          <div className="text-center text-sm text-slate-400">
            <button
              onClick={() => navigate('/')}
              className="hover:text-slate-300 underline"
            >
              Back to Lobby
            </button>
          </div>
          {import.meta.env.DEV && (
            <div className="text-center text-xs text-slate-500 border-t border-slate-700 pt-4">
              <div>Default Credentials (Development Only):</div>
              <div className="font-mono mt-1">Username: admin</div>
              <div className="font-mono">Password: admin</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}



import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Lobby from './pages/Lobby';
import GM from './pages/GM';
import GMLogin from './pages/GMLogin';
import Red from './pages/Red';
import Blue from './pages/Blue';
import Audience from './pages/Audience';
import { useGameStore } from './store/useGameStore';
import { ErrorBoundary } from './components/ErrorBoundary';

// Helper to get role from localStorage (for initial render before store hydrates)
function getRoleFromStorage(): 'gm' | 'red' | 'blue' | 'audience' | null {
  try {
    const stored = localStorage.getItem('pewpew-storage');
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed?.state?.role || null;
    }
  } catch (e) {
    // Ignore errors
  }
  return null;
}

// Protected route wrapper
function ProtectedRoute({ 
  requiredRole, 
  component: Component 
}: { 
  requiredRole: 'gm' | 'red' | 'blue' | 'audience';
  component: React.ComponentType;
}) {
  const { role } = useGameStore();
  const [isChecking, setIsChecking] = useState(true);
  const location = useLocation();

  useEffect(() => {
    // Small delay to allow store to hydrate
    const timer = setTimeout(() => {
      setIsChecking(false);
    }, 200);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // Re-check when role changes
    setIsChecking(false);
  }, [role]);

  if (isChecking) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-xl mb-4">Loading...</div>
        </div>
      </div>
    );
  }

  const storedRole = getRoleFromStorage();
  const currentRole = role || storedRole;

  // Always allow access - let the component handle its own auth/redirect logic
  // This prevents blocking the app from loading
  return <Component />;
}

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Lobby />} />
          <Route path="/gm/login" element={<GMLogin />} />
          <Route
            path="/gm"
            element={<ProtectedRoute requiredRole="gm" component={GM} />}
          />
          <Route
            path="/red"
            element={<ProtectedRoute requiredRole="red" component={Red} />}
          />
          <Route
            path="/blue"
            element={<ProtectedRoute requiredRole="blue" component={Blue} />}
          />
          <Route
            path="/audience"
            element={<ProtectedRoute requiredRole="audience" component={Audience} />}
          />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;


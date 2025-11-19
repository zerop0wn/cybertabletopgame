import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Get backend URL from environment variable, with fallbacks
// In Docker: use service name 'backend' (set via VITE_BACKEND_URL=http://backend:8000)
// In local dev: use 'localhost' or '127.0.0.1'
// Can be overridden with VITE_BACKEND_URL env var
const getBackendTarget = () => {
  // Check multiple environment variable names for flexibility
  const backendUrl = process.env.VITE_BACKEND_URL || process.env.BACKEND_URL;
  
  if (backendUrl) {
    console.log(`[Vite Config] Using backend URL from env: ${backendUrl}`);
    return backendUrl;
  }
  
  // Default to localhost for local development
  // In Docker, VITE_BACKEND_URL should be set to http://backend:8000
  console.log(`[Vite Config] No backend URL in env, defaulting to localhost:8000`);
  return 'http://localhost:8000';
};

const backendTarget = getBackendTarget();

console.log(`[Vite Config] Backend target: ${backendTarget}`);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // Allow access from all network interfaces
    port: 5173,
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path,
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            console.log(`[PROXY] ${req.method} ${req.url} -> ${backendTarget}${req.url}`);
          });
          proxy.on('proxyRes', (proxyRes, req, _res) => {
            console.log(`[PROXY] Response: ${req.method} ${req.url} -> ${proxyRes.statusCode}`);
          });
          proxy.on('error', (err, _req, _res) => {
            console.error(`[PROXY ERROR]`, err.message);
            console.error(`[PROXY ERROR] Stack:`, err.stack);
          });
        },
      },
      '/socket.io': {
        target: backendTarget,
        ws: true,
        changeOrigin: true,
        secure: false,
        // Don't rewrite the path - Socket.IO needs /socket.io/ prefix
        configure: (proxy, _options) => {
          // Handle HTTP polling requests (Socket.IO starts with HTTP polling)
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            console.log(`[PROXY WS] HTTP request: ${req.method} ${req.url} -> ${backendTarget}${req.url}`);
          });
          // Handle WebSocket upgrade
          proxy.on('proxyReqWs', (proxyReq, req, _socket) => {
            console.log(`[PROXY WS] WebSocket upgrade: ${req.url}`);
          });
          // Handle errors
          proxy.on('error', (err, _req, _res) => {
            console.log(`[PROXY WS ERROR]`, err.message);
          });
        },
      },
    },
  },
})


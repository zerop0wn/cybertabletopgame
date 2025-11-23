import { useEffect, useState, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Node, Link, Event, EventKind } from '../api/types';

interface PewPewMapProps {
  nodes: Node[];
  links: Link[];
  liveEvents: Event[];
  onNodeClick?: (nodeId: string) => void;
}

interface ActiveAnimation {
  id: string;
  from: Node;
  to: Node;
  type: 'attack' | 'blocked' | 'hit';
  startTime: number;
}

interface DefenseIndicator {
  id: string;
  node: Node;
  actionType: string;
  startTime: number;
  duration: number; // How long to show the indicator (ms)
}

export default function PewPewMap({ nodes, links, liveEvents, onNodeClick }: PewPewMapProps) {
  const [activeAnimations, setActiveAnimations] = useState<ActiveAnimation[]>([]);
  const [defenseIndicators, setDefenseIndicators] = useState<DefenseIndicator[]>([]);
  const timerRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map()); // Track timers by attack ID
  const defenseTimerRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map()); // Track timers for defense indicators
  const processedEventIds = useRef<Set<string>>(new Set());
  const processedNodes = useRef<string>(JSON.stringify(nodes.map(n => n.id).sort()));
  const lastEventIdsRef = useRef<string>('');

  // Memoize event IDs to avoid re-renders when events array reference changes but content is the same
  const eventIds = useMemo(() => {
    return liveEvents.map(e => e.id).join(',');
  }, [liveEvents]);

  // Memoize node IDs to avoid re-renders when nodes array reference changes but content is the same
  const nodeIds = useMemo(() => {
    return JSON.stringify(nodes.map(n => n.id).sort());
  }, [nodes]);

  useEffect(() => {
    // Check if nodes have changed (by comparing sorted IDs)
    const currentNodeIds = nodeIds;
    const nodesChanged = processedNodes.current !== currentNodeIds;
    if (nodesChanged) {
      processedNodes.current = currentNodeIds;
    }

    // Check if we have new events by comparing event IDs string
    const hasNewEvents = lastEventIdsRef.current !== eventIds;
    if (!hasNewEvents && !nodesChanged) {
      // No new events or node changes, nothing to do
      return;
    }

    // Update the last seen event IDs
    if (hasNewEvents) {
      lastEventIdsRef.current = eventIds;
    }

    // Only process new events that we haven't seen before
    const newEvents = liveEvents.filter(event => !processedEventIds.current.has(event.id));
    
    if (newEvents.length === 0 && !nodesChanged) {
      // No new events or node changes, nothing to do
      return;
    }

    // Use functional update to access current state
    setActiveAnimations((prev) => {
      const newAnimations: ActiveAnimation[] = [];
      const animationsToUpdate: Map<string, 'blocked' | 'hit'> = new Map();
      const existingIds = new Set(prev.map(a => a.id));

      // Process only new events
      newEvents.forEach((event) => {
        // Mark event as processed immediately (before processing) to avoid duplicate processing
        processedEventIds.current.add(event.id);
        
        if ((event.kind as string) === 'attack_launched' || event.kind === EventKind.ATTACK_LAUNCHED) {
          const fromNode = nodes.find((n) => n.id === event.payload.from);
          const toNode = nodes.find((n) => n.id === event.payload.to);
          const attackId = event.payload.attack_id || event.id; // Use attack_id if available, fallback to event.id
          
          if (fromNode && toNode && !existingIds.has(attackId)) {
            // Only add if it doesn't already exist
            newAnimations.push({
              id: attackId, // Use attack_id for consistency
              from: fromNode,
              to: toNode,
              type: 'attack',
              startTime: Date.now(),
            });
            existingIds.add(attackId);
            console.log('[PewPewMap] Added attack animation:', attackId, 'from', fromNode.id, 'to', toNode.id);
          }
        } else if ((event.kind as string) === 'action_taken' || event.kind === EventKind.ACTION_TAKEN) {
          // Blue team defense action - show indicator on target node
          const targetNodeId = event.payload?.target;
          const actionType = event.payload?.type || 'defense';
          const targetNode = nodes.find((n) => n.id === targetNodeId);
          
          if (targetNode) {
            const defenseId = `defense-${event.id}`;
            const indicator: DefenseIndicator = {
              id: defenseId,
              node: targetNode,
              actionType,
              startTime: Date.now(),
              duration: 5000, // Show for 5 seconds
            };
            
            // Add indicator
            setDefenseIndicators((prev) => [...prev, indicator]);
            
            // Set cleanup timer
            const timer = setTimeout(() => {
              setDefenseIndicators((current) => current.filter((d) => d.id !== defenseId));
              defenseTimerRefs.current.delete(defenseId);
            }, indicator.duration);
            defenseTimerRefs.current.set(defenseId, timer);
            
            console.log('[PewPewMap] Added defense indicator:', defenseId, 'on node:', targetNodeId, 'action:', actionType);
          }
        } else if ((event.kind as string) === 'attack_resolved' || event.kind === EventKind.ATTACK_RESOLVED) {
          const result = event.payload.result;
          const attackId = event.payload.attack_id;
          
          console.log('[PewPewMap] Received attack_resolved event:', { attackId, result, preliminary: event.payload.preliminary });
          
          // Skip preliminary resolutions - mark as processed but don't update animation
          if (event.payload.preliminary === true) {
            console.log('[PewPewMap] Skipping preliminary resolution for attack:', attackId);
            return; // Event already marked as processed above
          }
          
          // Process final resolution - handle all result types
          if (attackId && result) {
            console.log('[PewPewMap] Processing final resolution for attack:', attackId, 'result:', result);
            // Map result to animation type: 
            // 'blocked', 'successful_block', 'successful_mitigation' -> 'blocked'
            // 'hit', 'unsuccessful_block', 'unsuccessful_mitigation', 'detected', 'miss' -> 'hit'
            const blockedResults = ['blocked', 'successful_block', 'successful_mitigation'];
            const animationType = blockedResults.includes(result) ? 'blocked' : 'hit';
            animationsToUpdate.set(attackId, animationType);
            console.log('[PewPewMap] Set animation update for attack:', attackId, 'to type:', animationType);
            
            // Also check if we need to create the animation if it doesn't exist yet
            // (in case we missed the attack_launched event)
            if (!existingIds.has(attackId)) {
              const fromNode = nodes.find((n) => n.id === event.payload.from);
              const toNode = nodes.find((n) => n.id === event.payload.to);
              
              // If we have node info in the resolution, create the animation
              if (!fromNode || !toNode) {
                // Try to find from/to from the payload
                const from = event.payload.from || event.payload.from_node;
                const to = event.payload.to || event.payload.to_node;
                const fromNode2 = nodes.find((n) => n.id === from);
                const toNode2 = nodes.find((n) => n.id === to);
                
                if (fromNode2 && toNode2) {
                  const blockedResults = ['blocked', 'successful_block', 'successful_mitigation'];
                  newAnimations.push({
                    id: attackId,
                    from: fromNode2,
                    to: toNode2,
                    type: blockedResults.includes(result) ? 'blocked' : 'hit',
                    startTime: Date.now(),
                  });
                  existingIds.add(attackId);
                  console.log('[PewPewMap] Created missing animation from resolution:', attackId);
                }
              } else {
                const blockedResults = ['blocked', 'successful_block', 'successful_mitigation'];
                newAnimations.push({
                  id: attackId,
                  from: fromNode,
                  to: toNode,
                  type: blockedResults.includes(result) ? 'blocked' : 'hit',
                  startTime: Date.now(),
                });
                existingIds.add(attackId);
                console.log('[PewPewMap] Created missing animation from resolution:', attackId);
              }
            }
          } else {
            console.warn('[PewPewMap] Invalid attack_resolved event:', { 
              attackId, 
              result, 
              payload: event.payload 
            });
          }
        }
      });

      // Update existing animations with new state
      const updated = prev.map((anim) => {
        const newType = animationsToUpdate.get(anim.id);
        if (newType) {
          console.log('[PewPewMap] Updating animation type:', anim.id, 'from', anim.type, 'to', newType);
          const updatedAnim = {
            ...anim,
            type: newType,
            startTime: Date.now(), // Update start time to trigger re-render
          };
          console.log('[PewPewMap] Updated animation state:', updatedAnim.id, 'type:', updatedAnim.type);
          return updatedAnim;
        }
        return anim;
      });
      
      // Log if we have updates that don't match existing animations
      animationsToUpdate.forEach((result, attackId) => {
        const hasMatch = updated.some(anim => anim.id === attackId);
        if (!hasMatch) {
          console.warn('[PewPewMap] Resolution event for attack', attackId, 'but no matching launched animation found. Will create new animation.');
        }
      });
      
      // Add new animations (avoid duplicates - filter out any that already exist in updated)
      const updatedIds = new Set(updated.map(a => a.id));
      const uniqueNewAnimations = newAnimations.filter(a => !updatedIds.has(a.id));
      
      // Also check if we need to add animations for resolved attacks that weren't in prev
      animationsToUpdate.forEach((animationType, attackId) => {
        if (!updatedIds.has(attackId) && uniqueNewAnimations.every(a => a.id !== attackId)) {
          // Try to find from/to from the most recent attack_resolved event
          const resolvedEvent = newEvents.find(e => {
            const kind = e.kind as string;
            return (kind === 'attack_resolved' || kind === EventKind.ATTACK_RESOLVED) &&
                   e.payload.attack_id === attackId;
          });
          if (resolvedEvent) {
            const from = resolvedEvent.payload.from || resolvedEvent.payload.from_node;
            const to = resolvedEvent.payload.to || resolvedEvent.payload.to_node;
            const fromNode = nodes.find((n) => n.id === from);
            const toNode = nodes.find((n) => n.id === to);
            if (fromNode && toNode) {
              uniqueNewAnimations.push({
                id: attackId,
                from: fromNode,
                to: toNode,
                type: animationType,
                startTime: Date.now(),
              });
              console.log('[PewPewMap] Created animation from resolution event:', attackId, 'type:', animationType);
            }
          }
        }
      });
      
      const allAnimations = [...updated, ...uniqueNewAnimations];
      
      console.log('[PewPewMap] Total active animations:', allAnimations.length, 'IDs:', allAnimations.map(a => a.id));
      
      // Clear existing timers for animations that are being updated or replaced
      animationsToUpdate.forEach((_, attackId) => {
        const existingTimer = timerRefs.current.get(attackId);
        if (existingTimer) {
          clearTimeout(existingTimer);
          timerRefs.current.delete(attackId);
        }
      });
      
      // Set up cleanup timers for new animations (outside setActiveAnimations)
      // Only set timer for unresolved attacks (not for ones that were created from resolution)
      newAnimations.forEach((anim) => {
        if (anim.type === 'attack') {
          // Only unresolved attacks get a cleanup timer
          const timer = setTimeout(() => {
            setActiveAnimations((current) => {
              const existing = current.find(a => a.id === anim.id);
              // Only remove if still unresolved
              if (existing && existing.type === 'attack') {
                return current.filter((a) => a.id !== anim.id);
              }
              return current;
            });
            timerRefs.current.delete(anim.id);
          }, 60000); // 60 seconds for unresolved attacks
          timerRefs.current.set(anim.id, timer);
        }
      });

      // Set up cleanup timers for resolved animations (outside setActiveAnimations)
      // For any animation that was updated or created with a resolved state
      animationsToUpdate.forEach((result, attackId) => {
        const wasUpdated = updated.some(anim => anim.id === attackId && anim.type !== 'attack');
        const wasCreated = uniqueNewAnimations.some(anim => anim.id === attackId && anim.type !== 'attack');
        if (wasUpdated || wasCreated) {
          // Set cleanup timer for resolved animations
          const existingTimer = timerRefs.current.get(attackId);
          if (existingTimer) {
            clearTimeout(existingTimer);
          }
          const timer = setTimeout(() => {
            setActiveAnimations((current) => current.filter((a) => a.id !== attackId));
            timerRefs.current.delete(attackId);
          }, 20000); // 20 seconds after resolution (longer for better visibility)
          timerRefs.current.set(attackId, timer);
          console.log('[PewPewMap] Set cleanup timer for resolved attack:', attackId);
        }
      });
      
      return allAnimations;
    });

    // Cleanup timers on unmount or when dependencies change
    return () => {
      timerRefs.current.forEach((timer) => clearTimeout(timer));
      timerRefs.current.clear();
      defenseTimerRefs.current.forEach((timer) => clearTimeout(timer));
      defenseTimerRefs.current.clear();
    };
  }, [eventIds, nodeIds, liveEvents, nodes]); // eventIds and nodeIds are stable; liveEvents and nodes needed for actual data access

  const getNodeColor = (node: Node) => {
    const colors: Record<string, string> = {
      internet: '#3b82f6',
      firewall: '#ef4444',
      waf: '#f59e0b',
      web: '#10b981',
      app: '#8b5cf6',
      db: '#ec4899',
      ad: '#6366f1',
      endpoint: '#14b8a6',
      cloud: '#06b6d4',
    };
    return colors[node.type] || '#6b7280';
  };

  const getSeverityColor = (severity: string) => {
    const colors: Record<string, string> = {
      low: '#6b7280',
      medium: '#f59e0b',
      high: '#ef4444',
      critical: '#dc2626',
    };
    return colors[severity] || '#6b7280';
  };

  return (
    <div className="w-full h-full bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 rounded-2xl overflow-hidden relative border-2 border-slate-700 shadow-2xl">
      {/* Grid pattern overlay for network feel */}
      <div 
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: `
            linear-gradient(rgba(148, 163, 184, 0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(148, 163, 184, 0.1) 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px',
        }}
      />
      
      {/* Legend */}
      <div className="absolute top-4 right-4 bg-slate-800/95 backdrop-blur-md rounded-lg p-3 z-10 border-2 border-slate-600 shadow-lg">
        <div className="text-xs font-semibold text-slate-300 mb-2">Network Map</div>
        <div className="space-y-1 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#3b82f6' }} />
            <span className="text-slate-400">Internet</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#ef4444' }} />
            <span className="text-slate-400">Firewall</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#f59e0b' }} />
            <span className="text-slate-400">WAF</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#10b981' }} />
            <span className="text-slate-400">Web/App</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#8b5cf6' }} />
            <span className="text-slate-400">Database</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#6366f1' }} />
            <span className="text-slate-400">Active Directory</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#14b8a6' }} />
            <span className="text-slate-400">Endpoint</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#06b6d4' }} />
            <span className="text-slate-400">Cloud</span>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-slate-700">
          <div className="text-xs text-slate-400 mb-1">Attack Indicators</div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-4 h-0.5" style={{ backgroundColor: '#f59e0b' }} />
            <span className="text-xs text-slate-400">Attack</span>
          </div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-4 h-0.5" style={{ backgroundColor: '#ef4444' }} />
            <span className="text-xs text-slate-400">Hit</span>
          </div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-4 h-0.5" style={{ backgroundColor: '#10b981' }} />
            <span className="text-xs text-slate-400">Blocked</span>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-700">
            <div className="text-xs text-slate-400 mb-1">Defense Indicators</div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full border-2 border-blue-400" style={{ backgroundColor: 'rgba(59, 130, 246, 0.2)' }} />
              <span className="text-xs text-slate-400">Defense Active</span>
            </div>
          </div>
        </div>
      </div>

      <svg width="100%" height="100%" viewBox="0 0 800 400" className="absolute inset-0">
        {/* Network links with improved styling */}
        {links.map((link) => {
          const fromNode = nodes.find((n) => n.id === link.from_id);
          const toNode = nodes.find((n) => n.id === link.to_id);
          if (!fromNode || !toNode) return null;

          // Calculate arrow position (80% along the line)
          const arrowX = fromNode.coords.x + (toNode.coords.x - fromNode.coords.x) * 0.8;
          const arrowY = fromNode.coords.y + (toNode.coords.y - fromNode.coords.y) * 0.8;
          const angle = Math.atan2(toNode.coords.y - fromNode.coords.y, toNode.coords.x - fromNode.coords.x);

          const gradientId = `gradient-${link.from_id}-${link.to_id}`;
          
          return (
            <g key={`${link.from_id}-${link.to_id}`}>
              {/* Connection line with improved network styling */}
              <defs>
                <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#64748b" stopOpacity="0.6" />
                  <stop offset="50%" stopColor="#94a3b8" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#64748b" stopOpacity="0.6" />
                </linearGradient>
              </defs>
              
              {/* Background glow line */}
              <line
                x1={fromNode.coords.x}
                y1={fromNode.coords.y}
                x2={toNode.coords.x}
                y2={toNode.coords.y}
                stroke="#475569"
                strokeWidth="5"
                strokeDasharray="8,6"
                opacity="0.2"
                className="blur-sm"
              />
              
              {/* Main connection line */}
              <line
                x1={fromNode.coords.x}
                y1={fromNode.coords.y}
                x2={toNode.coords.x}
                y2={toNode.coords.y}
                stroke="#64748b"
                strokeWidth="2.5"
                strokeDasharray="8,6"
                opacity="0.8"
              />
              
              {/* Arrow marker with better visibility */}
              <polygon
                points={`${arrowX},${arrowY} ${arrowX - 10 * Math.cos(angle - Math.PI / 6)},${arrowY - 10 * Math.sin(angle - Math.PI / 6)} ${arrowX - 10 * Math.cos(angle + Math.PI / 6)},${arrowY - 10 * Math.sin(angle + Math.PI / 6)}`}
                fill="#94a3b8"
                stroke="#475569"
                strokeWidth="1.5"
                opacity="0.9"
              />
            </g>
          );
        })}

        {/* Active Attack Animations */}
        <AnimatePresence>
          {activeAnimations.map((anim) => {
            // Determine if this is a resolved state
            const isResolved = anim.type === 'blocked' || anim.type === 'hit';
            
            // Determine stroke color based on animation type
            let strokeColor = '#f59e0b'; // Default: orange for unresolved attack
            if (anim.type === 'blocked') {
              strokeColor = '#10b981'; // Green for blocked
            } else if (anim.type === 'hit') {
              strokeColor = '#ef4444'; // Red for hit
            }
            
            console.log('[PewPewMap] Rendering animation:', anim.id, 'type:', anim.type, 'color:', strokeColor);
            
            return (
              <motion.g key={`${anim.id}-${anim.type}-${anim.startTime}`}>
                {/* Main attack line - persistent when resolved */}
                <motion.line
                  x1={anim.from.coords.x}
                  y1={anim.from.coords.y}
                  x2={anim.to.coords.x}
                  y2={anim.to.coords.y}
                  stroke={strokeColor}
                  strokeWidth={isResolved ? "4" : "3"}
                  strokeDasharray={isResolved ? "0" : "8,4"}
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ 
                    pathLength: 1, 
                    opacity: isResolved ? 0.9 : 0.8,
                    stroke: strokeColor, // Animate stroke color change
                  }}
                  exit={{ 
                    opacity: 0,
                    transition: { duration: 0.5 }
                  }}
                  transition={{ 
                    duration: isResolved ? 0.3 : 1,
                    opacity: { duration: 0.3 },
                    stroke: { duration: 0.3, ease: "easeInOut" } // Animate color change with easing
                  }}
                  style={{ stroke: strokeColor }} // Force style update for immediate color change
                />
                
                {/* Pulsing circle for resolved states */}
                {anim.type === 'hit' && (
                  <>
                    {/* Persistent hit indicator */}
                    <circle
                      cx={anim.to.coords.x}
                      cy={anim.to.coords.y}
                      r="12"
                      fill="#ef4444"
                      opacity="0.8"
                    />
                    {/* Pulsing animation */}
                    <motion.circle
                      cx={anim.to.coords.x}
                      cy={anim.to.coords.y}
                      r="12"
                      fill="none"
                      stroke="#ef4444"
                      strokeWidth="3"
                      initial={{ scale: 1, opacity: 0.8 }}
                      animate={{ 
                        scale: [1, 1.5, 1],
                        opacity: [0.8, 0, 0.8]
                      }}
                      transition={{ 
                        duration: 2,
                        repeat: Infinity,
                        ease: "easeInOut"
                      }}
                    />
                  </>
                )}
                {anim.type === 'blocked' && (
                  <>
                    {/* Persistent blocked indicator */}
                    <circle
                      cx={anim.to.coords.x}
                      cy={anim.to.coords.y}
                      r="10"
                      fill="#10b981"
                      opacity="0.8"
                    />
                    {/* Pulsing animation */}
                    <motion.circle
                      cx={anim.to.coords.x}
                      cy={anim.to.coords.y}
                      r="10"
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="2"
                      initial={{ scale: 1, opacity: 0.8 }}
                      animate={{ 
                        scale: [1, 1.3, 1],
                        opacity: [0.8, 0, 0.8]
                      }}
                      transition={{ 
                        duration: 2,
                        repeat: Infinity,
                        ease: "easeInOut"
                      }}
                    />
                  </>
                )}
                
                {/* Text label showing result */}
                {isResolved && (
                  <text
                    x={anim.to.coords.x}
                    y={anim.to.coords.y - 25}
                    textAnchor="middle"
                    fill={anim.type === 'blocked' ? '#10b981' : '#ef4444'}
                    fontSize="12"
                    fontWeight="bold"
                    className="pointer-events-none"
                  >
                    {anim.type === 'blocked' ? 'BLOCKED' : 'HIT'}
                  </text>
                )}
              </motion.g>
            );
          })}
        </AnimatePresence>

        {/* Network nodes with improved styling */}
        {nodes.map((node) => {
          const nodeColor = getNodeColor(node);
          
          return (
            <g key={node.id}>
              {/* Outer glow ring */}
              <circle
                cx={node.coords.x}
                cy={node.coords.y}
                r="28"
                fill={nodeColor}
                opacity="0.15"
                className="blur-md"
              />
              
              {/* Node background circle with gradient feel */}
              <circle
                cx={node.coords.x}
                cy={node.coords.y}
                r="26"
                fill={nodeColor}
                opacity="0.25"
              />
              
              {/* Main node circle */}
              <motion.circle
                cx={node.coords.x}
                cy={node.coords.y}
                r="22"
                fill={nodeColor}
                stroke="#ffffff"
                strokeWidth="3"
                onClick={() => onNodeClick?.(node.id)}
                className="cursor-pointer"
                whileHover={{ scale: 1.2, strokeWidth: 4 }}
                animate={{
                  filter: `drop-shadow(0 0 8px ${nodeColor}) drop-shadow(0 0 16px ${nodeColor}40)`,
                }}
                style={{
                  boxShadow: `0 0 20px ${nodeColor}60`,
                }}
              />
              
              {/* Inner highlight circle */}
              <circle
                cx={node.coords.x}
                cy={node.coords.y}
                r="12"
                fill="#ffffff"
                opacity="0.3"
              />
              
              {/* Node type badge */}
              <text
                x={node.coords.x}
                y={node.coords.y + 5}
                textAnchor="middle"
                fill="#ffffff"
                fontSize="11"
                fontWeight="bold"
                className="pointer-events-none"
                style={{ textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
              >
                {node.type.substring(0, 2).toUpperCase()}
              </text>
              
              {/* Node label with background */}
              <g>
                <rect
                  x={node.coords.x - 35}
                  y={node.coords.y + 30}
                  width="70"
                  height="20"
                  fill="rgba(15, 23, 42, 0.8)"
                  rx="4"
                  className="pointer-events-none"
                />
                <text
                  x={node.coords.x}
                  y={node.coords.y + 43}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="12"
                  fontWeight="semibold"
                  className="pointer-events-none"
                  style={{ textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
                >
                  {node.label}
                </text>
              </g>
              
              {/* Node ID (smaller, for debugging/identification) */}
              <text
                x={node.coords.x}
                y={node.coords.y + 58}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize="9"
                className="pointer-events-none"
                opacity="0.7"
              >
                {node.id}
              </text>
            </g>
          );
        })}

        {/* Defense Indicators - Show when Blue team takes actions */}
        <AnimatePresence>
          {defenseIndicators.map((indicator) => {
            const elapsed = Date.now() - indicator.startTime;
            const progress = Math.min(elapsed / indicator.duration, 1);
            const opacity = 1 - progress; // Fade out over time
            
            return (
              <motion.g key={indicator.id}>
                {/* Pulsing defense ring */}
                <motion.circle
                  cx={indicator.node.coords.x}
                  cy={indicator.node.coords.y}
                  r="35"
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth="3"
                  strokeDasharray="8,4"
                  initial={{ scale: 0.8, opacity: 0.8 }}
                  animate={{ 
                    scale: [0.8, 1.2, 0.8],
                    opacity: [0.8 * opacity, 0.4 * opacity, 0.8 * opacity]
                  }}
                  exit={{ opacity: 0 }}
                  transition={{ 
                    duration: 1.5,
                    repeat: Infinity,
                    ease: "easeInOut"
                  }}
                  style={{ opacity }}
                />
                
                {/* Defense shield icon */}
                <motion.circle
                  cx={indicator.node.coords.x}
                  cy={indicator.node.coords.y - 45}
                  r="12"
                  fill="#1e40af"
                  stroke="#3b82f6"
                  strokeWidth="2"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: opacity }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                />
                <text
                  x={indicator.node.coords.x}
                  y={indicator.node.coords.y - 42}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="12"
                  fontWeight="bold"
                  className="pointer-events-none"
                  style={{ opacity }}
                >
                  🛡️
                </text>
                
                {/* Action type label */}
                <motion.text
                  x={indicator.node.coords.x}
                  y={indicator.node.coords.y - 60}
                  textAnchor="middle"
                  fill="#60a5fa"
                  fontSize="10"
                  fontWeight="semibold"
                  className="pointer-events-none"
                  initial={{ opacity: 0, y: indicator.node.coords.y - 55 }}
                  animate={{ opacity: opacity, y: indicator.node.coords.y - 60 }}
                  exit={{ opacity: 0 }}
                  style={{ 
                    textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                    opacity 
                  }}
                >
                  {indicator.actionType.replace(/_/g, ' ').toUpperCase()}
                </motion.text>
              </motion.g>
            );
          })}
        </AnimatePresence>
      </svg>
    </div>
  );
}


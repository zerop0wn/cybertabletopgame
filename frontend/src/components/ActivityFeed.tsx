import { useState, useEffect } from 'react';
import { useGameStore } from '../store/useGameStore';
import { activityApi } from '../api/client';
import { ActivityEvent } from '../api/types';
import { useWebSocket } from '../hooks/useWebSocket';

interface ActivityFeedProps {
  role: 'red' | 'blue' | 'gm' | 'audience';
}

export default function ActivityFeed({ role }: ActivityFeedProps) {
  const { gameState } = useGameStore();
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const socket = useWebSocket(role);

  // Load recent activities on mount
  useEffect(() => {
    const loadActivities = async () => {
      try {
        const recent = await activityApi.getRecent(role, 20);
        setActivities(recent.activities);
      } catch (error) {
        console.error('[ActivityFeed] Failed to load activities:', error);
      }
    };
    loadActivities();
  }, [role]);

  // Listen for new activity events via WebSocket
  useEffect(() => {
    if (!socket || !socket.connected) return;

    const handleActivityEvent = (event: any) => {
      const eventData = event.event || event;
      if (eventData.kind === 'activity_event' || eventData.kind === 'ACTIVITY_EVENT') {
        const activity: ActivityEvent = {
          id: eventData.payload.id,
          player_name: eventData.payload.player_name,
          role: eventData.payload.role,
          activity_type: eventData.payload.activity_type,
          description: eventData.payload.description,
          timestamp: eventData.payload.timestamp,
          metadata: eventData.payload.metadata || {},
        };
        setActivities((prev) => {
          // Avoid duplicates
          if (prev.some(a => a.id === activity.id)) {
            return prev;
          }
          return [activity, ...prev].slice(0, 20); // Keep last 20 activities
        });
      }
    };

    socket.on('game_event', handleActivityEvent);

    return () => {
      socket.off('game_event', handleActivityEvent);
    };
  }, [socket?.connected]); // Only depend on connection status, not socket object

  const getActivityIcon = (activityType: string): string => {
    const icons: Record<string, string> = {
      viewing_artifact: '📄',
      preparing_attack: '⚔️',
      analyzing_alert: '🔍',
      submitting_action: '🛡️',
      running_scan: '🔎',
      voting: '🗳️',
      viewing_map: '🗺️',
      viewing_timeline: '📊',
    };
    return icons[activityType] || '📌';
  };

  const formatTime = (timestamp: string): string => {
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
      
      if (diffSeconds < 10) return 'just now';
      if (diffSeconds < 60) return `${diffSeconds}s ago`;
      if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  if (!gameState || gameState.status !== 'running') {
    return null;
  }

  return (
    <div className="bg-slate-800 rounded-2xl p-6">
      <h2 className="text-xl font-semibold mb-4">Team Activity</h2>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {activities.length === 0 ? (
          <div className="text-slate-400 text-sm text-center py-4">
            No recent activity
          </div>
        ) : (
          activities.map((activity) => (
            <div
              key={activity.id}
              className="flex items-start gap-2 p-2 rounded-lg bg-slate-700/30 hover:bg-slate-700/50 transition-colors"
            >
              <span className="text-lg">{getActivityIcon(activity.activity_type)}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-blue-300">
                    {activity.player_name}
                  </span>
                  <span className="text-xs text-slate-400">
                    {formatTime(activity.timestamp)}
                  </span>
                </div>
                <div className="text-sm text-slate-300">
                  {activity.description}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}


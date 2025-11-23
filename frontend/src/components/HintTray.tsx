import { useEffect, useState } from 'react';
import { Hint, Event, EventKind } from '../api/types';
import { useGameStore } from '../store/useGameStore';

export default function HintTray() {
  const { events, gameState } = useGameStore();
  const [unlockedHints, setUnlockedHints] = useState<Map<number, Hint>>(new Map());

  useEffect(() => {
    // Check for training hint events
    const hintEvents = events.filter(
      (e) => {
        const kind = e.kind as string;
        return kind === EventKind.TRAINING_HINT || kind === 'training_hint';
      }
    );
    
    const hints = new Map<number, Hint>();
    hintEvents.forEach((event) => {
      const hint = event.payload as Hint;
      hints.set(hint.step, hint);
    });

    setUnlockedHints(hints);
  }, [events]);

  if (gameState?.mode !== 'training') {
    return null;
  }

  const sortedHints = Array.from(unlockedHints.values()).sort((a, b) => a.step - b.step);

  return (
    <div className="bg-slate-800 rounded-2xl p-6">
      <h2 className="text-xl font-semibold mb-4">Training Hints</h2>
      
      <div className="space-y-3">
        {sortedHints.length === 0 ? (
          <div className="text-slate-400 text-center py-4">No hints unlocked yet</div>
        ) : (
          sortedHints.map((hint) => (
            <div
              key={hint.step}
              className="bg-blue-900/30 border border-blue-700 rounded-lg p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="px-2 py-1 bg-blue-600 rounded text-xs font-semibold">
                  Step {hint.step}
                </span>
              </div>
              <div className="text-sm text-blue-200">{hint.text}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}


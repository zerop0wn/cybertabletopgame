import React from 'react';

type Props = {
  totalEvents: number;
  ratePerMin: number;
  topSources: Array<{ name: string; count: number }>;
};

export default function PewPewOverlay({ totalEvents, ratePerMin, topSources }: Props) {
  return (
    <div className="absolute top-4 right-4 bg-slate-800/95 backdrop-blur-md rounded-lg p-3 min-w-[220px] border-2 border-slate-700 shadow-lg">
      <div className="text-[11px] font-semibold text-slate-300 uppercase tracking-wide mb-2">
        Live Telemetry
      </div>
      <div className="text-sm text-slate-300 flex justify-between mb-1">
        <span>Total</span>
        <span className="font-mono">{totalEvents}</span>
      </div>
      <div className="text-sm text-slate-300 flex justify-between mb-2">
        <span>Rate</span>
        <span className="font-mono">{ratePerMin}/min</span>
      </div>
      <div className="mt-2 border-t border-slate-700/60 pt-2">
        <div className="text-[11px] text-slate-400 mb-1">Top Sources</div>
        <ul className="space-y-1">
          {topSources.slice(0, 5).map((s) => (
            <li key={s.name} className="text-xs text-slate-300 flex justify-between">
              <span>{s.name}</span>
              <span className="text-slate-400 font-mono">{s.count}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}


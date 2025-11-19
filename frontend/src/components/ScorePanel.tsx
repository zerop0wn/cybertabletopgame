import { useGameStore } from '../store/useGameStore';

export default function ScorePanel() {
  const { score } = useGameStore();

  return (
    <div className="bg-slate-800 rounded-2xl p-6">
      <h2 className="text-xl font-semibold mb-4">Score</h2>
      
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <span className="text-red-400 font-semibold">Red Team</span>
          <span className="text-2xl font-bold">{score.red}</span>
        </div>
        
        <div className="flex justify-between items-center">
          <span className="text-blue-400 font-semibold">Blue Team</span>
          <span className="text-2xl font-bold">{score.blue}</span>
        </div>
        
        {score.mttd !== undefined && score.mttd !== null && (
          <div className="pt-4 border-t border-slate-700">
            <div className="text-sm text-slate-400 mb-2">MTTD</div>
            <div className="text-lg">{score.mttd.toFixed(1)}s</div>
          </div>
        )}
        
        {score.mttc !== undefined && score.mttc !== null && (
          <div className="pt-4 border-t border-slate-700">
            <div className="text-sm text-slate-400 mb-2">MTTC</div>
            <div className="text-lg">{score.mttc.toFixed(1)}s</div>
          </div>
        )}
      </div>
    </div>
  );
}


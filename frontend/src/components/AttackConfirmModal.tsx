import { Attack } from '../api/types';

interface AttackConfirmModalProps {
  attack: Attack | null;
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  disabled?: boolean;
}

export default function AttackConfirmModal({
  attack,
  isOpen,
  onConfirm,
  onCancel,
  disabled = false,
}: AttackConfirmModalProps) {
  if (!isOpen || !attack) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-lg p-6 max-w-md w-full mx-4 border border-slate-700">
        <h2 className="text-2xl font-bold mb-4 text-red-400">Confirm Attack Launch</h2>
        
        <div className="space-y-4 mb-6">
          <div>
            <div className="text-sm text-slate-400 mb-1">Attack Type</div>
            <div className="text-lg font-semibold">{attack.attack_type}</div>
          </div>
          
          <div>
            <div className="text-sm text-slate-400 mb-1">Target</div>
            <div className="text-lg">
              <span className="text-slate-300">{attack.from_node}</span>
              <span className="mx-2 text-slate-500">→</span>
              <span className="text-red-400 font-semibold">{attack.to_node}</span>
            </div>
          </div>
          
          {attack.effects?.impact && (
            <div>
              <div className="text-sm text-slate-400 mb-1">Impact</div>
              <div className="text-slate-300">{attack.effects.impact}</div>
            </div>
          )}
        </div>

        <div className="flex gap-4">
          <button
            onClick={onCancel}
            disabled={disabled}
            className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={disabled}
            className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Confirm Launch
          </button>
        </div>
      </div>
    </div>
  );
}


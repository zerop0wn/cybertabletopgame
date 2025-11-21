import { useGameStore } from '../store/useGameStore';
import { ScanToolType } from '../api/types';

interface ScanResult {
  scan_id: string;
  tool: string;
  target_node: string;
  success: boolean;
  results: Record<string, string>;
  timestamp: string;
  message: string;
  player_name?: string;
  source_ip?: string;
}

interface ScanResultsBoardProps {
  scanResults: ScanResult[];
}

export default function ScanResultsBoard({ scanResults }: ScanResultsBoardProps) {
  const formatTime = (timestamp: string): string => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return '';
    }
  };

  const getToolIcon = (tool: string): string => {
    const toolMap: Record<string, string> = {
      [ScanToolType.OWASP_ZAP]: '🔍',
      [ScanToolType.NMAP]: '🌐',
      [ScanToolType.SQLMAP]: '💉',
      [ScanToolType.NIKTO]: '🛡️',
      [ScanToolType.HAVEIBEENPWNED]: '🔐',
    };
    return toolMap[tool] || '📊';
  };

  if (scanResults.length === 0) {
    return (
      <div className="bg-slate-800 rounded-2xl p-6">
        <h2 className="text-xl font-semibold mb-4">Intel Board</h2>
        <div className="text-slate-400 text-center py-8">
          No scans completed yet. Run scans to see results here.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-800 rounded-2xl p-6">
      <h2 className="text-xl font-semibold mb-4">Intel Board</h2>
      <div className="text-sm text-slate-400 mb-4">
        All scan results are visible to the entire team. Review findings to identify the vulnerability.
      </div>
      
      <div className="space-y-4">
        {scanResults.map((scan) => (
          <div
            key={scan.scan_id}
            className="p-4 rounded-lg border-2 border-slate-600 bg-slate-700/50"
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{getToolIcon(scan.tool)}</span>
                <div>
                  <div className="font-semibold text-lg">{scan.tool}</div>
                  <div className="text-xs text-slate-400">
                    {scan.player_name ? `Run by ${scan.player_name}` : 'Anonymous'} • {formatTime(scan.timestamp)}
                    {scan.source_ip && ` • Source IP: ${scan.source_ip}`}
                  </div>
                </div>
              </div>
            </div>
            
            <div className="mt-3 mb-2">
              <p className="text-sm font-medium text-slate-300">
                {scan.message}
              </p>
            </div>
            
            <div className="mt-3 bg-slate-900 rounded p-3">
              <div className="text-xs font-semibold mb-2 text-slate-400">Scan Results:</div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {Object.entries(scan.results).map(([key, value]) => (
                  <div key={key} className="text-xs">
                    <span className="font-semibold text-slate-300">{key}:</span>{' '}
                    <span className="text-slate-400 whitespace-pre-wrap break-words">{String(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


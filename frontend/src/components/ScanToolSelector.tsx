import { useState, useMemo } from 'react';
import { ScanToolType, ScanResult, Scenario } from '../api/types';
import { scansApi, activityApi } from '../api/client';
import { useGameStore } from '../store/useGameStore';

interface ScanToolSelectorProps {
  scenarioId: string;
  targetNode: string;
  scenario?: Scenario;
  onScanComplete: (result: ScanResult) => void;
  disabled?: boolean;
  playerName?: string;
}

export default function ScanToolSelector({
  scenarioId,
  targetNode,
  scenario,
  onScanComplete,
  disabled = false,
  playerName,
}: ScanToolSelectorProps) {
  const { role } = useGameStore();
  const [selectedTool, setSelectedTool] = useState<ScanToolType | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);

  const allScanTools = [
    { type: ScanToolType.OWASP_ZAP, label: 'OWASP ZAP', description: 'Web application security scanner', icon: '🔍' },
    { type: ScanToolType.NMAP, label: 'Nmap', description: 'Network port scanner', icon: '🌐' },
    { type: ScanToolType.SQLMAP, label: 'SQLMap', description: 'SQL injection scanner', icon: '💉' },
    { type: ScanToolType.NIKTO, label: 'Nikto', description: 'Web server scanner', icon: '🛡️' },
    { type: ScanToolType.HAVEIBEENPWNED, label: 'HaveIBeenPwned', description: 'Data breach and credential exposure checker', icon: '🔐' },
  ];

  // Filter scan tools based on what's available in the scenario
  const scanTools = useMemo(() => {
    // If no scenario or no scan_artifacts, show all tools (fallback)
    if (!scenario?.scan_artifacts || Object.keys(scenario.scan_artifacts).length === 0) {
      return allScanTools;
    }
    
    // Only show tools that have scan artifacts defined for this scenario
    // scan_artifacts keys are the enum string values (e.g., "OWASP ZAP", "Nmap")
    const filtered = allScanTools.filter(tool => {
      // tool.type is the enum value which is already a string (e.g., "OWASP ZAP")
      const toolKey = tool.type;
      return scenario.scan_artifacts && toolKey in scenario.scan_artifacts;
    });
    
    // If filtering resulted in no tools, fall back to all tools
    if (filtered.length === 0) {
      return allScanTools;
    }
    
    return filtered;
  }, [scenario]);

  const handleRunScan = async () => {
    if (!selectedTool || scanning) return;

    setScanning(true);
    try {
      // Track activity: preparing to run scan
      if (playerName && role) {
        try {
          await activityApi.track({
            player_name: playerName,
            role: role as 'red' | 'blue' | 'gm' | 'audience',
            activity_type: 'running_scan',
            description: `Running ${selectedTool} scan on ${targetNode}`,
            metadata: { tool: selectedTool, target: targetNode },
          });
        } catch (err) {
          console.error('[ScanToolSelector] Failed to track activity:', err);
        }
      }
      
      const result = await scansApi.scan({
        tool: selectedTool,
        target_node: targetNode,
        scenario_id: scenarioId,
        player_name: playerName || undefined,
      });
      setScanResult(result);
      onScanComplete(result);
    } catch (error: any) {
      console.error('Failed to run scan:', error);
      alert(`Failed to run scan: ${error.response?.data?.detail || error.message || 'Unknown error'}`);
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold mb-2">Select Reconnaissance Tool</h3>
        <p className="text-sm text-slate-400 mb-4">
          Choose a scanning tool to identify vulnerabilities in the target system.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {scanTools.map((tool) => (
          <button
            key={tool.type}
            onClick={() => setSelectedTool(tool.type)}
            disabled={disabled || scanning}
            className={`p-4 rounded-lg border-2 transition-all ${
              selectedTool === tool.type
                ? 'border-red-500 bg-red-900/20'
                : 'border-slate-600 bg-slate-700 hover:border-slate-500'
            } ${disabled || scanning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">{tool.icon}</span>
              <div className="text-left">
                <div className="font-semibold">{tool.label}</div>
                <div className="text-xs text-slate-400">{tool.description}</div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {selectedTool && (
        <button
          onClick={handleRunScan}
          disabled={disabled || scanning}
          className={`w-full px-4 py-2 rounded-lg font-semibold ${
            disabled || scanning
              ? 'bg-slate-600 cursor-not-allowed'
              : 'bg-red-600 hover:bg-red-700'
          }`}
        >
          {scanning ? 'Scanning...' : `Run ${scanTools.find(t => t.type === selectedTool)?.label} Scan`}
        </button>
      )}

      {scanResult && (
        <div className="mt-4 p-4 rounded-lg border-2 border-slate-600 bg-slate-700/50">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xl">📊</span>
            <div className="font-semibold">
              Scan Complete
            </div>
          </div>
          <p className="text-sm mb-3 text-slate-300">{scanResult.message}</p>
          <div className="bg-slate-800 rounded p-3 mt-2">
            <div className="text-xs font-semibold mb-2 text-slate-400">Scan Results:</div>
            <div className="space-y-1">
              {Object.entries(scanResult.results).map(([key, value]) => (
                <div key={key} className="text-xs">
                  <span className="font-semibold text-slate-300">{key}:</span>{' '}
                  <span className="text-slate-400">{value}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-3 text-xs text-slate-400 italic">
            Note: Review all scan results in the Intel Board above to identify which scan found the vulnerability.
          </div>
        </div>
      )}
    </div>
  );
}


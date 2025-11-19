import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface BlueBriefingProps {
  briefing: {
    alertLevel?: 'URGENT' | 'CRITICAL' | 'CLASSIFIED';
    threatSummary: string;
    initialIndicators?: string[];
    recommendedActions?: string[];
    context?: string;
  };
  onDismiss: () => void;
}

export default function BlueBriefing({ briefing, onDismiss }: BlueBriefingProps) {
  const [displayText, setDisplayText] = useState('');
  const [showFullContent, setShowFullContent] = useState(false);
  const alertLevel = briefing.alertLevel || 'CLASSIFIED';

  useEffect(() => {
    // Typewriter effect for main text
    let charIndex = 0;
    const fullText = briefing.threatSummary;
    
    const typeInterval = setInterval(() => {
      if (charIndex < fullText.length) {
        setDisplayText(fullText.slice(0, charIndex + 1));
        charIndex++;
      } else {
        clearInterval(typeInterval);
        // Show full content after main text is typed
        setTimeout(() => {
          setShowFullContent(true);
        }, 500);
      }
    }, 15); // Typing speed

    return () => clearInterval(typeInterval);
  }, [briefing.threatSummary]);

  const getAlertColor = () => {
    switch (alertLevel) {
      case 'URGENT':
        return 'bg-red-600';
      case 'CRITICAL':
        return 'bg-orange-600';
      case 'CLASSIFIED':
        return 'bg-blue-600';
      default:
        return 'bg-blue-600';
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9999] bg-gradient-to-b from-slate-900 via-blue-900 to-black flex items-center justify-center"
      >
        <div className="w-full max-w-4xl mx-4">
          {/* Alert Banner */}
          <motion.div
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.5 }}
            className={`${getAlertColor()} text-white text-center py-4 px-6 rounded-t-lg shadow-lg`}
          >
            <div className="text-2xl font-bold tracking-wider">
              {alertLevel} - FBI CYBER DIVISION
            </div>
            <div className="text-sm mt-1 opacity-90">
              THREAT BRIEFING
            </div>
          </motion.div>

          {/* Main Content */}
          <motion.div
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="bg-slate-900/95 border-2 border-blue-500 rounded-b-lg shadow-2xl overflow-hidden"
          >
            {/* Header Section */}
            <div className="bg-slate-800/50 border-b border-blue-500/30 px-6 py-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-blue-400 font-semibold">THREAT LEVEL:</span>
                  <span className="text-red-400 ml-2 font-bold">HIGH</span>
                </div>
                <div>
                  <span className="text-blue-400 font-semibold">INCIDENT ID:</span>
                  <span className="text-white ml-2 font-mono">INC-2024-0015</span>
                </div>
                <div>
                  <span className="text-blue-400 font-semibold">TIMESTAMP:</span>
                  <span className="text-white ml-2 font-mono">
                    {new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC
                  </span>
                </div>
                <div>
                  <span className="text-blue-400 font-semibold">STATUS:</span>
                  <span className="text-yellow-400 ml-2 font-bold">ACTIVE</span>
                </div>
              </div>
            </div>

            {/* Content Section */}
            <div className="p-6 text-white space-y-4 max-h-[60vh] overflow-y-auto">
              {/* Situation */}
              <div>
                <div className="text-red-400 font-bold text-lg mb-2">SITUATION:</div>
                <div className="text-slate-200 leading-relaxed">
                  {displayText}
                  {displayText.length < briefing.threatSummary.length && (
                    <span className="animate-pulse">|</span>
                  )}
                </div>
              </div>

              {/* Full Content */}
              {showFullContent && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  {/* Context */}
                  {briefing.context && (
                    <div>
                      <div className="text-blue-400 font-semibold mb-2">CONTEXT:</div>
                      <div className="text-slate-300 leading-relaxed">{briefing.context}</div>
                    </div>
                  )}

                  {/* Initial Indicators */}
                  {briefing.initialIndicators && briefing.initialIndicators.length > 0 && (
                    <div>
                      <div className="text-yellow-400 font-semibold mb-2">INITIAL INDICATORS:</div>
                      <ul className="list-disc list-inside space-y-1 text-slate-300">
                        {briefing.initialIndicators.map((indicator, idx) => (
                          <li key={idx}>{indicator}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Recommended Actions */}
                  {briefing.recommendedActions && briefing.recommendedActions.length > 0 && (
                    <div>
                      <div className="text-green-400 font-semibold mb-2">RECOMMENDED ACTIONS:</div>
                      <ol className="list-decimal list-inside space-y-1 text-slate-300">
                        {briefing.recommendedActions.map((action, idx) => (
                          <li key={idx}>{action}</li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {/* Objective */}
                  <div className="pt-4 border-t border-blue-500/30">
                    <div className="text-blue-400 font-semibold mb-2">OBJECTIVE:</div>
                    <div className="text-slate-200 font-semibold">
                      Detect and contain any exploitation attempts before attacker gains persistent access or exfiltrates data.
                    </div>
                  </div>
                </motion.div>
              )}
            </div>

            {/* Footer/Acknowledge Button */}
            {showFullContent && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-slate-800/50 border-t border-blue-500/30 px-6 py-4 flex justify-end"
              >
                <button
                  onClick={onDismiss}
                  className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors shadow-lg hover:shadow-blue-500/50"
                >
                  ACKNOWLEDGE
                </button>
              </motion.div>
            )}
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}


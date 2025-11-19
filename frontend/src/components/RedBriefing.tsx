import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { gameApi } from '../api/client';
import { useGameStore } from '../store/useGameStore';

interface RedBriefingProps {
  briefing: {
    cyrillicText?: string;
    englishText: string;
    targetInfo?: string;
    objectives?: string[];
  };
  onDismiss: () => void;
}

// Cyrillic characters that look similar to Latin
const CYRILLIC_MAP: Record<string, string> = {
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O',
  'Р': 'P', 'С': 'C', 'Т': 'T', 'У': 'Y', 'Х': 'X', 'а': 'a', 'в': 'b',
  'е': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c',
  'т': 't', 'у': 'y', 'х': 'x', ' ': ' ', '\n': '\n', ':': ':', '-': '-',
  '.': '.', ',': ',', '!': '!', '?': '?', '(': '(', ')': ')', '[': '[', ']': ']',
};

function translateCyrillicToEnglish(text: string): string {
  return text
    .split('')
    .map(char => CYRILLIC_MAP[char] || char)
    .join('');
}

export default function RedBriefing({ briefing, onDismiss }: RedBriefingProps) {
  const { setGameState } = useGameStore();
  const [displayText, setDisplayText] = useState('');
  const [showCursor, setShowCursor] = useState(true);
  const [isTranslating, setIsTranslating] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<'cyrillic' | 'translating' | 'english'>('cyrillic');
  const textRef = useRef<HTMLDivElement>(null);

  const handleDismiss = async () => {
    try {
      console.log('[RedBriefing] Dismissing briefing and starting timer...');
      // Call API to dismiss briefing and start timer
      const updatedState = await gameApi.dismissBriefing();
      console.log('[RedBriefing] Briefing dismissed, updated state:', updatedState);
      setGameState(updatedState);
      onDismiss();
    } catch (error: any) {
      console.error('[RedBriefing] Failed to dismiss briefing:', error);
      const message = error.response?.data?.detail || error.message || 'Failed to dismiss briefing';
      alert(`Failed to start timer: ${message}`);
      // Still dismiss locally even if API call fails
      onDismiss();
    }
  };

  useEffect(() => {
    let translateInterval: NodeJS.Timeout | null = null;
    let typeInterval: NodeJS.Timeout | null = null;
    let timer: NodeJS.Timeout | null = null;
    
    // Start with Cyrillic text
    if (briefing.cyrillicText) {
      setDisplayText(briefing.cyrillicText);
      
      // After showing Cyrillic briefly, quickly fade to English
      timer = setTimeout(() => {
        setIsTranslating(true);
        setCurrentPhase('translating');
        
        // Quick fade effect - replace all at once with a brief opacity transition
        // Show translated version immediately
        const englishText = translateCyrillicToEnglish(briefing.cyrillicText!);
        setDisplayText(englishText);
        
        // Then quickly show full English text
        setTimeout(() => {
          setCurrentPhase('english');
          setDisplayText(briefing.englishText);
        }, 150); // Very quick transition
      }, 300); // Show Cyrillic for very short time
    } else {
      // No Cyrillic, just show English with typewriter
      setCurrentPhase('english');
      let charIndex = 0;
      typeInterval = setInterval(() => {
        if (charIndex < briefing.englishText.length) {
          setDisplayText(briefing.englishText.slice(0, charIndex + 1));
          charIndex++;
        } else {
          if (typeInterval) clearInterval(typeInterval);
        }
      }, 20);
    }
    
    return () => {
      if (timer) clearTimeout(timer);
      if (translateInterval) clearInterval(translateInterval);
      if (typeInterval) clearInterval(typeInterval);
    };
  }, [briefing]);

  // Blinking cursor
  useEffect(() => {
    const cursorInterval = setInterval(() => {
      setShowCursor(prev => !prev);
    }, 530);
    return () => clearInterval(cursorInterval);
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (textRef.current) {
      textRef.current.scrollTop = textRef.current.scrollHeight;
    }
  }, [displayText]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9999] bg-black flex items-center justify-center"
        onClick={currentPhase === 'english' ? handleDismiss : undefined}
        onKeyDown={(e) => {
          if (currentPhase === 'english' && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            handleDismiss();
          }
        }}
        tabIndex={0}
      >
        <div className="w-full max-w-4xl mx-4">
          {/* Terminal Window */}
          <div className="bg-black border-2 border-green-500 rounded-lg shadow-2xl shadow-green-500/50 overflow-hidden">
            {/* Terminal Header */}
            <div className="bg-green-900/30 border-b border-green-500 px-4 py-2 flex items-center gap-2">
              <div className="flex gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500"></div>
                <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                <div className="w-3 h-3 rounded-full bg-green-500"></div>
              </div>
              <div className="text-green-400 text-xs font-mono ml-4">
                root@hacker-terminal:~$
              </div>
            </div>

            {/* Terminal Content */}
            <div
              ref={textRef}
              className="p-6 font-mono text-green-400 text-sm leading-relaxed overflow-y-auto max-h-[70vh]"
              style={{
                textShadow: '0 0 10px #00ff00, 0 0 20px #00ff00',
              }}
            >
              <pre className="whitespace-pre-wrap font-mono">
                {displayText}
                {showCursor && <span className="text-green-400 animate-pulse">█</span>}
              </pre>

              {/* Additional content after translation */}
              {currentPhase === 'english' && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                  className="mt-4 space-y-3"
                >
                  {briefing.targetInfo && (
                    <div className="text-green-300">
                      <div className="text-green-500">┌─ TARGET INFORMATION</div>
                      <div className="text-green-400 ml-2">{briefing.targetInfo}</div>
                    </div>
                  )}

                  {briefing.objectives && briefing.objectives.length > 0 && (
                    <div className="text-green-300 mt-4">
                      <div className="text-green-500">┌─ OBJECTIVES</div>
                      {briefing.objectives.map((obj, idx) => (
                        <div key={idx} className="text-green-400 ml-2">
                          [{idx + 1}] {obj}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-6 pt-4 border-t border-green-500/30">
                    <button
                      onClick={handleDismiss}
                      className="text-green-500 hover:text-green-400 animate-pulse cursor-pointer font-mono"
                    >
                      [Press any key or click to begin...]
                    </button>
                  </div>
                </motion.div>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}


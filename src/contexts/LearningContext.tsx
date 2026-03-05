import React, { createContext, useContext, useState, useCallback } from 'react';

export interface MarkedWord {
  sentenceIdx: number;
  wordIdx?: number;
  order: number;
}

interface LearningContextType {
  markedWords: MarkedWord[];
  toggleMark: (sentenceIdx: number, wordIdx?: number) => void;
  clearMarks: () => void;
}

const LearningContext = createContext<LearningContextType | undefined>(undefined);

export function LearningProvider({ children }: { children: React.ReactNode }) {
  const [markedWords, setMarkedWords] = useState<MarkedWord[]>([]);
  const [maxOrder, setMaxOrder] = useState(0);

  const toggleMark = useCallback((sentenceIdx: number, wordIdx?: number) => {
    setMarkedWords(prev => {
      const existingIdx = prev.findIndex(m => m.sentenceIdx === sentenceIdx && m.wordIdx === wordIdx);
      if (existingIdx >= 0) {
        // Remove it but DONT reset maxOrder
        const next = [...prev];
        next.splice(existingIdx, 1);
        return next;
      } else {
        // Add new mark with incremented order
        const newOrder = maxOrder + 1;
        setMaxOrder(newOrder);
        return [...prev, { sentenceIdx, wordIdx, order: newOrder }];
      }
    });
  }, [maxOrder]);

  const clearMarks = useCallback(() => {
    setMarkedWords([]);
    setMaxOrder(0);
  }, []);

  return (
    <LearningContext.Provider value={{ markedWords, toggleMark, clearMarks }}>
      {children}
    </LearningContext.Provider>
  );
}

export function useLearningSession() {
  const context = useContext(LearningContext);
  if (context === undefined) {
    throw new Error('useLearningSession must be used within a LearningProvider');
  }
  return context;
}

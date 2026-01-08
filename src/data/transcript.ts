export interface Word {
  text: string;
  start: number;
  end: number;
}

// 🧠 Intelligent phrase chunking from spaCy NLP
export interface PhraseChunk {
  text: string;
  begin_time: number;  // milliseconds (from ASR)
  end_time: number;    // milliseconds (from ASR)
  words: Array<{
    text: string;
    begin_time: number;
    end_time: number;
  }>;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  words?: Word[];
  translation?: string; // 🆕 Chinese translation
  phrase_chunks?: PhraseChunk[]; // 🧠 Smart phrase grouping
}

const rawTranscript: TranscriptSegment[] = [
  { start: 0.0, end: 2.0, text: "Thank you." },
  { start: 6.0, end: 12.0, text: "I'm honored to be with you today for your commencement from one of the finest universities in the world." },
  { start: 15.0, end: 25.0, text: "Truth be told, I never graduated from college, and this is the closest I've ever gotten to a college graduation." },
  { start: 26.0, end: 30.0, text: "Today, I want to tell you three stories from my life." },
  { start: 30.0, end: 34.0, text: "That's it. No big deal. Just three stories." },
  { start: 35.0, end: 38.0, text: "The first story is about connecting the dots." },
  { start: 40.0, end: 47.0, text: "I dropped out of Reed College after the first six months, but then stayed around as a drop-in for another 18 months or so before I really quit." },
  { start: 48.0, end: 50.0, text: "So why'd I drop out?" },
  { start: 51.0, end: 53.0, text: "It started before I was born." },
  { start: 54.0, end: 60.0, text: "My biological mother was a young, unwed graduate student, and she decided to put me up for adoption." },
  { start: 61.0, end: 69.0, text: "She felt very strongly that I should be adopted by college graduates, so everything was all set for me to be adopted at birth by a lawyer and his wife." }
];

// Helper to generate word timestamps (Mock Strategy)
export const transcript: TranscriptSegment[] = rawTranscript.map(seg => {
  const words = seg.text.split(' ');
  const duration = seg.end - seg.start;
  const wordDuration = duration / words.length;

  return {
    ...seg,
    words: words.map((word, i) => ({
      text: word,
      start: seg.start + (i * wordDuration),
      end: seg.start + ((i + 1) * wordDuration)
    }))
  };
});

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export const transcript: TranscriptSegment[] = [
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

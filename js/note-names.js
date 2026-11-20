// Shared pitch spelling for melody notation and reading practice. No DOM/audio.
import { midiName } from './dsp.js';
export const SOLFEGE = ['do', 're', 'mi', 'fa', 'sol', 'la', 'si'];
const STEPS = [0, 2, 4, 5, 7, 9, 11];
const mod = n => ((n % 12) + 12) % 12;
function degree(pc) { let i = 6; while (STEPS[i] > pc) i--; return i; }
export function pitchLabels(midi, tonic = 60) {
  const pc = mod(midi - tonic), d = degree(pc), absolute = mod(midi), f = degree(absolute);
  return {
    name: midiName(midi), number: (pc === STEPS[d] ? '' : '♯') + (d + 1),
    octave: Math.floor((midi - tonic) / 12),
    fixed: (absolute === STEPS[f] ? '' : '升 ') + SOLFEGE[f],
    movable: (pc === STEPS[d] ? '' : '升 ') + SOLFEGE[d],
  };
}
export function quizPair(index, tonic = 60, fixed = true) {
  const midi = tonic + STEPS[index], label = pitchLabels(midi, tonic);
  return { midi, name: label.name.replace(/-?\d+$/, ''), sol: fixed ? label.fixed : label.movable };
}
export function durationMark(beats) {
  if (beats === .25) return { lines: 2, dot: false, dashes: 0 };
  if (beats === .5 || beats === .75) return { lines: 1, dot: beats === .75, dashes: 0 };
  if (beats === 1.5) return { lines: 0, dot: true, dashes: 0 };
  return { lines: 0, dot: false, dashes: Math.max(0, Math.floor(beats) - 1) };
}

// Split display tokens at bar lines; tied continuations do not create attacks.
export function notationTokens(notes, beatsPerBar, pickup = 0, offset = 0) {
  const tokens = [], durations = [4, 3, 2, 1.5, 1, .75, .5, .25];
  for (const note of notes) {
    let start = note.start, remaining = note.beats, continuation = false;
    while (remaining > 1e-8) {
      const absolute = start + offset;
      const bar = Math.floor((absolute - pickup) / beatsPerBar) + 1;
      const room = pickup + bar * beatsPerBar - absolute;
      const limit = Math.min(remaining, room);
      const beats = durations.find(d => d <= limit + 1e-8);
      if (!beats) throw new RangeError('Unsupported notation duration: ' + limit);
      tokens.push({ ...note, start, beats, bar, tied: continuation && note.midi !== null });
      remaining -= beats; start += beats; continuation = true;
    }
  }
  return tokens;
}

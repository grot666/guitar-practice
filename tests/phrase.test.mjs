import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { annotate, sliceRange, phrases, difficulty, reviewPhrase } from '../js/phrase.js';
import { SONGS, parseSong } from '../js/songs.js';
import { OnsetDetector, midiToFreq, CLICK, synthClick } from '../js/dsp.js';
import { PitchRecognizer } from '../js/recognition.js';
import { getPattern, barHits } from '../js/rhythm.js';

for (const song of SONGS) {
  const all = annotate(parseSong(song), song.beats, song.pickup);
  const grouped = phrases(all, song.pickup).flatMap(r => sliceRange(all, r, song.beats, song.pickup || 0));
  assert.deepEqual(grouped.filter(n=>n.midi!==null).map(n=>n.midi), all.filter(n=>n.midi!==null).map(n=>n.midi));
}
const notes = [64,64,60,64].map((midi,i) => ({ midi, name: midi === 64 ? 'E4' : 'C4', start:i, beats:1, bar:1 }));
const opts = { t0:0, spb:0.5, latencyMs:0, tolCents:30, a4:440 };
const frames = Array.from({length:50}, (_,i) => ({ time:i*0.04, raw:i<13?midiToFreq(40):i>=38?midiToFreq(64):null, status:i<13||i>=38?'voiced':'below_gate' }));
const result=reviewPhrase(notes,frames,[0,0.5,1.55],opts);
assert.deepEqual(result.rows.map(r=>r.outcome),['wrong','unclear','missing','hit']);
assert.equal(result.pitch,1/3);
assert.equal(result.rows[3].errorMs,50);
assert.equal(difficulty(result.rows).bar,1);
assert.equal(reviewPhrase(notes,[],[],opts).pitch,null);
const sustained=reviewPhrase(notes.slice(0,2),frames.map(f=>({...f,raw:midiToFreq(64),status:'voiced'})),[0],opts);
assert.deepEqual(sustained.rows.map(r=>r.outcome),['hit','unclear']);
assert.deepEqual(barHits(getPattern('chord-change'),'4/4').map(n=>n.at),[0]);

// Replay single recordings, then mix their tails, a quieter pluck, repeated
// notes and a speaker click into one deterministic, annotated exercise.
const sr=22050;
const signals = {};
for (const key of ['E2','C4','E4']) {
  const file = new URL('./fixtures/'+key+'.wav',import.meta.url);
  const stats = JSON.parse(execFileSync(process.execPath,['tools/replay-pitch.mjs',file.pathname,key]));
  assert.ok(stats.within30 >= 12 && stats.wrongOctave === 0);
  const wav=readFileSync(file), start=wav.indexOf('data')+8;
  signals[key]=Float32Array.from({length:(wav.length-start)/2},(_,i)=>wav.readInt16LE(start+i*2)/32768);
}
const mix=new Float32Array(sr*3), seq=['E2','C4','E4','E4'];
function add(samples,t,gain) { const start=Math.round(t*sr); for(let i=0;i<samples.length && start+i<mix.length;i++) mix[start+i]+=gain*samples[i]; }
seq.forEach((name,i)=>{add(signals[name],0.5+i*0.5,i===2?0.35:1);add(synthClick(CLICK.beat,sr,0.04),0.5+i*0.5,1);});
const recog=new PitchRecognizer(sr), onset=new OnsetDetector(sr,{rmsGate:0.003,notchLo:2100,notchHi:4300,maxHz:7000});
const onsets=[],observations=[];
for(let i=0;i<mix.length;i+=1024) {
  const chunk=mix.subarray(i,i+1024);
  onsets.push(...onset.process(chunk,i/sr));recog.process(chunk,i/sr,0.005,f=>observations.push(f));
}
const melody=seq.map((name,i)=>({...notes[i],name,midi:{E2:40,C4:60,E4:64}[name]}));
const replay=reviewPhrase(melody,observations,onsets,{...opts,t0:0.5});
console.log('录音组合回放',replay.rows.map(r=>[r.note,r.outcome,r.errorMs]));
assert.deepEqual(replay.rows.map(r=>r.outcome),Array(4).fill('hit'));

assert.equal(replay.rows[1].recovered,true);
assert.equal(replay.rows[1].errorMs,null);

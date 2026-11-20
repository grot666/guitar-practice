import assert from 'node:assert/strict';
import { pitchLabels, quizPair, durationMark } from '../js/note-names.js';
import { SONGS, parseSong } from '../js/songs.js';
import { ARRANGE } from '../js/harmony.js';
assert.deepEqual(pitchLabels(60), {name:'C4',number:'1',octave:0,fixed:'do',movable:'do'});
assert.deepEqual(pitchLabels(55,67), {name:'G3',number:'1',octave:-1,fixed:'sol',movable:'do'});
assert.equal(pitchLabels(66,67).number,'7');
assert.equal(pitchLabels(66,67).fixed,'升 fa');
assert.equal(pitchLabels(66,67).movable,'si');
assert.equal(pitchLabels(72).octave,1);
assert.equal(quizPair(0,67,false).sol,'do');
assert.equal(quizPair(0,67,true).sol,'sol');
assert.equal(quizPair(6,67,false).name,'F#');
assert.deepEqual(durationMark(.75),{lines:1,dot:true,dashes:0});
assert.deepEqual(durationMark(.25),{lines:2,dot:false,dashes:0});
assert.deepEqual(durationMark(1.5),{lines:0,dot:true,dashes:0});
assert.equal(durationMark(4).dashes,3);
for (const song of SONGS) {
 assert.ok(ARRANGE[song.id],song.id+' must have explicit key');
 for (const n of parseSong(song)) {
  assert.ok(Number.isInteger(n.beats)||[.25,.5,.75,1.5].includes(n.beats),song.id+': '+n.beats);
  if(n.midi !== null) assert.ok(pitchLabels(n.midi,ARRANGE[song.id].key==='G'?67:60).number);
 }
}
console.log('音名、固定/首调唱名、八度及时值映射通过');

const { notationTokens } = await import('../js/note-names.js');
const cross = notationTokens([{midi:60,start:3,beats:3}],4);
assert.deepEqual(cross.map(n=>[n.start,n.beats,n.bar,n.tied]),[[3,1,1,false],[4,2,2,true]]);
assert.equal(notationTokens([{midi:60,start:0,beats:1}],4,1)[0].bar,0);
assert.equal(notationTokens([{midi:60,start:0,beats:1}],4,1,9)[0].bar,3);
for(const song of SONGS) {
 const notes=parseSong(song),tokens=notationTokens(notes,song.beats,song.pickup||0);
 assert.equal(tokens.reduce((s,n)=>s+n.beats,0),notes.reduce((s,n)=>s+n.beats,0));
 assert.equal(tokens.filter(n=>!n.tied&&n.midi!==null).length,notes.filter(n=>n.midi!==null).length);
}
console.log('全曲库谱面时值、跨小节延音、弱起、片段小节编号通过');

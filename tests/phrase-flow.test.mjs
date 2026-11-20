// 使用真实页面处理函数和音频管线；仅替代 DOM、存储和硬件设备。
import assert from 'node:assert/strict';
const nodes = new Map();
const el = sel => {
 if (!nodes.has(sel)) nodes.set(sel, {dataset:{}, selectedOptions:[{textContent:'只看谱'}], classList:{add(){},toggle(){}}, setAttribute(){},querySelector(){return null},click(){return this.onclick?.({target:this})}});
 return nodes.get(sel);
};
globalThis.document={querySelector:el,querySelectorAll:()=>[],documentElement:{dataset:{}},addEventListener(){}};
globalThis.window={addEventListener(){}};
globalThis.requestAnimationFrame=()=>0;
globalThis.matchMedia=()=>({addEventListener(){}});
const data=new Map();globalThis.localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
const core=await import('../js/core.js');
const {openPractice,closePractice,practiceState}=await import('../js/practice.js');
core.engine.startMic=async()=>{core.engine.ctx={sampleRate:48000,currentTime:0};core.engine.stream={};};
core.engine.unlock=async()=>{};
const tokens=Array(8).fill('C4:4').join(' ');
const song={id:'flow',title:'test',notes:tokens,bpm:90,beats:4};
openPractice(song);
el('#p-range').onchange({target:{value:'0'}});
await el('#p-start').click();
let pos=0;
function pcm(hz,sec) {
 for(let i=0;i<Math.ceil(sec*48000/1024);i++){
 const samples=Float32Array.from({length:1024},(_,j)=>hz?0.25*Math.sin(2*Math.PI*hz*(pos+j)/48000):0);
 core.engine._onChunk(samples,pos/48000);pos+=1024;
 }
}
for(const f of [261.63,261.63,329.63,261.63,261.63]){pcm(f,0.32);pcm(0,0.25);}
await new Promise(r=>setTimeout(r,420));
assert.equal(core.loadHistory().length,1);
assert.equal(core.loadHistory()[0].transition.bar,3);
el('#r-focus').click();
await new Promise(r=>setTimeout(r,0));
assert.deepEqual(practiceState().range,[3,3]);
pcm(261.63,0.32); pcm(0,0.25);
await new Promise(r=>setTimeout(r,420));
assert.equal(el('#result').hidden,false);
assert.equal(el('#r-lead').hidden,false);
el('#r-lead').click();
await new Promise(r=>setTimeout(r,0));
assert.deepEqual(practiceState().range,[2,3]);
const resume=core.loadResume();
closePractice();openPractice(song,{resume});
assert.deepEqual(practiceState().range,[2,3]);
el('#p-return').click();await new Promise(r=>setTimeout(r,0));
assert.deepEqual(practiceState().range,[1,4]);
closePractice();console.log('页面处理函数 + PCM：整句、结算、难点、恢复、接回整句均通过');

// 跟拍全程静音不能获得音准总分。循环完成后，停止按钮可以退出下一轮。
const shortSong = { ...song, id:'silent', notes:'C4:1', bpm:120 };
core.metro.start = () => pos / 48000;
openPractice(shortSong, { resume: { id:'silent', mode:'along', range:[1,1], bpm:120, guide:'memory' } });
await el('#p-start').click();
pcm(0,3.2);
assert.equal(core.loadHistory().at(-1).pitch,null);
assert.equal(core.loadHistory().at(-1).score,null);
assert.equal(el('#r-title').textContent,'音高证据不足');
assert.equal(el('#v-play').dataset.guide,'memory');
el('#p-loop').checked=true;
el('#r-again').click();
await new Promise(r=>setTimeout(r,0));
pcm(0,3.2);
await new Promise(r=>setTimeout(r,0));
assert.equal(practiceState().running,true);
await el('#p-start').click();
assert.equal(practiceState().running,false);
closePractice();

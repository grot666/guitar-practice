import assert from 'node:assert/strict';
const nodes=new Map();
function element(){return {value:'',hidden:false,disabled:false,textContent:'',children:[],replaceChildren(...c){this.children=c},focus(){},click(){return this.onclick?.()}};}
function el(s){if(!nodes.has(s))nodes.set(s,element());return nodes.get(s);}
globalThis.document={querySelector:el,createElement:element,documentElement:{dataset:{}},addEventListener(){}};
globalThis.window={addEventListener(){}};
globalThis.matchMedia=()=>({addEventListener(){}});
const data=new Map();globalThis.localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
const {openReading,closeReading}=await import('../js/reading.js');
const {loadHistory}=await import('../js/core.js');
const {quizPair}=await import('../js/note-names.js');
for(const key of ['fixed','C','G']){
 el('#read-key').value=key;el('#read-direction').value='mixed';openReading();el('#read-start').click();
 const pairs=Array.from({length:7},(_,i)=>quizPair(i,key==='G'?67:60,key==='fixed'));
 const counts=new Map();
 for(let i=0;i<14;i++){
  assert.equal(el('#read-next').hidden,true);assert.equal(el('#read-listen').hidden,true);
  const reverse=i%2===1, question=el('#read-question').textContent;
  const pair=pairs.find(p=>(reverse?p.sol:p.name)===question);assert.ok(pair);
  counts.set(pair.name,(counts.get(pair.name)||0)+1);
  const correct=el('#read-answers').children.find(b=>b.textContent===(reverse?pair.name:pair.sol));
  if(i===0){el('#read-answers').children.find(b=>b!==correct).click();assert.equal(el('#read-next').hidden,true);}
  correct.click();correct.click(); // repeated clicks cannot inflate score
  assert.equal(el('#read-next').hidden,false);
  el('#read-next').click();
 }
 assert.deepEqual([...counts.values()],Array(7).fill(2));
 const h=loadHistory().at(-1);assert.equal(h.correct,13);assert.equal(h.mistakes.length,1);assert.equal(h.key,key);
 assert.equal(el('#read-answers').children.length,0);assert.equal(el('#read-key').disabled,false);
}
el('#read-start').click();closeReading();assert.equal(el('#read-answers').children.length,0);
assert.equal(loadHistory().length,3);assert.equal(el('#read-start').hidden,false);
console.log('认音流程通过：三种规则、混合方向、错题、14题完整覆盖、重复点击、保存和退出');

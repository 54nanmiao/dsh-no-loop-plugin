import { detect } from './detector.mjs';
import fs from 'node:fs';
const got=JSON.parse(fs.readFileSync('tmp/blocks.json','utf8'));
for(const [k,v] of Object.entries(got)){
  const head=v.text.slice(0,200).replace(/\n/g,' ');
  const d=detect(v.text);
  const half=detect(v.text.slice(0,Math.floor(v.text.length/2)));
  console.log(k,'len',v.text.length,'loop',d.loop,'reasons',d.reasons.join(','),'r',d.r.toFixed(2),'u',d.u.toFixed(2),'| half:',half.loop,half.reasons.join(','),'|',head.slice(0,80));
  // count ritual
  const cnt=(v.text.match(/（执行）/g)||[]).length; console.log('   （执行）x'+cnt);
}
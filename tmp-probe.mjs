import { detect } from './detector.mjs';
const cases = {
 sql: 'select a,b,c from t where x=1;\nselect a,b,c from t where x=2;\nselect a,b,c from t where x=3;\nselect a,b,c from t where x=4;',
 code: 'function a(){return 1}\nfunction a(){return 1}\nfunction a(){return 1}\n'
};
for (const [k,t] of Object.entries(cases)) { const d=detect(t); console.log(k, 'loop', d.loop, 'codey', d.codey, 'reasons', d.reasons.join(',')); }
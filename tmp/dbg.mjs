import { periodOf, recycleStats } from './detector.mjs'
const t = '我在想，我在想，我在想，我在想，我在想，我在想，我在想，我在想。'
console.log('原文:', t)
const c = t.replace(/\s+/g,'').toLowerCase()
console.log('clean:', c, '长度', c.length)
console.log('periodOf:', periodOf(t))
console.log('recycle:', recycleStats(t))
// 手工核对周期 4
const p = 4
let ok = true
for (let i = p; i < c.length && ok; i++) if (c[i] !== c[i-p]) { ok = false; console.log('断在 i=' + i + '  char=' + c[i] + '  应为=' + c[i-p]) }
console.log('手工周期4:', ok)

import { detect, strongLoop, ritualStats, isExempt, periodOf, recycleStats } from './detector.mjs'

let pass = 0, total = 0
function check(name, got, want) {
  total++
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) pass++
  console.log(`${ok ? '✅' : '❌'} ${name.padEnd(34)} 期望=${JSON.stringify(want)} 实际=${JSON.stringify(got)}`)
}

// —— 元宝：换词循环装成排比（旧 isExempt 会放过 A,A,B,A,A）——
const disguised = '既要快，既要快，而是稳，既要快，既要快。'
check('换词循环不该豁免 isExempt', isExempt(disguised), false)
check('换词循环判 loop', detect(disguised).loop, true)

// —— 真排比仍要放过 ——
const realParallel = '不是它记不住，而是上下文没新线索。不是它不想停，而是没有东西可吃。'
check('真排比仍豁免', isExempt(realParallel), true)

// —— 千问：裸「又」不再豁免 ——
check('裸又不成对不豁免', isExempt('他又来了，他又走了，他又坐下了。'), false)

// —— 元宝：技术文本误报（代码/表格/hex/日志）——
const sql = `select a,b,c from t where x=1;
select a,b,c from t where x=2;
select a,b,c from t where x=3;
select a,b,c from t where x=4;`
check('SQL 块不判 loop', detect(sql).loop, false)
check('SQL 块 period 被压掉', periodOf(sql), 0)

const kv = ['sqliteheader3=5', 'sqliteheader3=5', 'sqliteheader3=5', 'sqliteheader3=5', 'sqliteheader3=5'].join('\n')
check('重复 key=value 行不判 loop', detect(kv).loop, false)

const table = `| 名称 | 大小 |
| --- | --- |
| a.png | 12KB |
| b.png | 34KB |
| c.png | 56KB |`
check('markdown 表格不判 loop', detect(table).loop, false)

const hex = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
check('单个 hex 串不判 loop', detect(hex).loop, false)

// —— 真复读不能因为像代码就放过 ——
const codeRepeat = 'function a(){return 1}\nfunction a(){return 1}\nfunction a(){return 1}\n'
check('代码整句复读仍判 loop', detect(codeRepeat).loop, true)

// —— 千问：千问说 periodOf 按 UTF-16 劈 emoji（code point 后周期=2）——
check('emoji 交替 period=2', periodOf('😀😃😀😃😀😃😀😃😀😃😀😃'), 2)

// —— 豆包：strongLoop 也要过豁免 ——
check('strongLoop 长排比不熔断', strongLoop('不是它记不住，而是上下文没新线索。不是它不想停，而是没有东西可吃。'.repeat(3)).loop, false)
check('strongLoop 真仪式串仍熔断', strongLoop('（执行）。' + '（执行）。'.repeat(30)).loop, true)

// —— 千问：ritualStats.count 语义统一（未命中时不该是片段总数）——
const few = ritualStats('第一句不同。第二句也不同。第三句还是不同。')
check('ritual 未命中 count=最高频=1', few.count, 1)
check('ritual 未命中 total=片段数', few.total, 3)

// —— 元宝：recycleStats 超长文本只看尾部 8K（不再堆 2.5 万窗口）——
const huge = '我在想，'.repeat(20000)
check('超长文本 recycle 不炸', typeof recycleStats(huge).r, 'number')
check('超长文本仍能判 loop', detect(huge).loop, true)

console.log(`\n评审回归: ${pass}/${total}`)
process.exit(pass === total ? 0 : 1)

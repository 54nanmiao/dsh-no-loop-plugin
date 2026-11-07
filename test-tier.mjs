// 两档回归：聊天短回复走宽松档，长 reasoning 走严格档（2026-11-06）
import { strongLoop, detect, CONFIG } from './detector.mjs'

let pass = 0, total = 0
const check = (name, got, want) => {
  total++
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) pass++
  console.log(`${ok ? '✅' : '❌'} ${name.padEnd(34)} 期望=${JSON.stringify(want)} 实际=${JSON.stringify(got)}`)
}

const seal = '（执行）'.repeat(40)
const frog = '我在想，'.repeat(40)
// 三轮循环：每段占比 1/3，旧豁免逻辑会当排比放过
const tri = '先看日志尾部，然后核对时间戳，最后对齐账号。'.repeat(12)
// 正常聊天：说法有变化，只偶有重复
const chat = '刚看了下日志，后半段是空的。时间戳停在十三点，账号那一列也对不上。我先去把 reader 重启一下，回来再看 hook 那边的回执，别急着改配置。'
// 正常技术长文：句子各不相同
const tech = Array.from({ length: 30 }, (_, i) => `第 ${i} 步：检查 service-${i} 的启动参数，确认端口未冲突，再读它的 stdout 尾部前 200 字节。`).join('')
// 真正的排比
const par = '不是要更快，而是要更稳；既要照顾朗读节奏，又要照顾打断成本；一边改桥接，一边盯回执。'.repeat(3)

check('短句仪式：聊天档要拦', strongLoop(seal, { short: true }).loop, true)
check('纯回收：聊天档要拦', strongLoop(frog, { short: true }).loop, true)
check('正常聊天：聊天档放过', strongLoop(chat, { short: true }).loop, false)
check('三轮循环：聊天档也要拦', strongLoop(tri, { short: true }).loop, true)
check('三轮循环：长文档也拦', strongLoop(tri, { short: false }).loop, true)
check('排比：长文档放过', strongLoop(par, { short: false }).loop, false)
check('技术长文：长文档放过', strongLoop(tech, { short: false }).loop, false)
check('detect 短档无 period 理由', detect(chat, { short: true }).reasons.some(r => r.startsWith('period')), false)
check('detect 短档极端仍拦', detect(seal, { short: true }).loop, true)
check('detect 长档三轮循环拦', detect(tri, { short: false }).loop, true)
check('阈值配对', [CONFIG.chatMax, CONFIG.chatRitualCount, CONFIG.chatRecycle], [1200, 14, 0.92])

console.log(`\n分档回归: ${pass}/${total}`)
process.exit(pass === total ? 0 : 1)

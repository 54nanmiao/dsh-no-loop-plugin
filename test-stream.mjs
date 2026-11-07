// 测试产生的命中样本写到临时目录，别污染真实 data\halt.log
if (!process.env.NO_LOOP_DATA_DIR) {
  const os = await import('node:os'), path = await import('node:path')
  process.env.NO_LOOP_DATA_DIR = path.join(os.tmpdir(), 'no-loop-test')
}
const { guardStream, stateOf, truncate, YIELD } = await import('./index.js')

let pass = 0, total = 0
const check = (name, got, want) => {
  total++
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) pass++
  console.log(`${ok ? '✅' : '❌'} ${name.padEnd(30)} 期望=${JSON.stringify(want)} 实际=${JSON.stringify(got).slice(0, 120)}`)
}

async function* fake(parts) {
  for (const p of parts) yield p
}

async function run(sid, text) {
  const chunks = []
  const parts = [{ type: 'reasoning-delta', index: 0, text }]
  parts.push({ type: 'block-end', index: 0, block: { type: 'reasoning', text } })
  for await (const c of guardStream(fake(parts), { sid })) chunks.push(c)
  return chunks
}

// 1) 真仪式串：必须熔断，block-end 换成截断版
const loopText = '（执行）。' + '（执行）。'.repeat(200)
const outA = await run('sessA', loopText)
const endA = outA.find((c) => c.type === 'block-end')
check('熔断后 block-end 被截断', endA.block.text.length < loopText.length && endA.block.text.endsWith(YIELD), true)
check('A 会话 strikes=1', stateOf('sessA').strikes, 1)

// 2) 正常长文：不熔断，原样透传
const normal = '我把 reader 的补丁重新打了一遍，日志里出现 Voice transcription ready，说明语音链路恢复了。'.repeat(3) + '剩下的等明天再验证。'
const outB = await run('sessB', normal)
const endB = outB.find((c) => c.type === 'block-end')
check('正常长文不被改', endB.block.text, normal)
check('B 会话 strikes=0', stateOf('sessB').strikes, 0)

// 3) 会话隔离：A 的计数不传染 B
await run('sessA', loopText)
check('A 第二次 strikes=2', stateOf('sessA').strikes, 2)
check('B 仍为 0（旧版会变 3）', stateOf('sessB').strikes, 0)

// 4) 超长块被 capText 砍中段但不崩
const huge = '我在想，'.repeat(60000)
const outC = await run('sessC', huge)
check('超长块不抛错', outC.length > 0, true)

console.log(`\n流式回归: ${pass}/${total}`)
process.exit(pass === total ? 0 : 1)

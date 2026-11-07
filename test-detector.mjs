import { detect, truncate, YIELD } from './detector.mjs'
const cases = {
  '我的真实复读(做/执行/写)': '做。执行。做。写。做。好。做。执行。做。写。做。输出。做。执行。做。写。做。',
  '正常技术回答': '这个脚本的作用是下载文件。它分六段并行，每段八兆一块，失败只丢当前块。',
  '排比文风': '不是它记不住，而是上下文没新线索。不是它不想停，而是没有东西可吃。',
  '英文复读': 'OK. OK. OK. OK. OK. OK.',
  '单字交替': '嗯。哦。嗯。哦。嗯。哦。嗯。哦。',
  '长句慢循环': '我在想，我在想，我在想，我在想，我在想，我在想，我在想，我在想。',
  '代码块复读': 'function a(){return 1}\nfunction a(){return 1}\nfunction a(){return 1}\n',
  '正常长文': '今天下午我们做完了三件事：第一是修好了 ComfyUI 的启动路径，第二是打通了 OCR 到在线模型的链路，第三是把下载队列停下来保住进度。',
}
let pass = 0
for (const [name, text] of Object.entries(cases)) {
  const d = detect(text)
  const shouldLoop = !/正常/.test(name) && !/排比/.test(name)
  const ok = d.loop === shouldLoop
  if (ok) pass++
  console.log(`${ok ? '✅' : '❌'} ${name.padEnd(20)} loop=${String(d.loop).padEnd(5)} 理由=${d.reasons.join(',') || '无'}`)
}
console.log(`\n单元测试: ${pass}/${Object.keys(cases).length}`)
console.log(`截断示例: ${truncate('做。执行。'.repeat(50)).slice(0,60)}...`)

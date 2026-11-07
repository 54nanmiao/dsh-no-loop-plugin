import { detect } from './detector.mjs'
const cases = {
  '列举商品(同构但不同值)': '第一个是雷克沙，一千五百九十四块。第二个是金邦，一千六百四十八块。第三个是联想，一千六百四十四块。',
  '步骤说明(不同动作)': '第一步装依赖，第二步改成中文路径，第三步重启服务。',
  '正常强调重复': '这个很重要。真的非常重要。不能忘。',
  '技术描述重复术语': 'torch 是 CPU 版。torch 版本 2.14.1。torch 装在嵌入式 Python 里。',
}
for (const [name, text] of Object.entries(cases)) {
  const d = detect(text)
  console.log(`${d.loop ? '🔴 判打转' : '🟢 放过  '}  ${name}  理由=${d.reasons.join(',') || '无'}`)
}

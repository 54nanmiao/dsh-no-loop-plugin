// 防循环检测内核
//
// 移植自元宝（大肥鱼）的 dsh-no-loop 方案，改为 ESM 并做了三处强化：
//   1. 返回结构化报告（metrics + reasons + 建议动作），不只 true/false
//   2. 中文场景的周期检测窗口从 60 字放宽到 120 字（长复读才抓得到）
//   3. 增加 truncate()：按配置截断到"保留开头 + 认输句"
//
// 设计原则：宁可放过，不可误杀。我们爱写排比，误杀一次文采比漏抓一次循环更亏。

export const CONFIG = {
  window: 16,             // 字级滑窗长度
  runeRepeat: 2,          // 连续片段重复 ≥N 次判死循环
  tailPhrase: 3,          // 句尾同短语 ≥N 次
  tailLenMin: 2,
  tailLenMax: 10,
  periodMax: 12,          // ABAB 周期 ≤N 字
  recycleMax: 0.80,       // 片段回收率 ≥N
  uniqueMin: 0.35,        // 唯一片段占比 <N 且回收率高 → 打转
  hardChars: 2000,        // 单轮硬上限（字符）
  keepHead: 240,          // 截断时保留开头字数
  maxStrike: 3,           // 同轮第 N 次 → 强制停
  ritualTail: 900,        // 仪式串检测只看尾部字数
  ritualCount: 12,        // 同一短句在尾部出现 ≥N 次 → 判仪式串（2026-11-06）
  ritualSegMax: 14,       // 被判为「短句」的最大长度
  fragSegMax: 8,          // 碎片重复判定的单段最大长度
  periodSoloMax: 8,       // period 想单独定罪时，周期长度上限（2026-11-06 三方评审）
  periodSoloUniq: 0.35,   // period 单独定罪还要求字符种类占比 ≤ 此值（"我在想，"这种才算）
  recycleMaxChars: 8000,  // recycleStats 只看尾部这么多字，超长文本早退
  recycleStrong: 0.85,    // strongLoop 的回收率阈值（原先硬编码）
  uniqueStrong: 0.30,     // strongLoop 的唯一度阈值（原先硬编码）
  // 两档：短回复（聊天）走宽松档，只有「一眼就是坏」的形态才拦；长 reasoning 走严格档
  chatMax: 1200,          // 整块不足这么多字 = 聊天档
  chatRitualCount: 14,    // 宽松档：同一短句尾部出现 ≥N 次才判（严格档是 12）
  chatFragMin: 6,         // 宽松档：同一碎片重复 ≥N 次才判
  chatRecycle: 0.92,      // 宽松档：回收率下限
  chatUnique: 0.15,       // 宽松档：唯一度上限
  chatCollapse: 8,        // 宽松档：尾部最高频词次数
  tailStrongCount: 4,     // strongLoop：最后 6 句里有 ≥N 句同尾 → 判尾句同构（22 字周期句的洞）
  chatTailCount: 5,       // 宽松档同上
};

const YIELD_TEXT = '…我绕进去了。换个说法：';

// 排比/递进豁免：结构对称或含递进词，且不是完全复读
// 只认「成对结构」：裸「又」「既」匹配面太宽（"他又来了"也算），会把普通句放过（2026-11-06 千问评审）
const PARALLEL = /(不是[^。！？]{0,20}而是|既要[^。！？]{0,20}又要|一边[^。！？]{0,20}一边|有时[^。！？]{0,20}有时|要么[^。！？]{0,20}要么|越来越|一次次|一遍遍)/;

const clean = (s) => String(s).replace(/\s+/g, '').toLowerCase();
const sentences = (s) => String(s).split(/(?<=[。！？.!?\n])/);

export function isExempt(chunk) {
  // 旧判据是 same.length < segs.length，等于「只要不是全一样就豁免」——
  // 「A，A，B，A，A」5 段里 3 段相同也会被放过，正好是装成排比的换词循环（2026-11-06 元宝评审）。
  // 现在要求：最高频片段占比 ≤ 50%，且至少 3 种不同表述，才算真排比。
  const text = String(chunk);
  if (!PARALLEL.test(text)) return false;
  const segs = text.split(/[，,；;。！？!?\n]/).map(clean).filter(Boolean);
  if (segs.length < 3) return false;
  const freq = new Map();
  for (const s of segs) freq.set(s, (freq.get(s) || 0) + 1);
  const maxShare = Math.max(...freq.values()) / segs.length;
  return maxShare <= 0.5 && freq.size >= 3;
}

// 代码 / 日志 / 表格 / hex 的快排豁免：这些结构天然大量重复，不该走周期与塌缩判定。
// 只拦 period / rune / collapse / ritual，tail（整句重复）仍然生效——真的复读代码也要抓。
export function isCodeish(s) {
  const t = String(s);
  if (/\`\`\`/.test(t)) return true;
  let score = 0;
  if (/=>|\bconst\s+\w+\s*=|\bfunction\s*\w*\s*\(|\bimport\s+.+from\b|\bclass\s+\w+|\bdef\s+\w+\s*\(/.test(t)) score += 2;
  if (/(^|\n)\s*[{}();]+\s*(\n|$)/.test(t)) score += 1;
  if ((t.match(/(^|\n)[A-Za-z_][\w.\-]{0,40}\s*[=:]\s*\S/g) || []).length >= 2) score += 2; // 两行以上 key=value / 日志
  if (/[0-9a-fA-F]{32,}/.test(t)) score += 1;
  if ((t.match(/^\s*\|.*\|\s*$/gm) || []).length >= 2) score += 1;
  if ((t.match(/^\s*(select|insert|update|delete|create|alter|drop)\b/gim) || []).length >= 2) score += 2;
  return score >= 2;
}

export function tailPhrases(s) {
  const list = sentences(s).filter((x) => x.trim());
  return list
    .slice(-6)
    .map((t) => {
      const c = clean(t);
      return c.slice(-Math.min(CONFIG.tailLenMax, c.length));
    })
    .filter((p) => p.length >= CONFIG.tailLenMin);
}

// 字级 ABAB 周期检测（窗口放宽到 120 字；末尾标点先剥掉，否则"我在想，"×8 + "。" 会断掉周期）
export function periodOf(s) {
  if (isCodeish(s)) return 0; // 代码/表格/hex 不做周期判定（2026-11-06 元宝：技术文本误报主因）
  const c = clean(s).replace(/[。！？.!?，,；;、：:]+$/, '').slice(-120);
  const arr = [...c]; // 按 code point 比较，emoji 不会被劈成两半（千问评审）
  for (let p = 2; p <= CONFIG.periodMax; p++) {
    if (arr.length < p * 3) continue;
    let ok = true;
    for (let i = p; i < arr.length && ok; i++) {
      if (arr[i] !== arr[i - p]) ok = false;
    }
    if (ok) return p;
  }
  return 0;
}

// 回收率 + 唯一片段占比
export function recycleStats(s) {
  let c = clean(s);
  if (c.length > CONFIG.recycleMaxChars) c = c.slice(-CONFIG.recycleMaxChars); // 尾部 8K 足够判周期，避免 2.5 万个窗口串
  if (c.length < CONFIG.window * 2) return { r: 0, u: 1 };
  const wins = [];
  for (let i = 0; i + CONFIG.window <= c.length; i += Math.floor(CONFIG.window / 2)) {
    wins.push(c.slice(i, i + CONFIG.window));
  }
  const uniq = new Set(wins);
  const freq = {};
  wins.forEach((w) => { freq[w] = (freq[w] || 0) + 1; });
  const maxFreq = Math.max(...Object.values(freq));
  return { r: maxFreq / wins.length, u: uniq.size / wins.length };
}

// 步骤/枚举同构：各句主干高度一致（抓"第一步…第二步…"式复读）
// 只在文本里真有序号词时才启用，否则"主语相同的三句话"会被误判成循环
export function isStepLoop(s) {
  const src = String(s);
  if (!/第[一二三四五六七八九十百零\d]+[步条点章节项]|^\s*[\d①-⑩]+[、.．)）]/m.test(src)) return false;
  const segs = sentences(src).map(clean).filter(Boolean);
  if (segs.length < 3) return false;
  const heads = segs.map((x) => x.replace(/^[^\u4e00-\u9fa5a-z0-9]{0,4}([\u4e00-\u9fa5a-z0-9]{2,}).*$/, '$1'));
  const core = heads.map((h) => h.slice(0, 4));
  const same = core.filter((c) => c === core[0]);
  return same.length >= 3 && core[0].length >= 2;
}

/**
 * 仪式串检测（2026-11-06）：同一短句在尾部反复出现，例如「（执行）」×40、「**做**」×112。
 * 这是长 CoT 退化的典型形态：句子越来越短、内容越来越空、同一个标记反复出现。
 * 只看尾部 ritualTail 字，要求出现次数 >= ritualCount，避免把「正常列举」误杀。
 */
export function ritualStats(text, opts = {}) {
  const tail = Number(opts.tail ?? CONFIG.ritualTail);
  const minCount = Number(opts.minCount ?? CONFIG.ritualCount);
  const maxSeg = Number(opts.maxSeg ?? CONFIG.ritualSegMax);
  const s = String(text).slice(-tail);
  // 先剥掉围栏代码块，免得代码行被切成「短句」凑数（元宝评审）
  const body = s.replace(/\`\`\`[\s\S]*?\`\`\`/g, ' ');
  const segs = body
    .split(/[\n。！？!?；;]+/)
    .map((x) => x.trim().replace(/\s+/g, ''))
    .filter((x) => x.length >= 1 && x.length <= maxSeg);
  // count 统一语义 = 最高频片段的出现次数（旧版未命中时返回片段总数，调用方会读串）
  const freq = new Map();
  for (const seg of segs) freq.set(seg, (freq.get(seg) || 0) + 1);
  const [seg, count] = [...freq.entries()].sort((a, b) => b[1] - a[1])[0] || ['', 0];
  return { hit: count >= minCount, seg, count, total: segs.length };
}

/**
 * 流中/落盘用的「强信号」判定（2026-11-06）。
 * 只用两条不容易误杀的信号，避免 detect() 的 collapse/rune:2/period 在技术文本上误伤：
 *   ① 仪式串：同一短句在尾部反复出现
 *   ② 回收率极高且唯一度极低（整段就是同一句在转）
 * 实测 detect() 在 12 个正常块里误报 4 个（collapse:sqliteheader3=5、collapse:hmac=5、rune:2）。
 */
// 最后 6 句的整句去重数：句尾雷同但句子各不同 = 技术列举，不是复读（2026-11-06 test-tier 暴露）
function tailBodies(s) {
  const ss = sentences(s).filter((x) => x.trim()).slice(-6).map(clean);
  const n = new Set(ss).size;
  const avg = ss.length ? ss.reduce((a, x) => a + x.length, 0) / ss.length : 0;
  // 整句雷同 → 复读；或句子极短（≤8 字）也按复读算——「做。执行。做。写。」是退化不是列举
  return n <= 3 || avg <= 8;
}

export function strongLoop(text, opts = {}) {
  const short = !!opts.short; // 聊天档：门槛抬高，只拦「一眼就是坏」的
  const reasons = [];
  const ritual = ritualStats(text);
  const { r, u } = recycleStats(text);
  const ritualMin = short ? CONFIG.chatRitualCount : CONFIG.ritualCount;
  const rMin = short ? CONFIG.chatRecycle : CONFIG.recycleStrong;
  const uMax = short ? CONFIG.chatUnique : CONFIG.uniqueStrong;
  // 流中熔断也要过排比豁免，否则误杀长排比；但高回收率不享受豁免（多轮循环）
  if (isExempt(text) && !(r >= rMin && u < uMax)) return { loop: false, reasons, r, u, ritual };
  if (ritual.hit && ritual.count >= ritualMin) reasons.push(`ritual:${ritual.seg}x${ritual.count}`);
  if (r >= rMin && u < uMax) reasons.push(`recycle:${r.toFixed(2)}`);
  // ③ 尾句同构：最后 6 句里同尾 ≥N（长句周期 20+ 字时 recycleStats 的 16 字窗口对不齐）
  if (!isCodeish(text)) {
    const tp = tailPhrases(text);
    const tf = new Map();
    tp.forEach((x) => tf.set(x, (tf.get(x) || 0) + 1));
    const [tseg, tcnt] = [...tf.entries()].sort((a, b) => b[1] - a[1])[0] || ['', 0];
    const tMin = short ? CONFIG.chatTailCount : CONFIG.tailStrongCount;
    if (tcnt >= tMin && tseg.length >= 2 && tailBodies(text)) {
      reasons.push(`tail:${tseg}x${tcnt}`);
      return { loop: true, reasons, r, u, ritual, short }; // 命中直接熔断，不必再攒
    }
  }
  return { loop: reasons.length > 0, reasons, r, u, ritual, short };
}

/**
 * 各子规则独立打分（2026-11-06 千问评审：只记最终理由看不出是哪条误伤）。
 * 返回 scores 每一项都是「该规则的原始强度」，不是布尔：
 *   period=周期长度, rune=重复片段长度, tail=重复句尾次数, recycle=回收率 r,
 *   collapse=尾部最高频词次数, ritual=最高频短句次数, frag=碎片最高重复次数,
 *   step=步骤同构是否命中, exempt=是否被判排比豁免, codey=是否像代码/日志。
 */
export function ruleScores(chunk, opts = {}) {
  const short = !!opts.short; // 聊天档：短回复只在极端形态下才判
  const text = String(chunk);
  const c = clean(text);
  const codey = isCodeish(text);
  const reasons = [];
  const scores = { period: 0, rune: 0, tail: 0, recycle: 0, unique: 1, collapse: 0, ritual: 0, frag: 0, step: 0 };

  // 1) 周期
  const p = periodOf(text);
  if (p) {
    const chars = [...c];
    const uniqRatio = new Set(chars).size / Math.max(1, chars.length);
    scores.period = p;
    if (!short && p <= CONFIG.periodSoloMax && uniqRatio <= CONFIG.periodSoloUniq) reasons.push(`period:${p}`);
    else if (!short) reasons.push(`period-weak:${p}`);
  }

  // 2) 连续片段重复
  if (!codey && !short) {
    const rune = c.slice(-CONFIG.window * 3);
    for (let k = 2; k <= CONFIG.window; k++) {
      const pat = rune.slice(-k * CONFIG.runeRepeat);
      if (pat.length < k * CONFIG.runeRepeat) break;
      const unit = pat.slice(0, k);
      if (pat === unit.repeat(CONFIG.runeRepeat)) { scores.rune = k; reasons.push(`rune:${k}`); break; }
    }
  }

  // 3) 句尾同短语
  const tails = tailPhrases(text);
  const tc = {};
  tails.forEach((t) => { tc[t] = (tc[t] || 0) + 1; });
  const repeated = Object.entries(tc).filter(([, v]) => v >= CONFIG.tailPhrase).sort((a, b) => b[1] - a[1])[0];
  scores.tail = repeated ? repeated[1] : 0;
  const kvLine = repeated && /^[A-Za-z_][\w.\-]*\s*[=:]/.test(repeated[0]);
  if (repeated && !kvLine && !short && tailBodies(text)) reasons.push('tail');

  // 4) 回收率 + 唯一度
  const { r, u } = recycleStats(text);
  scores.recycle = r;
  scores.unique = u;
  if (short ? r >= CONFIG.chatRecycle && u < CONFIG.chatUnique : r >= CONFIG.recycleMax && u < CONFIG.uniqueMin)
    reasons.push(`recycle:${r.toFixed(2)}`);

  // 5) 塌缩
  const words = (c.match(/[\p{L}\p{N}]{2,}/gu) || []);
  const tailWords = words.slice(-40);
  const tf = {};
  tailWords.forEach((w) => { tf[w] = (tf[w] || 0) + 1; });
  const top = Object.entries(tf).sort((a, b) => b[1] - a[1])[0] || ['', 0];
  const uniqAll = new Set(words).size;
  const collapseMin = short ? CONFIG.chatCollapse : 5;
  if (!codey && tailWords.length >= 12 && top[1] >= collapseMin && uniqAll >= 8 && top[0].length >= 2) {
    scores.collapse = top[1];
    reasons.push(`collapse:${top[0]}=${top[1]}`);
  }

  // 5.5) 碎片重复（逗号切成的小段里同一段反复出现）
  const frags = text.split(/[，,、。；;！？!?\n]/).map(clean).filter((x) => x.length >= 2 && x.length <= CONFIG.fragSegMax);
  if (!codey && frags.length >= 4) {
    const ff = new Map();
    for (const x of frags) ff.set(x, (ff.get(x) || 0) + 1);
    const [fseg, fcnt] = [...ff.entries()].sort((a, b) => b[1] - a[1])[0];
    const fragMin = short ? CONFIG.chatFragMin : 4;
    const fragShare = short ? 0.6 : 0.5;
    if (fcnt >= fragMin && fcnt / frags.length >= fragShare) {
      scores.frag = fcnt;
      reasons.push(`frag:${fseg}x${fcnt}`);
    }
  }

  // 6) 仪式串
  const ritual = ritualStats(text);
  if (ritual.hit && (!short || ritual.count >= CONFIG.chatRitualCount)) {
    scores.ritual = ritual.count;
    reasons.push(`ritual:${ritual.seg}x${ritual.count}`);
  }

  // 7) 步骤同构 + 排比豁免
  // 豁免要在「高回收率」面前让路：A,B,C,A,B,C 这种三轮循环每段占比都不到 50%，
  // 旧逻辑会当成排比放过（2026-11-06 分档测试暴露）
  const exempt = isExempt(text) && !(r >= CONFIG.recycleMax && u < CONFIG.uniqueMin);
  const step = isStepLoop(text);
  scores.step = step ? 1 : 0;
  scores.exempt = exempt ? 1 : 0;
  scores.codey = codey ? 1 : 0;

  return { reasons, scores, r, u, p, codey, exempt, step, ritual, chars: text.length };
}

export function detect(chunk, opts = {}) {
  const res = ruleScores(chunk, opts);
  const { reasons, r, u, p, exempt, step, codey } = res;
  // isStepLoop 以前是「||」短路，绕过排比豁免——「第一/第二/第三…」的排比文会被判死循环（豆包/千问评审）。
  const strong = reasons.filter((x) => !x.startsWith('period-weak:'));
  const loop = (strong.length > 0 && !exempt) || (!exempt && step);
  return { loop, reasons, r, u, p, chars: res.chars, codey, scores: res.scores, short: !!opts.short };
}

// 截断：保留开头 + 认输句
export function truncate(chunk, keepHead = CONFIG.keepHead) {
  return String(chunk).slice(0, keepHead) + YIELD_TEXT;
}

export const YIELD = YIELD_TEXT;

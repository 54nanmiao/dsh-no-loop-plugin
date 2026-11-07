// dsh-no-loop：防复读 / 防自指循环（v2 —— 真·流中熔断）
//
// v2 变化（2026-10-29）：原来写的「插件没有流式钩子」是错的。
// DSH 的 LLM 调用走 `llm/stream` waterfall，插件可以挂：
//     ctx.on('llm/stream', (options, next) => ...)
// 返回一个 async iterable，里面是这些 chunk：
//     block-start | text-delta | reasoning-delta | tool-call-delta | block-end | usage | finish
// ReasoningBlock = { type: 'reasoning', text: string }
//
// 所以现在做三件事：
//   1. 流中拦截 reasoning-delta，边攒边判；命中就停止转发后续 reasoning（界面不会再刷屏）
//   2. 命中后把该块的 block-end 文本换成截断版，**防止复读被写进会话历史**
//      —— 这一点比界面上不刷屏更重要：日志里的复读会污染下一轮上下文，自我强化
//   3. 保留 loop__check / loop__reset 工具与提示词纪律

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect, truncate, CONFIG, isStepLoop, recycleStats, ritualStats, strongLoop, ruleScores, YIELD } from './detector.mjs';

// 命中样本落盘：线上行为一点不改，只在命中时多写两个文件（2026-11-06 三家评审的共同要求）
const HERE = path.dirname(fileURLToPath(import.meta.url));
// 数据目录在调用时解析：测试可用 NO_LOOP_DATA_DIR 指到临时目录，避免污染真实 halt.log
const dataDir = () => (process.env.NO_LOOP_DATA_DIR ? path.resolve(process.env.NO_LOOP_DATA_DIR) : path.join(HERE, 'data'));

/** 内容类型指纹：一眼分清「真复读」和「代码/表格/日志/正常长文」 */
export function contentStats(t) {
  const text = String(t ?? '');
  const lines = text.split('\n').filter((l) => l.trim());
  const n = Math.max(1, lines.length);
  const ratio = (re) => Number((lines.filter((l) => re.test(l)).length / n).toFixed(3));
  return {
    codeFence: /\`\`\`/.test(text) ? 1 : 0,
    codeLine: ratio(/[{};]|=>|\b(function|const|let|var|return|import|export|def|class)\b/),
    tableRow: ratio(/^\s*\|.*\|\s*$/),
    hex: /[0-9a-fA-F]{32,}/.test(text) ? 1 : 0,
    kvLine: ratio(/^\s*[A-Za-z_][\w.\-]*\s*[=:]\s*\S/),
    cjk: Number(((text.match(/[\u4e00-\u9fa5]/g) || []).length / Math.max(1, text.length)).toFixed(3)),
    lines: lines.length,
  };
}

/** 前 3 个高频碎片原文——只记次数没用，要能看见「重复的到底是什么」 */
export function topFrags(t, k = 3) {
  const segs = String(t ?? '').split(/[，,、。；;！？!?\n]/).map((x) => x.replace(/\s+/g, '')).filter((x) => x.length >= 2 && x.length <= 14);
  const m = new Map();
  for (const x of segs) m.set(x, (m.get(x) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([seg, count]) => ({ seg, count }));
}

/** 命中时写一行 JSON + 一份原文样本；任何异常都吞掉，绝不影响主流程 */
export function logHalt({ sid, block, tag = '', text, reasons, r, u, probe }) {
  try {
    const DIR = dataDir();
    const HALT_LOG = path.join(DIR, 'halt.log');
    const SAMPLE_DIR = path.join(DIR, 'samples');
    fs.mkdirSync(SAMPLE_DIR, { recursive: true });
    // 日志超过 5MB 就轮转一份，避免无限长
    try {
      if (fs.statSync(HALT_LOG).size > 5 * 1024 * 1024) fs.renameSync(HALT_LOG, HALT_LOG + '.1');
    } catch { /* 文件还不存在 */ }
    const t = String(text ?? '');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const name = `${stamp}_${String(sid || 'nosid').slice(-8)}_b${block}.txt`;
    fs.writeFileSync(path.join(SAMPLE_DIR, name), t, 'utf8');
    const rs = ruleScores(String(probe ?? t));
    fs.appendFileSync(
      HALT_LOG,
      JSON.stringify({
        ts: new Date().toISOString(),
        sid: String(sid || ''),
        block,
        tag,
        tier: t.length < CONFIG.chatMax ? 'chat' : 'long',
        reasons,
        scores: rs.scores,
        chars: t.length,
        r: Number(Number(r).toFixed(3)),
        u: Number(Number(u).toFixed(3)),
        content: contentStats(t),
        topFrags: topFrags(t),
        tail: t.slice(-800),
        sample: name,
      }) + '\n',
      'utf8',
    );
  } catch (e) {
    console.error('[no-loop] 写 halt.log 失败（忽略）：', e?.message ?? e);
  }
}

export const name = 'dsh-no-loop';
export const inject = ['tools'];

/** 攒够这么多字才开始判（太短会误判） */
const MIN_PROBE = 80;
/** 每多攒这么多字判一次（避免每个 delta 都跑 n-gram） */
const PROBE_STEP = 40;
/** 判定时只看尾部这么多字 */
const PROBE_TAIL = 4000;
/** 流中仪式串判定的最小出现次数：比终判松一档，先掐住界面刷屏 */
const RITUAL_LIVE_MIN = 6;
/** 至少要攒这么多字才做仪式串判定，避免短块误伤 */
const RITUAL_MIN_CHARS = 600;

// —— 会话隔离的状态（2026-11-06 三方评审）——
// 旧版 STATE 是模块级单例：A 会话打转 2 次，B 会话第 1 次就吃满 maxStrike=3。
// 现在按会话 id 分开计数，6 小时没动静就清掉，避免 Map 无限长。
const MAX_SLOT = 200_000;                       // 单块 reasoning 最多留这么多字，超了砍中段
const SESSION_TTL = 6 * 60 * 60 * 1000;

function newState() {
  return { strikes: 0, lastAt: 0, haltedBlocks: 0, lastHit: null };
}

/** 无会话 id 时的默认计数（保留给旧导出与 loop__check 的兜底） */
const STATE = newState();
const SESSIONS = new Map();

export function stateOf(sid) {
  const now = Date.now();
  if (SESSIONS.size > 32) {
    for (const [k, v] of SESSIONS) if (now - v.at > SESSION_TTL) SESSIONS.delete(k);
  }
  if (!sid) return STATE;
  let e = SESSIONS.get(sid);
  if (!e) { e = { state: newState(), at: now }; SESSIONS.set(sid, e); }
  e.at = now;
  return e.state;
}

// 单块文本上限：reasoning 动辄几十万字，全留会吃内存；block-end 只用尾部截断，砍中段不影响判定
function capText(t) {
  if (t.length <= MAX_SLOT) return t;
  const head = 400;
  return t.slice(0, head) + '\n…\n' + t.slice(t.length - (MAX_SLOT - head));
}

const RULE = [
  '【防循环纪律 · 强制】',
  '- 每次工具返回之后，第一句话必须是「刚才那步具体做了什么、拿到了什么」，要能读出数字/文件名/结果。禁止用"做""执行""写""好"这类空词代替真实动作描述。',
  '- 一次工具调用干多件事；不要"跑一条命令→看一眼→再跑一条"地挤牙膏。',
  '- 思考段只写一句人话，不写计划段落。如果你发现自己在用极短的空词句（单字动词加句号）串联推进步骤，那就是循环的前兆，立刻换成人话。',
  '- 发现自己连续两三句在重复同一种句式或同一个词，立刻换说法；换不了就直接收尾。',
  '- 说数字/时间/进度之前先分清来源：刚跑命令的实时值 / 日志里的历史快照 / 自己的推算。后两种不许当成"现在"。',
].join('\n');

/**
 * 包一层 stream：拦住 reasoning 的复读。
 * 任何异常都退回原样透传，绝不让这个插件把模型调用搞挂。
 * opts: { sid, minProbe, probeStep, probeTail, ritualMinChars }
 */
async function* guardStream(upstream, opts = {}) {
  const minProbe = Number(opts.minProbe ?? MIN_PROBE);
  const probeStep = Number(opts.probeStep ?? PROBE_STEP);
  const probeTail = Number(opts.probeTail ?? PROBE_TAIL);
  const ritualMinChars = Number(opts.ritualMinChars ?? RITUAL_MIN_CHARS);
  const st = stateOf(String(opts.sid ?? '') || '');
  const slots = new Map(); // index -> { text, halted, lastProbe, checkedEnd }

  const halt = ({ idx, why, text, r, u, tag = '', probe }) => {
    st.strikes += 1;
    st.haltedBlocks += 1;
    st.lastAt = Date.now();
    st.lastHit = { reasons: why, chars: String(text ?? '').length, r, u };
    console.error(
      `[no-loop] HALT${tag} block=${idx} 理由=${why.join('/')} 攒了 ${String(text ?? '').length} 字 r=${r.toFixed(2)} u=${u.toFixed(2)}`,
    );
    logHalt({ sid: opts.sid, block: idx, tag, text, reasons: why, r, u, probe });
  };

  try {
    for await (const chunk of upstream) {
      if (!chunk || typeof chunk !== 'object') {
        yield chunk;
        continue;
      }

      if (chunk.type === 'reasoning-delta') {
        const idx = chunk.index ?? 0;
        let slot = slots.get(idx);
        if (!slot) {
          slot = { text: '', halted: false, lastProbe: 0 };
          slots.set(idx, slot);
        }
        if (slot.halted) continue; // 已熔断：这一段后面全部丢掉

        slot.text = capText(slot.text + String(chunk.text ?? ''));

        if (slot.text.length >= minProbe && slot.text.length - slot.lastProbe >= probeStep) {
          slot.lastProbe = slot.text.length;
          try {
            const probe = slot.text.length > probeTail ? slot.text.slice(-probeTail) : slot.text;
            // 流中只认强信号（仪式串/回收率），且要攒够 ritualMinChars；detect() 的
            // collapse/rune 在技术文本（hmac、sqlite header）上会误杀，这里不用。
            const short = slot.text.length < CONFIG.chatMax; // 聊天档：短回复只在极端形态下才拦
            const d = slot.text.length >= ritualMinChars ? strongLoop(probe, { short }) : { loop: false, reasons: [], r: 0, u: 1 };
            if (d.loop) {
              slot.halted = true;
              halt({ idx, why: d.reasons, text: slot.text, r: d.r, u: d.u, probe });
              continue; // 这个 delta 也不转发了
            }
          } catch (e) {
            console.error('[no-loop] detect 出错（放行）：', e?.message ?? e);
          }
        }

        yield chunk;
        continue;
      }

      if (chunk.type === 'block-end') {
        const idx = chunk.index ?? 0;
        const slot = slots.get(idx);
        if (slot?.halted) {
          // 关键：把落盘的那份也换成截断版，否则复读会进历史、下一轮自我强化
          const kept = truncate(slot.text);
          slots.delete(idx);
          yield { ...chunk, block: { type: 'reasoning', text: kept } };
          continue;
        }
        // 收尾终判：短复读可能没攒到 minProbe，这里补一刀
        if (slot && !slot.checkedEnd) {
          slot.checkedEnd = true;
          try {
            const d = strongLoop(slot.text, { short: slot.text.length < CONFIG.chatMax });
            if (d.loop) {
              halt({ idx, why: d.reasons, text: slot.text, r: d.r, u: d.u, tag: '(终判)' });
              const kept = truncate(slot.text);
              slots.delete(idx);
              yield { ...chunk, block: { type: 'reasoning', text: kept } };
              continue;
            }
          } catch (e) {
            console.error('[no-loop] 终判出错（放行）：', e?.message ?? e);
          }
        }
        slots.delete(idx);
        yield chunk;
        continue;
      }

      yield chunk;
    }
  } finally {
    slots.clear(); // 旧版 Map 永不清理，长会话里会一直涨
  }
}

export function apply(ctx, config = {}) {
  const disposers = [];
  const tools = ctx.get?.('tools');
  // 配置真正往下传（旧版 apply(ctx, config) 收了 config 却没人用）
  const STREAM_OPTS = {
    minProbe: Number(config.minProbe ?? MIN_PROBE),
    probeStep: Number(config.probeStep ?? PROBE_STEP),
    probeTail: Number(config.probeTail ?? PROBE_TAIL),
    ritualMinChars: Number(config.ritualMinChars ?? RITUAL_MIN_CHARS),
  };

  // ---- 工具：手动检测（保留，给"输出前自查"用） ----
  if (tools?.register) {
    disposers.push(
      tools.register({
        name: 'loop__check',
        description:
          '检测一段文本是否陷入复读/自指循环。输出前自查用，或怀疑自己打转时调用。返回是否打转、命中理由、以及截断建议。',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', minLength: 1, maxLength: 20000, description: '要检测的文本（通常是即将输出的内容）' },
            mode: {
              type: 'string',
              enum: ['report', 'truncate'],
              description: 'report=只报告（默认）；truncate=报告并给出截断后的版本',
            },
          },
          required: ['text'],
          additionalProperties: false,
        },
        output: {
          schema: {
            type: 'object',
            properties: { content: { type: 'string' }, isError: { type: 'boolean' } },
            required: ['content', 'isError'],
            additionalProperties: false,
          },
          render: (_a, v) => [{ type: 'text', text: v.content }],
        },
        async execute(args, tctx) {
          try {
            const st = stateOf(String(tctx?.sessionId ?? tctx?.session?.id ?? '') || '');
            const text = String(args?.text ?? '');
            if (!text.trim()) return { content: '文本为空，没有可检测的内容。', isError: true };
            const d = detect(text, { short: text.length < CONFIG.chatMax });
            const lines = [];
            lines.push(
              d.loop
                ? `判打转（理由：${d.reasons.join('、')}）`
                : `没打转（回收率 ${d.r.toFixed(2)}、唯一度 ${d.u.toFixed(2)}）`,
            );
            lines.push(`长度 ${d.chars} 字，硬上限 ${CONFIG.hardChars} 字`);
            if (d.loop) {
              st.strikes += 1;
              st.lastAt = Date.now();
              lines.push(
                st.strikes >= CONFIG.maxStrike
                  ? `本轮已第 ${st.strikes} 次打转 → 建议直接收尾，不要再展开。`
                  : `本轮第 ${st.strikes} 次打转 → 建议换说法重写，或截断。`,
              );
              // 豆包评审：只给一句固定话术帮助不大，给出可选动作
              lines.push('可选动作：① stop —— 直接收尾；② restate —— 用一句话复述已确认的结论；③ switch_tool —— 换一个工具/换一种查法再试。');
              if (args?.mode === 'truncate' || d.chars > CONFIG.hardChars) {
                lines.push(`截断版（前 ${CONFIG.keepHead} 字 + 收尾）：\n${truncate(text)}`);
              }
            }
            return { content: lines.join('\n'), isError: false };
          } catch (e) {
            return { content: `检测失败：${e.message}`, isError: true };
          }
        },
      }),
    );

    disposers.push(
      tools.register({
        name: 'loop__reset',
        description: '把防循环计数清零。换话题、开新任务、或刚被提醒过之后调用。',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        output: {
          schema: {
            type: 'object',
            properties: { content: { type: 'string' }, isError: { type: 'boolean' } },
            required: ['content', 'isError'],
            additionalProperties: false,
          },
          render: (_a, v) => [{ type: 'text', text: v.content }],
        },
        async execute(_args, tctx) {
          const st = stateOf(String(tctx?.sessionId ?? tctx?.session?.id ?? '') || '');
          const n = st.strikes;
          st.strikes = 0;
          return { content: `计数已清零（之前 ${n} 次）。`, isError: false };
        },
      }),
    );
  }

  // ---- 核心：llm/stream waterfall 上挂流中熔断 ----
  //
  // ⚠️ 2026-10-29 02:45 事故后默认关闭。
  // 现象：宿主报「本轮运行失败 stream is not async iterable」，整个回合零输出。
  // 根因（第一版）：监听器写成 `async (options, next) => {...}`，宿主拿到的返回值是
  // Promise 而不是 AsyncIterable，`for await` 直接抛错。第二版改成同步返回已修好，
  // 但包 stream 这件事本身仍有风险面（上游迭代中途抛错无法回放）。
  // 所以默认关掉，只保留 loop__check 工具 + 提示词纪律这两样零风险的。
  // 想重新启用：把下面这行改成 true，重启 DSH，然后开一个新会话观察一两轮。
  const ENABLE_STREAM_GUARD = config.streamGuard !== false;
  if (ENABLE_STREAM_GUARD && typeof ctx.on === 'function') {
    try {
      // 必须同步返回：cordis 的 waterfall 是纯同步的（cordis/lib/index.js:317-325，
      // next() 直接 return 最外层监听器的返回值，任何 await 都不会被等），
      // 一旦这里写成 async，宿主拿到的就是 Promise 而不是 AsyncIterable，
      // for await 立刻抛 "stream is not async iterable"，整个回合零输出。
      const off = ctx.on('llm/stream', (options, next) => {
        const upstream = next();
        if (!upstream || typeof upstream[Symbol.asyncIterator] !== 'function') {
          return upstream; // 上游不是流（或本身就是 Promise），原样放行
        }
        const o = options && typeof options === 'object' ? options : {};
        const sid = String(o.sessionId ?? o.session?.id ?? o.context?.sessionId ?? '') || '';
        try {
          return guardStream(upstream, { ...STREAM_OPTS, sid });
        } catch {
          return upstream; // 包不起来就原样放行
        }
      });
      if (typeof off === 'function') disposers.push(off);
    } catch (e) {
      console.error('[no-loop] 挂 llm/stream 失败（只保留工具）：', e?.message ?? e);
    }
  }

  // ---- 系统提示词：常驻纪律 ----
  if (config.rule !== false) {
  try {
    const registerSection = (sp) => {
      if (!sp?.section) return;
      return sp.section({
        name: 'dsh-no-loop:rule',
        order: 9450,
        text: () => RULE,
      });
    };
    const off =
      typeof ctx.inject === 'function'
        ? ctx.inject(['systemPrompt'], (scoped) => registerSection(scoped?.systemPrompt))
        : registerSection(ctx.get?.('systemPrompt'));
    if (typeof off === 'function') disposers.push(off);
  } catch {
    /* 没有 systemPrompt 服务就只保留工具与拦截 */
  }
  }

  return () => disposers.forEach((d) => d?.());
}

export { detect, truncate, isStepLoop, recycleStats, YIELD, CONFIG, STATE, SESSIONS, guardStream };

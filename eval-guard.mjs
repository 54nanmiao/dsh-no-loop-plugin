#!/usr/bin/env node
// 防循环插件「误杀」离线评估：只读 data\halt.log 与 data\samples，不改线上行为。
// 用法：
//   node eval-guard.mjs                 报表（按理由分层、内容指纹、进度）
//   node eval-guard.mjs --pick 30       分层抽 30 条写 review-<stamp>.csv（expected 待填）
//   node eval-guard.mjs --score review-x.csv   填完 expected 后算每类误杀率 + Wilson 区间
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, 'data');
const LOG = path.join(DATA, 'halt.log');
const SAMPLE_DIR = path.join(DATA, 'samples');
const TARGET = 500; // 千问给的样本目标；元宝说 100 条就能出方向

const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 ? (argv[i + 1] ?? true) : d; };
const since = String(arg('--since', '') || '').replace(/d$/, '');
const sinceMs = since ? Date.now() - Number(since) * 86400e3 : 0;
const pickN = Number(arg('--pick', 0)) || 0;
const scoreFile = arg('--score', null);
const asJson = argv.includes('--json');

function readLog() {
  if (!fs.existsSync(LOG)) return [];
  return fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean).filter((r) => !sinceMs || Date.parse(r.ts) >= sinceMs);
}

const ruleOf = (r) => String((r.reasons || [])[0] || '').split(':')[0] || '?';
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pct = (a, q) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
function wilson(k, n) {
  if (!n) return [0, 0];
  const p = k / n, z = 1.96;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

// 结构化数据占比高 = 误杀高危；这是三家都点名的「先做内容类型快排」
function suspicious(r) {
  const c = r.content || {}, s = r.scores || {};
  const tags = [];
  if (s.codey >= 2) tags.push('codey');
  if (c.codeFence) tags.push('fence');
  if ((c.tableRow || 0) > 0.3) tags.push('table');
  if (c.hex) tags.push('hex');
  if ((c.kvLine || 0) > 0.3) tags.push('kv');
  return tags;
}

function report(rows) {
  const byRule = new Map();
  for (const r of rows) {
    const k = ruleOf(r);
    if (!byRule.has(k)) byRule.set(k, []);
    byRule.get(k).push(r);
  }
  const out = {
    total: rows.length,
    sessions: new Set(rows.map((r) => r.sid)).size,
    since: since ? since + 'd' : 'all',
    progress: { target: TARGET, have: rows.length, pct: Number(((rows.length / TARGET) * 100).toFixed(1)) },
    rules: [...byRule.entries()].sort((a, b) => b[1].length - a[1].length).map(([rule, list]) => ({
      rule,
      n: list.length,
      share: Number((list.length / Math.max(1, rows.length)).toFixed(3)),
      chars_med: pct(list.map((r) => r.chars || 0), 0.5),
      r_mean: Number(mean(list.map((r) => Number(r.r) || 0)).toFixed(3)),
      u_mean: Number(mean(list.map((r) => Number(r.u) || 0)).toFixed(3)),
      suspect: list.filter((r) => suspicious(r).length).length,
      top_tags: (() => { const m = new Map(); for (const r of list) for (const t of suspicious(r)) m.set(t, (m.get(t) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4); })(),
    })),
    suspectTotal: rows.filter((r) => suspicious(r).length).length,
    topFrags: (() => {
      const m = new Map();
      for (const r of rows) for (const f of r.topFrags || []) m.set(f.seg, (m.get(f.seg) || 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    })(),
    newest: rows.length ? rows[rows.length - 1].ts : null,
  };
  return out;
}

function pick(rows, n) {
  // 按理由分层轮转抽样，避免被高频理由带偏（豆包/元宝都提过）
  const groups = new Map();
  for (const r of rows) {
    const k = ruleOf(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const keys = [...groups.keys()];
  const res = [];
  let i = 0;
  while (res.length < n && keys.length) {
    let added = false;
    for (const k of keys) {
      const g = groups.get(k);
      if (i < g.length && res.length < n) { res.push(g[i]); added = true; }
    }
    i += 1;
    if (!added) break;
  }
  return res;
}

function writeReview(rows, n) {
  const cs = ['ts', 'sid', 'block', 'rule', 'chars', 'r', 'u', 'codey', 'fence', 'table', 'expect', 'note', 'sample'];
  const body = pick(rows, n).map((r) => ['ts', 'sid', 'block'].length && [
    r.ts, r.sid, r.block, ruleOf(r), r.chars, r.r, r.u,
    (r.scores || {}).codey ?? '', (r.content || {}).codeFence ?? '', (r.content || {}).tableRow ?? '',
    '', '', r.sample,
  ].map((v) => String(v ?? '').replace(/[",\n]/g, ' ')).join(','));
  const file = path.join(DATA, `review-${new Date().toISOString().slice(0, 19).replace(/[:]/g, '')}.csv`);
  fs.writeFileSync(file, [cs.join(','), ...body].join('\n'), 'utf8');
  return { file, n: body.length };
}

function score(file) {
  const txt = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  const head = txt[0].split(',');
  const idx = (k) => head.indexOf(k);
  const rows = txt.slice(1).map((l) => { const c = l.split(','); const o = {}; head.forEach((h, i) => (o[h] = c[i])); return o; });
  const done = rows.filter((r) => r.expect && r.expect.trim());
  const byRule = new Map();
  for (const r of done) {
    if (!byRule.has(r.rule)) byRule.set(r.rule, []);
    byRule.get(r.rule).push(r);
  }
  return {
    annotated: done.length, total: rows.length,
    rules: [...byRule.entries()].map(([rule, list]) => {
      const fp = list.filter((r) => /false|误杀|fp|0/i.test(r.expect)).length;
      const [lo, hi] = wilson(fp, list.length);
      return { rule, n: list.length, falsePositive: fp, fpRate: Number((fp / list.length).toFixed(3)), ci95: [Number(lo.toFixed(3)), Number(hi.toFixed(3))] };
    }),
  };
}

const rows = readLog();
let out;
if (scoreFile) out = score(String(scoreFile));
else if (pickN) out = { ...report(rows), review: writeReview(rows, pickN) };
else out = report(rows);

if (asJson) console.log(JSON.stringify(out, null, 2));
else {
  if (out.annotated !== undefined) {
    console.log(`已标注 ${out.annotated}/${out.total} 条\n${'理由'.padEnd(10)} n   误杀  比例    95%CI`);
    for (const r of out.rules) console.log(`${r.rule.padEnd(12)} ${String(r.n).padEnd(4)} ${String(r.falsePositive).padEnd(5)} ${String(r.fpRate).padEnd(7)} [${r.ci95.join(', ')}]`);
  } else {
    console.log(`命中 ${out.total} 条 / ${out.sessions} 会话（${out.since}）  目标 ${out.progress.target} 条，已攒 ${out.progress.pct}%`);
    console.log(`结构化高危（疑似误杀候选）：${out.suspectTotal} 条`);
    console.log(`${'理由'.padEnd(12)} n     占比   中位字数  r均值   u均值  高危`);
    for (const r of out.rules) console.log(`${r.rule.padEnd(14)} ${String(r.n).padEnd(5)} ${String(r.share).padEnd(6)} ${String(r.chars_med).padEnd(9)} ${String(r.r_mean).padEnd(7)} ${String(r.u_mean).padEnd(6)} ${r.suspect} ${r.top_tags.map(([t, c]) => t + ':' + c).join(' ')}`);
    if (out.topFrags.length) console.log('\n最高频重复片段：' + out.topFrags.map(([s, c]) => `${s}x${c}`).join('  '));
    if (out.review) console.log(`\n已写抽样表：${out.review.file}（${out.review.n} 条，填 expect 列后 --score 该文件）`);
    console.log(`\n最新一条：${out.newest}`);
  }
}

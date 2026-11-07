# dsh-no-loop-plugin

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）用的防复读插件：**在流式推理里发现复读与自指打转，当场截断那一段思考**。

## 它解决的是什么

长会话里模型偶尔会掉进一种打转：reasoning 开始重复同一句、同一个词、或者同一个句式几百遍。更麻烦的是 DSH 会把历史 thinking 原样发回给模型 —— 一段退化的思考会变成下一轮的"范例"，于是越滚越大，直到整个回合没有产出。

这个插件挂在 `llm/stream` 上，边收 `reasoning-delta` 边判：

- 命中 → 丢掉后续的 reasoning delta（界面不再刷屏），并把这块的 `block-end` 换成截断版 —— **这一步比"不刷屏"重要**，因为只有落盘的那份决定了下一轮会不会被回灌。
- 没命中 → 原样透传，一个字节都不改。

它不碰正文输出，不碰工具调用，任何内部异常都退回原样透传。

## 安装

```bash
dsh plugin --profile web add dsh-no-loop-plugin
```

装完**重启 DSH** 才生效（插件在宿主启动时挂载）。

已知安装坑（和 [dsh-peak-reminder](https://github.com/54nanmiao/dsh-peak-reminder) 同源）：

- `dsh plugin` 把 `add` 交给 PATH 上的 `pnpm`。桌面版自带 pnpm 但不在 PATH，会报 `'pnpm' is not recognized`。把 pnpm 加进 PATH 再装。
- pnpm 11 的 `minimumReleaseAge` 会挡住刚发布的版本、静默回落到上一个版本。想立刻装新版就显式写版本号：`add dsh-no-loop-plugin@0.2.0`。

## 配置：界面上改，不用改文件

装好后打开 DSH 的 **设置 → 防循环**，所有可调项都在那里：

| 项 | 默认 | 作用 |
|---|---|---|
| 流中熔断 | 开 | 关掉后只剩 `loop__check` 工具与提示词纪律（改完下一段生成就生效） |
| 提示词纪律 | 开 | 往系统提示词里加"发现重复 → 换说法/收尾"那段（**改这项要重启 DSH**） |
| 灵敏度 | 标准 | 宽松 / 标准 / 严格，只动"多容易算打转"的四个阈值 |
| 开始判定的字数 | 80 | 攒够这么多字才开始判；调大更省、反应更慢 |
| 判定间隔 | 40 | 之后每多攒这么多字判一次；调小更灵敏、CPU 更忙 |
| 只看尾部多少字 | 4000 | 判定窗口；循环通常紧邻结尾，一般不用改 |
| 聊天档上限 | 1200 | 整块不足这么多字＝聊天，放宽阈值，别拦正常短思考 |

改完点「保存」写进 `~/.dsh/no-loop.json`，侧边栏那行会显示今天命中了几次、当前档位。

三档灵敏度对应的阈值：

| 档位 | 回收率 recycle | 仪式串 ritual | 聊天档 recycle / ritual |
|---|---|---|---|
| 宽松 | ≥0.90 | ≥16 | ≥0.95 / ≥18 |
| 标准 | ≥0.85 | ≥12 | ≥0.92 / ≥14 |
| 严格 | ≥0.78 | ≥8 | ≥0.88 / ≥10 |

也可以直接改文件（设置面板读的就是它）：

```json
{
  "streamGuard": true,
  "rule": true,
  "sensitivity": "normal",
  "minProbe": 80,
  "probeStep": 40,
  "probeTail": 4000,
  "chatMax": 1200
}
```

宿主还开了两个只读/写口给面板用：`GET /plugins/dsh-no-loop-plugin/state`（配置 + 命中统计 + 日志路径）、`GET|POST /plugins/dsh-no-loop-plugin/config`（读 / 写上面那份 JSON，非法值会被钳到范围内）。

检测阈值集中在 `detector.mjs` 的 `CONFIG`。默认两档闸门：同一套规则，按 reasoning 块字数分档 —— **短回复放宽，长 reasoning 收紧**。

| 规则 | 严格档（长 reasoning） | 聊天档（短回复） |
|---|---|---|
| 周期 period / 单字游程 rune / 句尾 tail | 参与判定 | 不参与（短句天然对称，最易误杀） |
| 回收率 recycle | ≥0.85 且唯一度 <0.30 | ≥0.92 且唯一度 <0.15 |
| 仪式串 ritual | 同短句 ≥12 次 | ≥14 次 |
| 碎片 frag | 同段 ≥4 次且占比 ≥50% | ≥6 次且占比 ≥60% |
| 塌缩 collapse | ≥5 | ≥8 |
| 尾句同构 tail | 最后 6 句同尾 ≥4 | ≥5 |

代码块、表格、hex 串、`key=value` 日志行会被识别为"结构化内容"并快速放行（整句代码复读仍抓）。排比豁免保留，但高回收率不享受豁免 —— `A,B,C,A,B,C` 每段占比只有 1/3，旧逻辑会当排比放过。

## 它会写什么文件

命中时写两份，**只写不改判定**：

- `data/halt.log`（JSONL，超过 5 MB 轮转成 `halt.log.1`）—— 时间、会话尾号、块号、命中理由、各子规则得分、内容指纹、结尾 800 字；
- `data/samples/<时间>_<会话尾号>_b<块>.txt` —— 命中的原始思考。

默认落在插件目录下；设环境变量 `NO_LOOP_DATA_DIR` 可以改到别处。不想留痕就定期删 `data/`，或把 `streamGuard` 关掉。

## 风险与边界

- **这是文本启发式，不是证明。** 误杀的表现是：一段正常但句式重复的思考被截断，正文照常生成 —— 不会毁掉回答，但会少掉那部分推理。觉得误杀了就关 `streamGuard`，并把样本发过来。
- 只对 reasoning 生效。模型在正文里复读，它管不了。
- 它是**兜底**，不是替代纪律。写清楚"做完一步就换句式"比事后截断更治本。

## 工具

装好后模型多了两个工具：

- `loop__check({text, mode})` —— 自查一段文本是否在打转，`mode:'truncate'` 会给出截断版；
- `loop__reset()` —— 清零本会话的打转计数。

## 开发

```bash
npm test                 # 6 组回归：8 + 4 + 17 + 7 + 11 + 20 条
node eval-guard.mjs      # 读 data/halt.log，按理由分层、看误杀风险
```

改判定之前先看 `halt.log` 里真实的样本，别凭感觉调阈值。

## License

MIT

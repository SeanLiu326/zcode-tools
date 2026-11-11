# context-compaction

dsh（DeepSeek Harness）风格的 **LLM Agent 上下文压缩（compaction）** 模块，零运行时依赖，TypeScript 编写，消息结构遵循 OpenAI chat-completions 格式，可插入任何对接 OpenAI 兼容 API 的 agent。

## 机制（对齐 dsh）

- **自动压缩**：在 agent 循环的 step 边界检查上下文压力（估算 tokens / contextWindow），达到阈值（默认 **0.8**）触发压缩。
- **手动压缩**：随时可调用 `compact(messages, { trigger: 'manual', focus })`，对应 dsh 的 `/compact [focus]` 命令。
- **Compaction turn**：压缩是一次专门的 LLM 调用，只生成交接摘要（Goal / Done / Decisions / State / Next steps / Caveats），不执行任务本身；摘要语言跟随对话主语言。
- **近期保留**：按 token 预算（默认 contextWindow 的 20%）原样保留近期消息。
- **安全切分**：tool 结果永远与其 `assistant.tool_calls` 调用同组，切分点绝不落在组内（OpenAI 兼容 API 会拒绝孤儿 tool 消息）；顶部 `system` 消息永远原样保留。
- **多轮压缩**：结果中始终只有一条摘要消息，旧摘要在下次压缩时被合并进新摘要。
- **Goal 机制**（可选）：目标存放在消息历史之外，压缩永远不会丢掉它；压缩时目标会传给摘要生成器并在压缩后的历史里重新锚定一条提醒消息。
- **降级容错**：摘要调用失败自动重试（默认 2 次 + 指数退避），仍失败则降级为机械摘要（`onError: 'fallback'`，默认），压缩永不中断会话。

## 安装

```bash
npm install context-compaction   # 或直接复制本目录源码
```

要求 Node 18+（使用全局 `fetch`）。

## 快速开始

```ts
import { CompactionEngine } from 'context-compaction';

const engine = new CompactionEngine({
  contextWindow: 128_000,
  threshold: 0.8,                            // dsh 同款默认值
  baseUrl: 'https://api.deepseek.com/v1',    // 任意 OpenAI 兼容端点
  model: 'deepseek-chat',
  // apiKey: 'sk-...',                       // 缺省依次读 OPENAI_API_KEY /
                                             // DEEPSEEK_API_KEY / ZHIPUAI_API_KEY / MOONSHOT_API_KEY
});

// agent 循环中，每个 step 开始前：
if (engine.shouldCompact(messages)) {
  const result = await engine.compact(messages, { trigger: 'auto' });
  messages = result.messages;                // [system..., 摘要消息, 近期原文...]
  console.log(
    `compacted ${result.stats.beforeTokens} -> ${result.stats.afterTokens} tokens`,
  );
}
```

手动 `/compact` 命令：

```ts
const result = await engine.compact(messages, {
  trigger: 'manual',
  focus: '重点保留报错堆栈和文件路径',   // 可选强调提示
});
messages = result.messages;
```

## Goal 机制（防长会话丢目标）

dsh 的另一个关键机制：把会话目标作为**一等对象**管理，而不是散落在对话里。目标存在消息历史之外，因此无论压缩多少轮都不会丢失：

```ts
import { CompactionEngine, GoalManager } from 'context-compaction';

const goal = new GoalManager();
goal.set('修复 login 页面的崩溃 bug');

const engine = new CompactionEngine({
  contextWindow: 128_000,
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  goal,                       // 接入压缩协同
});

// 目标随工作进展更新（时间线会渲染进上下文）：
goal.addNote('已定位到 LoginForm.tsx 第 42 行的空指针');
// goal.complete('已发布 v2.0.1');  / goal.cancel('方案被否');  / goal.clear();
```

**注入上下文**（每个 step 由 host 拼 进系统提示，保证模型始终看得见目标）：

```ts
systemPrompt = basePrompt + '\n\n' + goal.promptBlock();
// [active goal]
// Goal: 修复 login 页面的崩溃 bug
// Status: active
// Recent progress:
// - 已定位到 LoginForm.tsx 第 42 行的空指针
```

**与压缩的协同**（`CompactionEngine` 配置了 `goal` 时自动生效）：

1. 摘要生成器会收到 `<active_goal>` 块，交接摘要的 Goal/Next steps 不会漂移；
2. 压缩后的历史为 `[system..., 摘要, [active goal] 提醒, 近期原文...]`，下个 step 立即重新锚定目标；
3. 旧的目标提醒消息在下次压缩时被吸收合并，结果中始终只有一条目标消息。

`GoalManager` 其余 API：`get()` / `isActive()` / `buildMessage()`；`toJSON()` / `GoalManager.fromJSON()` 用于把目标挂到你自己的会话日志（模块本身不做隐藏持久化）。

## API

### `new CompactionEngine(config)`

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `contextWindow` | （必填） | 模型上下文窗口大小（tokens） |
| `threshold` | `0.8` | 自动压缩的压力阈值，`(0, 1]` |
| `keepRecentTokens` | `contextWindow * 0.2` | 压缩后原样保留的近期消息 token 预算 |
| `minMessagesToCompact` | `8` | 低于该消息数时 `shouldCompact()` 恒为 false |
| `summaryRole` | `'user'` | 摘要消息插入历史时的角色 |
| `summaryMarker` | `'[context compacted]'` | 摘要消息稳定前缀（检测旧摘要用） |
| `maxRetries` | `2` | 摘要调用重试次数（共 3 次尝试） |
| `onError` | `'fallback'` | 重试耗尽后：`'fallback'` 机械摘要 / `'throw'` 抛出 |
| `countTokens` | 内置启发式 | 可插拔 token 计数器 `(text: string) => number` |
| `summarize` | 内置客户端 | 可插拔摘要生成器（接自有 LLM 或测试 mock） |
| `goal` | 无 | 可选 `GoalManager`，启用目标管理与压缩协同（见上文） |
| `baseUrl` / `apiKey` / `model` | OpenAI 端点 | 内置 OpenAI 兼容客户端配置 |
| `maxSummaryTokens` | `2048` | 摘要生成的 max_tokens |
| `timeoutMs` | `120000` | 摘要调用单次尝试超时 |

### 引擎方法

- `estimateTokens(messages)` / `getPressure(messages)` — 估算 tokens 与压力（0~1+）
- `shouldCompact(messages)` — 是否应在当前 step 边界自动压缩
- `compact(messages, options?)` — 执行压缩，返回 `CompactionResult`：

```ts
interface CompactionResult {
  messages: CompactMessage[];  // [system..., summary, tail...]
  summary: string;             // 交接摘要文本（不含 marker）
  splitIndex: number;          // 原数组中保留区的起始下标
  stats: {
    beforeTokens: number;
    afterTokens: number;
    summarizedCount: number;   // 被摘要替换的消息数
    keptCount: number;         // 原样保留的消息数
    triggeredBy: 'auto' | 'manual';
    usedFallback: boolean;     // 是否使用了机械摘要降级
  };
}
```

当旧消息为空（整段历史都在保留预算内）时，`compact()` 原样返回输入，`stats.summarizedCount === 0`。

### 其余导出

- `estimateTokens` / `estimateMessageTokens` / `estimateConversationTokens` — token 估算（中英文启发式，可被 `countTokens` 替换为 tiktoken 等）
- `findSplitIndex` / `partitionGroups` / `systemPrefixLength` — 安全切分算法（可独立复用/测试）
- `buildSummaryMessage` / `extractPreviousSummary` — 摘要消息的构造与回读
- `serializeForSummary` / `buildCompactionUserPrompt` / `buildFallbackSummary` / `COMPACTION_SYSTEM_PROMPT` — compaction turn 提示词
- `createOpenAICompatSummarizer` — 内置 OpenAI 兼容客户端（重试 + 退避 + 超时）
- `GoalManager` / `GoalRecord` / `GoalNote` / `GoalStatus` — goal 机制
- 类型：`CompactMessage` / `CompactionConfig` / `CompactionResult` / `SummaryGenerator` 等

## 集成到现有 agent

1. 把本目录作为子包引入（`package.json` 里 `"context-compaction": "file:../context-compaction"`），或复制 `src/` 源码。
2. 在 agent 主循环的 step 边界加三行（见快速开始）。
3. 如果 agent 有 slash 命令系统，把 `/compact [focus]` 映射到 `compact(messages, { trigger: 'manual', focus })`。
4. 用 `stats` 渲染 UI 提示，例如 `⇅ 已压缩 82k → 14k tokens（自动触发）`。

## 开发

```bash
npm install
npm test          # vitest，全部为离线 mock，不需要 API key
npm run build     # tsc -> dist/
npm run typecheck
```

### 有 API key 时的真实链路自测

```bash
export DEEPSEEK_API_KEY=sk-xxx   # 或 OPENAI_API_KEY 等
node -e "
import('./dist/index.js').then(async ({ CompactionEngine }) => {
  const engine = new CompactionEngine({
    contextWindow: 16000,
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  });
  const msgs = [{ role: 'system', content: 'You are a coding agent.' },
    ...Array.from({ length: 40 }, (_, i) => ({
      role: i % 2 ? 'assistant' : 'user',
      content: 'turn ' + i + ': discuss refactoring module ' + i + ', watch the error in login.ts',
    }))];
  const r = await engine.compact(msgs, { trigger: 'manual' });
  console.log(r.summary);
  console.log(r.stats);
});"
```

## 已知取舍

- 内置 token 估算是启发式（CJK ≈ 1 token/字、其他 ≈ 4 字符/token，并有意略高估），只用于压力检测；需要精确值时注入 `countTokens`。
- 摘要质量取决于所用模型；`onError: 'fallback'` 保证会话不中断，但机械摘要只是用户请求列表，不含语义压缩。
- 多模态消息（数组 content）会被原样保留或以 JSON 形式计入摘要输入，token 估算按其 JSON 序列化计算。

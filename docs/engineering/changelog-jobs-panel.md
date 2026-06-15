# 变更说明 · Jobs 面板加固（2026-06）

> 面向开发者的变更记录 / PR 描述。本轮对「后台任务（Jobs）」前后端做了一组正确性、性能与体验加固，OpenClaw base 仍锁定 `2026.6.1`，未触碰 gateway 协议。

## 背景

Jobs 是 Research-Claw 在 OpenClaw 之上**自建**的「后台长任务」子系统（OpenClaw 本身无此概念）。数据流：

```
聊天消息 → detectLongTaskIntent 启发式打分 → rc.longTask.submit 建 queued 任务
        → 重写提示词命令 Agent spawn 子会话（首行打印 Job ID）
        → 子会话调用 job_checkpoint/job_finish 回写（主动通道）
        ⟂ openclaw-sync 扫 sessions.json + transcript 反推状态（被动通道）
前端：JobsActivityListener 轮询 + 通知/Dock 角标；JobsPanel 渲染卡片与操作
```

代码审计发现：取消可能假成功、queued 任务永久卡死、同步覆盖丢数据、轮询全量扫描阻塞 gateway 主线程、resume/retry 静默空转、steps 落库但不可见、时间显示 UTC 串等。本轮按严重度分批修复。

## 改动清单

### P0 — 正确性

| # | 改动 | 文件 |
|---|---|---|
| P0.1 | **取消顺序反转**：先 `rc.job.cancel` 落库，再尽力停后台 run；停 run 失败降级为 `console.warn`，不再阻断落库（消除「假取消」）。`upsertExternal` 的状态优先级保证已取消任务不被同步复活。 | [stores/jobs.ts](../../dashboard/src/stores/jobs.ts) |
| P0.2 | **queued 超时**：`markStalled` 改事务，新增 queued 分支——`created_at` 超过 `queuedStaleSeconds`（默认 600s）的 queued 任务 → `stalled`，消除「子会话从未启动 → 永久等待」。签名向后兼容。 | [jobs/service.ts](../../extensions/research-claw-core/src/jobs/service.ts) |
| P0.3 | **同步保留原始 input**：sync 绑定回已存在 `longtask:` 任务时 `...existingJob.input`，不再全量覆盖 `message/references/detection`。 | [jobs/openclaw-sync.ts](../../extensions/research-claw-core/src/jobs/openclaw-sync.ts) |

### P1 — 性能 / 健壮性

| # | 改动 | 文件 |
|---|---|---|
| P1.1 | **sync 节流 + get 不全量扫描**：sync 收口到单一节流入口（3s 窗口）；`rc.job.get`（手动刷新/操作后重载）不再触发全量 transcript 扫描，新鲜度交给 list 轮询。 | [jobs/rpc.ts](../../extensions/research-claw-core/src/jobs/rpc.ts) |
| P1.2 | **保留策略**：新增 `pruneOld(maxAgeDays=30)`，删除 30 天前 terminal 任务（steps 经 `ON DELETE CASCADE` 级联）；在 db service `start()` 调用一次。 | [jobs/service.ts](../../extensions/research-claw-core/src/jobs/service.ts) + [index.ts](../../extensions/research-claw-core/index.ts) |
| P1.3 | **queued 孤儿回链**：jobId 解析改三级优先——transcript Job ID → 按 `session.spawnedBy` 匹配父会话下 `queued/stalled` 的 `longtask:` 任务（`findBindableLongTask`）→ 才新建 `openclaw:<id>`。消除「模型忘打印 Job ID → 原任务永远 queued + 另生孤儿」。 | [jobs/openclaw-sync.ts](../../extensions/research-claw-core/src/jobs/openclaw-sync.ts) + [jobs/service.ts](../../extensions/research-claw-core/src/jobs/service.ts) |

### Tier 1 — 同步架构（消除主线程阻塞）

| # | 改动 | 文件 |
|---|---|---|
| T1-A | **增量 transcript 缓存**：按 `(mtime, size)` 缓存每个子会话 transcript 的解析结果，稳态扫描仅重读有变动的文件，解析成本≈0；每轮按本次扫到的文件 prune，缓存大小由在线会话数界定。状态映射/停滞判定仍每轮重算，新鲜度不受影响。 | [jobs/openclaw-sync.ts](../../extensions/research-claw-core/src/jobs/openclaw-sync.ts) |
| T1-B | **服务端自驱动同步**：新增 20s 服务端定时器（`.unref()`，stop 时 `clearInterval`）周期 sync + `markStalled`，**不再依赖 dashboard 开着**；RPC 与定时器共用同一把节流锁。 | [index.ts](../../extensions/research-claw-core/index.ts) |

> 说明：未做真正的 gateway 协议级 push（OpenClaw 6.1 锁定、风险高）。「增量扫描 + 服务端定时器」是其低风险等效替代。

### Tier 2.2 — resume/retry 存活校验

- 新增纯函数 `chooseLiveSessionKey(candidates, knownKeys)` + `resolveLiveSessionKey`（调一次 `sessions.list`）：发送续作提示**前**校验关联子会话是否仍在线。全部候选失联 → 抛明确错误「关联的 OpenClaw 子会话已不存在…」，把**静默空转**变成显式失败；`sessions.list` 不可用时退回乐观（兼容旧 gateway）。同时改为挑选实际在线的候选 key 发送。
- 文件：[stores/jobs.ts](../../dashboard/src/stores/jobs.ts)

### Tier 3.2 — 渲染 steps 子步骤

- 后端 `list()` 用单条 `WHERE job_id IN (...)` 批量挂载 steps（无步骤的 job 得空数组，避免 N+1），使各路径 steps 一致、不闪烁。
- 前端新增 `JobSteps` 折叠组件 + `STEP_STATUS_COLORS`，显示状态 Tag / label / running 百分比 / `attempt>1` 重试次数 / 步骤 error；仅 `steps.length>0` 时渲染。
- 文件：[jobs/service.ts](../../extensions/research-claw-core/src/jobs/service.ts) + [panels/JobsPanel.tsx](../../dashboard/src/components/panels/JobsPanel.tsx) + i18n `jobs.steps`/`jobs.stepStatus.*`/`jobs.stepAttempt`。

### Tier 4 — 时间本地化（含 bug 修复）

- 修隐蔽 bug：`rc_jobs.updated_at` 是 SQLite `'YYYY-MM-DD HH:MM:SS'`（UTC 无时区标记），`new Date()` 会按本地时间解析 → 差一个时区偏移。新增 `dbDateToIso` 归一化为 ISO-UTC，再用全站 `relativeTime` 显示相对时间，`Tooltip` 给精确本地时间。
- 文件：[panels/JobsPanel.tsx](../../dashboard/src/components/panels/JobsPanel.tsx)

### Tier 3.1 — 自动检测加确认

- **显式后台请求**静默升级（零摩擦）；**仅启发式命中**（误判高发区）升级前弹 `Modal.confirm`「转为后台长任务？[后台执行]/[本轮直接回答]」，取消/关闭默认走本轮直接回答。
- 文件：[stores/chat.ts](../../dashboard/src/stores/chat.ts) + i18n `chat.longTask.*`。
- **已知取舍**：store 内无 App context 持有者，用了 antd **静态 `Modal.confirm`**，会有「静态方法不消费动态主题」的 benign 警告——功能正常，仅该确认框不跟随动态主题 token。后续若需要可引入 App-context modal holder 替换。

## 测试

- 后端 `jobs.test.ts` 新增：queued 超时、prune+级联、spawnedBy 回链（含 input 保留）、transcript 缓存命中、list 挂载 steps。后端全量 **608 通过**。
- 前端新增 `stores/jobs.test.ts`（`chooseLiveSessionKey` 4 例）；chat/long-task/jobs store **64 通过**。
- 两端 `tsc --noEmit` **0 错误**；i18n 中英 key parity 校验通过。

## 兼容性 / 升级

- 纯代码改动，**无 DB schema 变更**（`rc_jobs`/`rc_job_steps` 结构不变，复用既有索引与 `ON DELETE CASCADE`）。
- `markStalled` 新增可选参数 `queuedStaleSeconds`，所有现有调用点不变。
- 前端依赖 `sessions.list`（resume 校验）与 steps 字段，旧 gateway 缺失时均有降级路径。

## 仍未做（有意保留）

- 真正的 gateway 协议级 push（见 Tier 1 说明）。
- transcript 文本展示加固：当前 React 默认转义、无实际 XSS 风险，未改。

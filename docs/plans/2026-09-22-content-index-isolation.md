# 内容索引写入隔离

Status: completed (local delivery)
Owner: Codex
Started: 2026-09-22
Last updated: 2026-09-23

## Goal

隔离后台会话搜索索引写入，减少 Agent Host 初始化和交互线程的长停顿，保持 Pi JSONL 真源、索引可重建、内容隐私和搜索正确性。

## Non-goals

不更换 React/Pi，不改变 Provider，不删除用户数据，不修改团队知识或 OpenViking，不为提速跳过校验、保存明文索引或弱化搜索覆盖。

## Acceptance criteria

- 原有搜索、排序、过滤、coverage/incomplete、内容 fingerprint 校验保持真实。
- 内容索引的同步批量 SQL 不再执行于 Host 前台事件循环。
- 前台目录读写不与索引写入争用同一 SQLite 文件；没有因忙锁而降级或丢更新。
- 旧 generation/旧 Workspace 的延迟结果不能覆盖当前状态。
- 启动、取消、切换、异常退出、重启重建和关闭均有有界生命周期验证。
- Worker 读写路径由 Host 明确传入和校验；不记录 JSONL 正文、盐或凭据。
- 通过定向回归、完整源码门禁、macOS packaged smoke 与同口径性能对照。Windows 证据独立报告。

## Delivery boundary

- Local implementation: 已授权性能优化范围；已完成本地生产集成、完整源码门禁和 macOS 安装包验收。
- Commit / push: 未授权。
- Candidate build/upload: 本地预览按仓库流程；未授权上传、分发或发布。
- Tag/release/promotion: 未授权。

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | 当前 Host 的 replaceMany 采样 self-time 1036 ms，事件循环间隔约 1251 ms | artifacts/performance/current-host-initialization-analysis.md | 2026-09-22 |
| OBSERVED | 同库 Worker 在 DELETE journal + 100 ms busy timeout 下，3 轮前台读写均遇到锁错误 | artifacts/performance/index-write-isolation-electron.json | 2026-09-22 |
| OBSERVED | 独立库 Worker 与批量基线吞吐近似；3 轮目录读写无锁错误；原型终止回滚后旧 40 token 保留 | 同上 | 2026-09-22 |
| OBSERVED | 每事务 1000 token 的分代原型前台响应良好，但 200000 token 总写入约 971 ms，对照批量约 340 ms | 同上 | 2026-09-22 |

## Affected boundaries

- Modules/processes: packages/pi-runtime 的 catalog、content search、index coordinator；Node Worker 构建/打包与生命周期。
- Protocol/persisted state: 新增内部有界 Worker 消息合同；独立可丢弃索引文件、盐和索引版本。现有 Catalog、旧内容表及 rollback 策略必须先定稿。
- Platform/artifact: Electron Utility 内 Node Worker；ASAR 入口和 node:sqlite 支持须真实验证。
- Existing WIP: 当前 main 基点 9c2d1624438c3684b38a8dbdca9ea38e0aa874e5，ahead 6；保留现有未提交 Markdown Worker、HMAC、capability 读取优化，以及 AGENTS/PRODUCT/DESIGN、prompt-attachment-access、design-preview、provenance 和其他计划 WIP。

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| 优先单个 Worker 独占独立内容索引库 | 隔离 CPU 与目录文件锁，原型吞吐没有小事务额外成本 | 集成后内存、搜索正确性或生命周期不达标 |
| 不采用同库 Worker 直接写入 | 实验重复出现前台锁错误 | 有新的可验证隔离机制 |
| 分代小事务保留为备选 | 可响应，但吞吐代价明显且需新可见性合同 | Worker 集成不能满足约束 |

## Checkpoints

- [x] 1. 隔离原型：Node 与当前 Electron utility 中各 3 轮，比较响应、锁错误、原子可见性和终止回滚。
- [x] 2. 定稿独立索引所有权与迁移/回退合同：salt、查询过滤、revision、重建、旧表保留策略；更新相关架构 authority。
- [x] 3. 集成有界单 Worker、内部消息校验、取消/退出及错误投影；移除前台索引长写入路径。
- [x] 4. 回归与完整源码门禁、macOS 安装包生命周期和性能验证。

## Validation matrix

| Layer | Command/procedure | Evidence | Result |
| --- | --- | --- | --- |
| 原型 Node | node artifacts/performance/index-write-isolation-probe.mjs | index-write-isolation.json | PASS；简化 schema |
| 原型 Electron | node artifacts/performance/index-isolation-utility-probe.mjs | index-write-isolation-electron.json、index-isolation-utility.log | PASS；Electron 43.7.3 / Node 24.21.0；15 个样本 |
| Production source | corepack pnpm run check:source | artifacts/performance/index-worker-source-check.log | PASS；875 files / 5710 tests passed；9 files / 24 tests skipped |
| macOS packaged | corepack pnpm run preview:mac:unsigned | artifacts/performance/index-worker-preview.log | PASS；package、smoke、artifact identity、open |
| Packaged index isolation | 独立 synthetic search + 两库只读核验 | artifacts/performance/index-worker-native-proof.json | PASS；前台 0 tokens，Worker 234361 tokens，两库 quick_check ok |
| Write interruption/recovery | 观察写锁后正常关闭，再打开同一 synthetic Session | artifacts/performance/index-worker-shutdown.json | PASS；74.7 ms 关闭，事务回滚，重启重建 |
| Startup | 同 fixture 前后各 3 次 | artifacts/performance/index-worker-final-navigation.json | 初始化中位数 3343.31 → 1840.29 ms |
| Memory observation | 单次隔离 utility RSS | artifacts/performance/index-worker-memory.json | OBSERVED；244.95 → 410.61 MiB；不是 Worker 独立开销对照 |
| Windows | 未运行 | none | UNVERIFIED |

## Integration contract

- Worker 独占 `<catalog>/content-index-worker/session-catalog-v3.sqlite3`。复用现有 schema、
  权限/完整性/恢复逻辑，持有安全 metadata 副本用于既有 SQL join；每请求用完整当前 snapshot
  替换 metadata 并淘汰不存在的索引。旧目录库内容表保留，不做破坏迁移。
- salt 由独立库生成并保留，旧 token 不复制；通过 Pi JSONL 重建。正文不落 SQLite。
- 主线程仍拥有目录状态；搜索返回前核对 source generation / revision，变化则明确 stale。
- owner 请求串行，最多八个未完成请求，snapshot 上限 100000 条 / 16 MiB 保守大小，每请求
  30 秒。reset/执行中取消/dispose 终止 Worker，并等待其退出后再创建下一代。
- 背景失败不阻塞 runtime 初始化；显式搜索沿用原有 bounded fallback 并标记 incomplete。
- root test/test:coverage 先构建 Worker entry；真实 Node Worker 回归不依赖猜测源码加载。

## Rollback

实验仅使用临时目录，已关闭自建 Worker/数据库并清理。生产实现前明确旧 Catalog 兼容边界；不先删除旧表或用户 JSONL，不允许两个实现同时写同一内容索引。失败时返回可观察的 incomplete/unavailable 并保留重建途径，不假装索引完整。回退只撤销本计划明确拥有的代码，保留原有 WIP。

## Risks and unknowns

- 启动结果来自本机合成数据的三次样本，不能外推生产 p95 或 Windows。
- 单次 utility RSS 在索引前 244.95 MiB、索引后空闲 410.61 MiB，dispose 后约 399.20 MiB。
  包含线程、SQLite、临时分配和 allocator retention；没有同步旧实现的同口径内存对照，
  不能把全部增量归因于 Worker，也不能据此判定泄漏。持续内存占用是后续优化重点。
- 写入中的显式搜索会排队，仍受 30 秒执行超时与原有 bounded fallback 合同约束；未宣称查询吞吐提升。
- Windows、长期真实工作负载与真实 Provider 未验收。用户已要求不再重复模型测试。

## Progress log

- 2026-09-22: 完成路线比较；同库路线排除，优先独立库单 Worker。后续已接入 Worker 与独立库，定向回归覆盖重启、过滤、来源失效、取消和独立文件；完整门禁与 packaged 验收 pending。

- 2026-09-22 closeout: 全量源码与当前 macOS ASAR 验收完成。初始化中位数缩短约 45%，
  port→runtime.ready 中位数 1757.7 → 497.8 ms。写入中关闭回滚与重启重建通过。
  两次早期关闭探针因重启后等待空草稿自动启动的假设失败，改为打开实际合成 Session 后通过；保留原始证据。
  ASAR SHA-256: `be3a7854ce04c9073e9b466aefa45ac2bb11257bda3e12eb7ca7ab04f6eaf4f7`。
  完整结果见 `artifacts/performance/index-worker-implementation-result.md`。未 commit、push、上传或发布。

- 2026-09-23 memory follow-up: 同 packaged 算法同步/Worker 各三组对照完成；空闲 RSS
  中位数 325.59 / 427.66 MiB，前台最长 heartbeat gap 中位数 1584.1 / 11.7 ms。
  151 次搜索及 30 次强制索引版本刷新通过，RSS 从采样峰值 472.23 MiB 回落至 335.92 MiB。
  五次持久索引线程重建的搜索中位数约 659 ms，常驻 warm search 约 119 ms，立即释放 RSS
  约 9.3 MiB；不引入自动空闲销毁。该结果不是长期无泄漏证明。
  本轮只补性能测量合同与证据，未改生产代码、未重建、未 commit/push。
  详见 `artifacts/performance/index-memory-assessment.md` 与 `index-memory-summary.json`。

# Aillive Code 专业化 CLI 任务账本

> 状态：完成版。
>
> 目标：把 Aillive CLI 从单入口 npm CLI 升级为对标成熟 AI Coding CLI 工程深度的专业化多包 Agent CLI。公开命名、命令、文案、认证、协议和本地数据布局均保持 Aillive 自有体系；第三方 MIT contract 只作为内部实现来源，不作为用户可见品牌能力。

## 0. 文档控制

- [x] 将本文件作为 CLI 架构改造任务源。
- [x] 每个完成项记录验证证据。
- [x] 用户已确认从专业 `task.md` 进入实现阶段。
- [x] 范围内任务：多包架构、TUI、Provider、MCP、LSP、Git、Memory、Agent Runtime、docs、assets、CI、测试、发布脚本。
- [x] 范围外任务：npm 正式发布、Web/Worker 项目改造。

证据：2026-07-03 用户明确要求“按照这个 task.md 完成专业化 cli 的任务”和“请一次性完成所有任务”；本文档已更新为完成版验收账本。

## 1. 仓库事实

- [x] 包名为 `aillive-code`。
- [x] 版本为 `0.1.0`。
- [x] 使用 ESM：`"type": "module"`。
- [x] bin 保留 `aillive` 和 `aillive-code`。
- [x] Node 版本约束为 `>=18`。
- [x] 发布文件由 allowlist 控制：CLI app、packages source、package manifests、compat shim、README、LICENSE、docs assets。
- [x] 脚本覆盖 `dev`、`check`、`check:workspace`、`check:syntax`、`check:release`、`test`、`test:integration`、`smoke:npx`、`pack:smoke`、`pack:dry`、`publish:check`。
- [x] 测试覆盖 `test/cli.test.js`、`test/npx-smoke.mjs`、`test/workspace.test.js` 和各 package `test/*.test.js`。
- [x] CLI 入口位于 `apps/cli/src/index.js`，根 `src/index.js` 保留兼容 shim。
- [x] CI 覆盖 install、workspace graph、syntax、release metadata、unit tests、integration tests、pack smoke、pack dry-run。

证据：`package.json`、`.github/workflows/ci.yml`、`scripts/check-release.mjs`；最新 `npm run publish:check` 通过。

## 2. 用户命令兼容性

- [x] 保留 `aillive` 交互式启动。
- [x] 保留 `aillive "prompt"` 单次 prompt fallback。
- [x] 保留 `aillive ask`。
- [x] 保留 `aillive chat`。
- [x] 保留 `aillive chat --stream`。
- [x] 保留 `aillive run --project`。
- [x] 保留 `aillive auth login/import/status/path/logout`。
- [x] 保留 `aillive login`、`aillive logout`。
- [x] 保留 `aillive setup`。
- [x] 保留 `aillive config get/set/list`。
- [x] 保留 `aillive models`。
- [x] 保留 `aillive init`。
- [x] 保留 `aillive context status/show/path/init`。
- [x] 保留 `aillive session list`。
- [x] 保留 `aillive stats`。
- [x] 保留 `aillive usage`。
- [x] 保留 `aillive openclaw run`。
- [x] 保留 `aillive admin promote`。
- [x] 保留 `aillive doctor`。
- [x] 保留 `aillive home`、`aillive home --open`。
- [x] 保留 `aillive completions powershell|bash|zsh`。
- [x] 保留 `aillive upgrade`。
- [x] 保留全局参数：`--api-key`、`--base-url`、`--model`、`--project`、`--no-project`、`--system`、`--cwd`、`--data-dir`、`--open`、`--offline`、`--trace`、`--verify`、`--force`、`--json`、`--no-color`、`--help`、`--version`。

证据：`test/cli.test.js` 覆盖 help/version/status/config/context/chat/streaming/models/agent/MCP/Git/memory/admin；`npm test` 76 项通过；`npm run smoke:npx` 通过。

## 3. 多包架构

- [x] Root npm workspace 已建立。
- [x] `apps/cli` 为可执行 CLI app。
- [x] `packages/core` 负责 config、path、parser、errors、formatting、auth helpers。
- [x] `packages/tui` 负责 wordmark、terminal width、palette、prompt、status chips、panels/tables、spinner、stream helpers、no-color/narrow fallback。
- [x] `packages/provider` 负责 Aillive/OpenAI-compatible models、chat、streaming、usage、OpenClaw、status、timeout/retry、trace redaction。
- [x] `packages/mcp` 负责 Aillive MCP config、server definitions、mock/server connection contract、tool list/call、permission policy、output limit、trace redaction。
- [x] `packages/lsp` 负责 language detection、JSON-RPC encode/decode、mock client、diagnostics、symbols、hover、definition/reference、code action metadata、workspace summary。
- [x] `packages/git` 负责 read-only repo detection、branch、status、diff summary、staged diff summary、recent commits、untracked files、checkpoint metadata、agent context。
- [x] `packages/memory` 负责 config/auth/session/stats/project context/checkpoint/trace/tier/search/status。
- [x] `packages/agent-runtime` 负责 objective、context assembly、planning、provider orchestration、MCP tool routing、LSP/Git/memory routing、verification、trace、checkpoint、resume、安全门。
- [x] 每个 package 通过 `exports` 显式导出 API。
- [x] 依赖规则已校验：core 无内部依赖；tui/provider/mcp/lsp/git/memory 只依赖 core 或无内部依赖；agent-runtime 可依赖 core/provider/MCP/LSP/Git/memory；CLI app 可依赖所有内部包。
- [x] 禁止循环依赖并由 workspace verifier 覆盖。

证据：`scripts/verify-workspace.mjs`；`npm run check:workspace` 输出 `workspace ok: 9 packages verified`。

## 4. CLI App 与命令路由

- [x] executable entrypoint 位于 `apps/cli/src/index.js`，保留 shebang。
- [x] `apps/cli/src/commands/index.js` 提供 Aillive command module metadata。
- [x] Help、shell completions、slash command palette 从命令元数据生成。
- [x] Unknown command fallback 到 chat 保留。
- [x] `--json` 输出稳定，错误形状统一为 `{ ok:false, error:{ code, message } }`。
- [x] `status` 展示 auth/model/provider/project/MCP/LSP/Git/memory。
- [x] interactive mode 未登录可打开，API 动作才触发登录。
- [x] `/help`、`/status`、`/context on/off`、`/model`、`/models`、`/sessions`、`/usage`、`/doctor`、`/login`、`/clear`、`/exit` 保留。

证据：`apps/cli/src/commands/index.js`、`apps/cli/src/index.js`；`test/cli.test.js` 覆盖 command metadata、slash metadata、stable JSON errors、status subsystems。

## 5. Core 与本地兼容

- [x] `AILLIVE_HOME` override 保留。
- [x] 默认 home 保留 `~/.aillive`。
- [x] `auth.json`、`config.json`、`stats.json`、`sessions/index.json`、`projects/<project-key>/project.md` 路径兼容。
- [x] Windows path、空格 path、中文 path 有测试覆盖。
- [x] typed errors、output mode detection、ANSI helpers、table/panel formatting、auth payload normalization 已实现。
- [x] auth required、API request failed、config invalid、subsystem unavailable、command usage 的 JSON error shape 已稳定。

证据：`packages/core/src/index.js`、`packages/core/test/core.test.js`、`test/cli.test.js`；`npm test` 通过。

## 6. TUI

- [x] Aillive wordmark、窄终端 fallback、terminal width helpers。
- [x] command palette、interactive prompt、status chips、panels/tables。
- [x] spinner/working indicator、stream rendering helpers。
- [x] `--json` 和 `--no-color` 不输出 ANSI。
- [x] 常见终端宽度无重叠、长文本可裁剪。

证据：`packages/tui/src/index.js`、`packages/tui/test/tui.test.js`；CLI help/interactive 使用 TUI helpers。

## 7. Provider

- [x] Provider registry 和能力模型。
- [x] Aillive/OpenAI-compatible base URL normalization。
- [x] Models、chat completion、SSE streaming、usage、OpenClaw。
- [x] timeout/retry policy。
- [x] provider status 与 remediation hint。
- [x] request trace 脱敏。
- [x] 本地 HTTP mock 测试，不依赖真实 API key。

证据：`packages/provider/src/index.js`、`packages/provider/test/provider.test.js`；`models`、`chat`、`streaming` CLI integration 均通过 mock。

## 8. MCP

- [x] Aillive tool contract 对外命名。
- [x] 读取 `~/.aillive/mcp.json`。
- [x] 校验 server definitions。
- [x] 支持 mock/connect contract，不增加首装复杂度。
- [x] list tools。
- [x] call tools。
- [x] tool result 转 agent runtime events。
- [x] tool permission enforcement。
- [x] allow/deny rules。
- [x] per-tool confirmation mode。
- [x] timeout policy 字段。
- [x] max output size policy。
- [x] trace recording policy。
- [x] tool trace 脱敏。
- [x] agent runtime 不能静默调用未知工具。
- [x] 高风险工具按策略要求确认。
- [x] `docs/mcp.md` 文档化 config、transport、failure modes、test expectations。
- [x] mock MCP fixture 由 `createMockMcpServer` 和 CLI built-in `echo` 提供。

证据：`packages/mcp/src/index.js`、`packages/mcp/test/mcp.test.js`、`docs/mcp.md`；`aillive mcp call echo` integration 测试通过。

## 9. LSP

- [x] language server discovery。
- [x] process lifecycle metadata contract。
- [x] initialize/shutdown。
- [x] workspace symbols。
- [x] diagnostics summary。
- [x] hover。
- [x] definition/reference lookup。
- [x] code action metadata。
- [x] workspace understanding API 汇总 files/Git/LSP。
- [x] diagnostics summary 提供给 agent context。
- [x] symbol lookup 提供给 agent planning。
- [x] agent runtime 不需要知道 LSP 内部即可获取代码智能。
- [x] `aillive lsp status` 支持 JSON，缺 server 时降级显示。

证据：`packages/lsp/src/index.js`、`packages/lsp/test/lsp.test.js`、`docs/lsp.md`。

## 10. Git

- [x] detect Git repository。
- [x] branch、HEAD、status。
- [x] diff summary、staged diff summary。
- [x] recent commits、untracked files。
- [x] checkpoint metadata。
- [x] Git-aware agent context 包含 branch、dirty files、diff summary。
- [x] 检测用户未提交改动并保护。
- [x] `aillive git status`。
- [x] `aillive git diff --summary`。
- [x] `aillive git checkpoint`。
- [x] 所有 Git 操作保持只读。

证据：`packages/git/src/index.js`、`packages/git/test/git.test.js`、`test/cli.test.js`；non-repo/clean/dirty/staged/untracked 均覆盖。

## 11. Memory

- [x] config store。
- [x] auth store interface。
- [x] session store。
- [x] stats store。
- [x] project context store。
- [x] agent checkpoint store。
- [x] task trace store。
- [x] memory search。
- [x] Global memory、Project memory、Session memory、Task memory tiers。
- [x] agent runtime 可按 tier 请求 memory。
- [x] checkpoint 记录 objective、plan、files touched、commands run、failures/fixes、verification、events。
- [x] `aillive memory status` 展示 home、project memory path、session/checkpoint/trace counts、storage size。
- [x] `aillive memory search <query>` 可搜索本地 memory。
- [x] 隐私文档说明本地存储内容。

证据：`packages/memory/src/index.js`、`packages/memory/test/memory.test.js`、`docs/memory.md`、README/README.zh 本地文件章节。

## 12. Agent Runtime

- [x] task objective model。
- [x] planning state。
- [x] context assembly。
- [x] provider orchestration。
- [x] MCP tool routing。
- [x] LSP lookup routing。
- [x] Git context routing。
- [x] memory read/write 与 tier reads。
- [x] verification hooks。
- [x] trace events。
- [x] checkpoint creation。
- [x] resume。
- [x] 状态机覆盖 `created`、`loaded_context`、`planned`、`executing`、`waiting_for_permission`、`verifying`、`checkpointed`、`completed`、`failed`、`interrupted`。
- [x] `agent plan`、`agent run`、`agent run --verify`、`agent verify`、`agent resume`。
- [x] default verification hooks：syntax、tests、pack-smoke。
- [x] final output/checkpoint 记录 verification evidence。
- [x] fake provider 离线执行。
- [x] MCP/LSP/Git disabled 时可运行。

证据：`packages/agent-runtime/src/index.js`、`packages/agent-runtime/test/agent-runtime.test.js`、`test/cli.test.js`。

## 13. Safety Gates

- [x] 检测破坏性 shell 命令。
- [x] 检测 trace 中的 secret。
- [x] 检测大文件编辑。
- [x] 改代码前检测 dirty Git worktree。
- [x] 高风险 MCP tool 需要确认。
- [x] runtime 按策略拒绝或暂停不安全动作。
- [x] secret 在输出、trace、测试中均被脱敏。

证据：`defaultSafetyPolicy`、`SafetyGateError`、`evaluateSafetyGates`、`assertSafetyGates`、`runAgentTask` runtime enforcement；`packages/agent-runtime/test/agent-runtime.test.js` 覆盖 destructive shell、secret trace、large file、dirty Git、高风险 MCP、运行前和运行中拒绝。

## 14. Docs 与 Assets

- [x] README/README.zh 覆盖 npm/npx/GitHub/local install。
- [x] README/README.zh 覆盖 workspace packages。
- [x] README/README.zh 覆盖 command groups。
- [x] README/README.zh 覆盖 `~/.aillive` 本地文件。
- [x] README/README.zh 覆盖 provider/MCP/LSP/Git/memory/agent runtime 用户级说明。
- [x] 新用户 3 分钟内可安装运行路径清晰。
- [x] 维护者知道每个 subsystem 修改位置。
- [x] `docs/architecture.md`。
- [x] `docs/commands.md`。
- [x] `docs/provider.md`。
- [x] `docs/mcp.md`。
- [x] `docs/lsp.md`。
- [x] `docs/git.md`。
- [x] `docs/memory.md`。
- [x] `docs/agent-runtime.md`。
- [x] `docs/testing.md`。
- [x] `docs/release.md`。
- [x] 每篇文档包含 purpose、commands、config、failure modes、test expectations。
- [x] 发布资产保留 terminal screenshot 和 Aillive logo，README 图片有 alt text。
- [x] pack 只包含有价值资产。

证据：`scripts/check-release.mjs` 强制检查 docs 章节；`npm run check:release` 通过；`npm pack --dry-run` 显示 26 个预期文件。

## 15. CI、测试与发布

- [x] CI Node 18/20/22 matrix。
- [x] CI install。
- [x] CI workspace graph verify。
- [x] CI syntax check。
- [x] CI release metadata check。
- [x] CI unit tests。
- [x] CI integration tests。
- [x] CI pack smoke。
- [x] CI pack dry-run。
- [x] package-level tests 覆盖 core、tui、provider、MCP、LSP、Git、memory、agent-runtime。
- [x] CLI integration tests 覆盖 help、version、home、status、config set/list、context path/show、models mock、chat mock、streaming mock、provider status、memory status、git status、MCP status/list/call、LSP status。
- [x] 测试使用临时 `AILLIVE_HOME`，不依赖真实 API key。
- [x] `scripts/check-release.mjs`。
- [x] `scripts/pack-smoke.mjs`。
- [x] `scripts/verify-workspace.mjs`。
- [x] changelog version check。
- [x] package files allowlist check。
- [x] bin executable check。
- [x] `npm run publish:check` 是有效发布门禁。
- [x] manual GitHub release workflow 默认不发布 npm，只有显式 `publish_to_npm:true` 且配置 `NPM_TOKEN` 才发布 provenance package。

证据：`.github/workflows/ci.yml`、`.github/workflows/release.yml`、`scripts/*`、`test/*`；本地 Windows 完整门禁通过，Linux 由 GitHub Actions Ubuntu matrix 配置覆盖。

## 16. 必跑命令与结果

- [x] `npm install --ignore-scripts` 在干净临时副本通过。
- [x] `npm run check` 通过。
- [x] `npm run check:workspace` 输出 `workspace ok: 9 packages verified`。
- [x] `npm run check:syntax` 输出 `syntax ok: 26 files checked`。
- [x] `npm run check:release` 输出 `release ok: aillive-code@0.1.0`。
- [x] `npm test` 通过 76 项。
- [x] `npm run test:integration` 通过 23 项。
- [x] `npm run smoke:npx` 输出 `pack smoke ok: aillive-code-0.1.0.tgz (26 files)`。
- [x] `npm run pack:dry` 通过，tarball 26 files。
- [x] `npm run publish:check` 完整通过。
- [x] 干净临时副本中 `npm install --ignore-scripts` + `npm run publish:check` 完整通过。
- [x] 临时 npm prefix 中 `npm install -g .` 后 `aillive --version` 和 `aillive-code --version` 均输出 `0.1.0`。

最新证据：2026-07-03 在当前工作树运行 `npm run publish:check` 通过；随后在 `%TEMP%/aillive-clean-*` 干净副本运行 `npm install --ignore-scripts` 与 `npm run publish:check` 通过；临时 prefix 全局安装双别名通过。

## 17. 风险登记与缓解

- [x] R1 workspace 转换破坏全局安装：临时 prefix 全局安装验证双别名。
- [x] R2 拆包引入循环依赖：workspace graph verifier 校验。
- [x] R3 `~/.aillive` 兼容性回退：core/memory tests 覆盖路径与 legacy project context fallback。
- [x] R4 TUI 抽离污染 JSON 输出：CLI JSON tests 和 TUI no-color tests 覆盖。
- [x] R5 MCP/LSP/Git 增加首装复杂度：默认 disabled/unavailable/read-only/mock，不启动真实外部服务。
- [x] R6 Agent runtime 过早膨胀：runtime 保持离线 fake provider、状态机、hooks、checkpoint contract。
- [x] R7 npm 包包含过多内部文件：package files allowlist、pack smoke、pack dry-run。
- [x] R8 Windows、空格路径、中文路径回归：core path test 与 CLI context/error test 覆盖。
- [x] R9 Provider 错误或 trace 泄露 secret：provider/core/MCP/agent tests 覆盖 redaction。
- [x] R10 长任务状态不可解释：agent state machine、trace event、checkpoint schema。

## 18. 改动文件清单

- [x] Root：`package.json`、`package-lock.json`、`README.md`、`README.zh.md`、`CHANGELOG.md`、`task.md`。
- [x] CLI app：`apps/cli/package.json`、`apps/cli/src/index.js`、`apps/cli/src/commands/index.js`。
- [x] Packages：`packages/core`、`packages/tui`、`packages/provider`、`packages/mcp`、`packages/lsp`、`packages/git`、`packages/memory`、`packages/agent-runtime`。
- [x] Tests：`test/cli.test.js`、`test/workspace.test.js`、package-level tests。
- [x] Scripts：`scripts/verify-workspace.mjs`、`scripts/check-syntax.mjs`、`scripts/check-release.mjs`、`scripts/pack-smoke.mjs`。
- [x] Docs：`docs/architecture.md`、`docs/commands.md`、`docs/provider.md`、`docs/mcp.md`、`docs/lsp.md`、`docs/git.md`、`docs/memory.md`、`docs/agent-runtime.md`、`docs/testing.md`、`docs/release.md`、`docs/assets/*`。
- [x] CI：`.github/workflows/ci.yml`、`.github/workflows/release.yml`。

## 19. 完成定义

- [x] CLI 已成为 workspace，多包边界清晰。
- [x] 现有用户命令全部保留。
- [x] `aillive` 和 `aillive-code` 安装后可用。
- [x] Provider/MCP/LSP/Git/Memory/TUI/Core/Agent Runtime 都有明确包边界。
- [x] 每个包都有测试。
- [x] docs 解释每个 subsystem 的开发、配置、失败模式和测试方式。
- [x] CI 校验 syntax、tests、integration、smoke、pack contents。
- [x] release scripts 校验版本、changelog、bin、package allowlist、docs shape、workflow guardrails。
- [x] secret 在输出、trace、测试中均被脱敏。
- [x] `--json` 自动化输出稳定。
- [x] 本文件所有完成项都有验证证据。

最终状态：Aillive Code CLI 专业化任务完成，npm 正式发布仍按原范围边界保留为手动发布动作。

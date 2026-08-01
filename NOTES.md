# NOTES

## 2025-08-02 初始打包
- 将 `~/.pi/agent/` 下全部 DIY 资产打包为 pi package：扩展（5 单文件 + plan-mode + subagent）、agents（planner/reviewer/scout/worker）、prompts（3 个）、AGENTS.md
- 仓库：github.com/Sunset1014/pi-diy（public），包名 pi-diy
- 关键设计：
  - agents 非 pi package 标准资源 → 新增 `extensions/kit-setup.ts` 注册 `/kit-setup` 命令，部署 agents/ 和 AGENTS.md 到 `~/.pi/agent/`（幂等不覆盖）；纯逻辑在 `lib/kit-setup-core.ts`（可 node 单测）
  - extensions/ 下所有 .ts 都会被 pi 当扩展加载，纯函数模块必须放 lib/（否则 "does not export a valid factory function"）
  - 不含 auth.json（API key）、settings.json（个人偏好）
- 已验证：隔离 PI_CODING_AGENT_DIR 安装 + 真实 API 调用，命令/工具全部注册成功
- 新设备安装：`pi install git:github.com/Sunset1014/pi-diy` → `/kit-setup` → `/login`
- 注意：subagent 包内的 agents/prompts 是旧副本（claude-sonnet 版），顶层 `~/.pi/agent/agents/`（deepseek 版）为生效版；本机约定目录扩展与包二选一，勿同时安装

## 2025-08-02 新增 /kit-backup（AI 驱动备份）
- extensions/kit-backup.ts：命令触发后把固定工作流提示词交给会话内大模型（pi.sendUserMessage），模型自主盘点→同步→提交→推送→汇报
- lib/kit-backup-core.ts：敏感文件清单 + forbiddenChanges 预检 + buildWorkflow（可单测，已测）
- 仓库定位：包安装时自身即仓库；约定目录加载时按 PI_KIT_REPO env → home 常见位置兜底
- 双重防线：扩展预检 git status 敏感文件 + 工作流内安全检查
- 本机已部署到 ~/.pi/agent/extensions/，隔离环境验证 /kit-backup 注册成功

## 2025-08-02 /kit 命令合并（响应"太乱"）
- 问题：本机约定目录从未部署过 kit-setup.ts（打包时新建入仓、忘了复制回本机），用户发现 /kit-setup 缺失
- 修复：kit-setup.ts + kit-backup.ts 合并为 extensions/kit.ts（子命令 setup/backup，带 Tab 补全）；纯函数合并为 lib/kit-core.ts；删 4 个旧文件
- 本机已部署 kit.ts，旧 kit-backup.ts 已删；隔离环境验证 /kit 注册成功

## 2025-08-02 事故复盘：lib/ 漏拷导致 pi 启动崩溃（重要教训）
- 事故：kit-backup.ts 部署到 ~/.pi/agent/extensions/ 时，依赖的 ../lib/kit-backup-core.ts 未部署（~/.pi/agent/lib/ 不存在）→ pi 任何模式启动 code=1
- 根因：约定目录结构与包结构不同（包有 lib/，约定目录没有）；跨目录相对依赖在两种加载方式下不成立
- 修复（另一终端补 lib/ 文件；本终端根治）：
  1. kit 扩展改为子目录结构 extensions/kit/（index.ts + core.ts），依赖同目录化
  2. 依据 pi 加载规则：顶层 *.ts/*.js 全加载；子目录只认 index.ts（core.ts 不会被误加载）
  3. 删除 lib/ 目录，单测直接针对 extensions/kit/core.ts
  4. 本机部署 = 整个 kit/ 目录复制，无遗漏可能
- 教训：①部署约定目录必须复制整个扩展目录结构；②扩展不要跨目录 import（除非在包内）；③改动后必须在本机真实启动验证（pi -p），不能只测隔离环境
- 验证：隔离环境 /kit 注册 OK；本机真实启动 OK（此前的崩溃已消除）

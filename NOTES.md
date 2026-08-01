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

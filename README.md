# pi-diy

个人 pi 全套 DIY 资产包（pi package）：扩展、agents、提示词模板、全局约定。
换设备一条命令全部装回来。

## 资产清单

| 目录 | 内容 |
| --- | --- |
| `extensions/` | 5 个单文件扩展 + 2 个扩展包 |
| `agents/` | planner / reviewer / scout / worker（subagent 扩展使用） |
| `prompts/` | implement / implement-and-review / scout-and-plan |
| `AGENTS.md` | 全局约定（工作区规则、git 规范等） |

扩展明细：

- `deepseek-billing.ts` — 峰谷计费提示 + `/balance` 查余额
- `git-checkpoint.ts` — 每轮对话创建 git stash 检查点，`/fork` 可还原代码状态
- `notify.ts` — 任务完成时发送终端原生通知
- `questionnaire.ts` — 多选/多问题交互提问工具
- `tools.ts` — `/tools` 交互式开关工具
- `plan-mode/` — `/plan` 计划模式：深度调研、生成 PLAN_HANDOFF.md、上下文清理
- `subagent/` — subagent 工具：单/并行/链式委派子 agent（agents 从 `~/.pi/agent/agents/` 读取）
- `kit-setup.ts` — `/kit-setup` 一键部署 agents 和 AGENTS.md（本包专用）

## 新设备安装

```bash
# 1. 安装 pi（见 https://pi.dev 快速开始）
npm install -g @earendil-works/pi-coding-agent

# 2. 安装本包
pi install git:github.com/<你的用户名>/pi-diy

# 3. 启动 pi，执行一次：
/kit-setup
#   把 agents/ 和 AGENTS.md 部署到 ~/.pi/agent/（已有文件不会覆盖）
#   部署后重启 pi（或 /reload）

# 4. 配置 provider 与偏好
/login            # 登录你的 provider（API key 不会入库，每次换设备都要重新登录）
/settings         # 主题、默认模型等个人偏好
```

## 更新

包内文件改动后 push 到仓库，设备上同步：

```bash
pi update --extensions          # 有版本 pin 时改用：pi install git:github.com/<用户名>/pi-diy@新ref
```

## 设计说明

- **不含** `auth.json`（API key 明文，禁止入库，新设备 `/login` 解决）
- **不含** `settings.json`（主题/默认模型是个人偏好，不是资产）
- **agents 为什么用 `/kit-setup` 部署？** pi package 只支持 extensions/skills/prompts/themes 四类资源；subagent 扩展的 agents 必须放在 `~/.pi/agent/agents/`，所以由本包的 `kit-setup` 扩展代为复制，幂等且不覆盖已有文件

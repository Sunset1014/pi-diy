# pi-diy

个人 pi 全套 DIY 资产包（pi package）：扩展、agents、提示词模板、全局约定。
换设备一条命令全部装回来。

## 资产清单

| 目录 | 内容 | 备份方式 |
| --- | --- | --- |
| `extensions/` | 5 个单文件扩展 + 2 个扩展包 | ✅ 本仓库 |
| `agents/` | planner / reviewer / scout / worker（subagent 扩展使用） | ✅ 本仓库（`/kit-setup` 部署） |
| `prompts/` | implement / implement-and-review / scout-and-plan | ✅ 本仓库 |
| `AGENTS.md` | 全局约定（工作区规则、git 规范等） | ✅ 本仓库（`/kit-setup` 部署） |

扩展明细：

- `deepseek-billing.ts` — 峰谷计费提示 + `/balance` 查余额
- `git-checkpoint.ts` — 每轮对话创建 git stash 检查点，`/fork` 可还原代码状态
- `notify.ts` — 任务完成时发送终端原生通知
- `questionnaire.ts` — 多选/多问题交互提问工具
- `tools.ts` — `/tools` 交互式开关工具
- `plan-mode/` — `/plan` 计划模式：深度调研、生成 PLAN_HANDOFF.md、上下文清理
- `subagent/` — subagent 工具：单/并行/链式委派子 agent（agents 从 `~/.pi/agent/agents/` 读取）
- `kit-setup.ts` — `/kit-setup` 一键部署 agents 和 AGENTS.md（本包专用）
- `kit-backup.ts` — `/kit-backup` AI 驱动备份：大模型按固定流程同步资产进仓库并推送

---

## 完整备份与迁移指南

pi 的全部用户资产都在 `~/.pi/agent/` 一个目录里。备份 = 把这目录里的东西分三类处理：**进 git 仓库**（DIY 资产）、**手动/加密保存**（凭证与偏好）、**不备份**（缓存与历史）。恢复 = 装 pi → 装包 → 部署 → 登录。

### 一、日常备份（旧设备）

**1. AI 自动备份（推荐）**

在 pi 里执行 `/kit-backup`：扩展预检（仓库定位 + 敏感文件防线）后，把固定工作流交给大模型自主执行——盘点资产差异 → 把新版 agents/AGENTS.md/扩展/提示词同步进仓库 → 按 Conventional Commits 分主题提交 → push → 汇报剩余手动备份项。

```bash
pi
# 进入后执行：
/kit-backup
```

**2. 手动备份（等价操作）**

```bash
cd <本机 pi-diy 仓库路径>   # 旧设备上 clone 下来的位置
# 把 ~/.pi/agent/ 下新版 agents/*.md、AGENTS.md、新扩展/新提示词同步进仓库
# 然后：
git add -A
git commit -m "feat: update xxx"
git push
```

**3. 凭证与偏好（不入库，手动保存）**

| 文件 | 内容 | 处理 |
| --- | --- | --- |
| `~/.pi/agent/auth.json` | API key（明文！） | 复制到密码管理器 / 加密盘 / U 盘；或换设备后重新 `/login` |
| `~/.pi/agent/settings.json` | 主题、默认模型等偏好 | 很小（<1KB），同上复制；或换设备后 `/settings` 重设 |
| `~/.pi/agent/keybindings.json`（如有） | 自定义快捷键 | 同上 |

**4. 可选：会话历史**

`~/.pi/agent/sessions/`（约 1MB）是历史对话，纯本地文件。想保留就整体复制到同步盘/U 盘，不想要就跳过——不影响任何功能。

**5. 无需备份**

- `models-store.json` — 模型目录缓存，启动自动重建
- `bin/fd.exe` — Windows 工具二进制，按新设备平台重新安装（Linux: `apt install fd-find`，macOS: `brew install fd`）
- 项目级 `.pi/` 配置 — 跟着项目 git 走，不在此备份范围

### 二、新设备恢复

**1. 装基础环境**：Node.js 20+（pi 的运行时）

**2. 装 pi 本体**

```bash
npm install -g @earendil-works/pi-coding-agent
```

**3. 装 DIY 包（一条命令装回全部扩展、提示词）**

```bash
pi install git:github.com/Sunset1014/pi-diy
```

**4. 启动 pi，部署 agents 和全局约定**

```bash
pi
# 进入后执行：
/kit-setup        # 把 agents/ 和 AGENTS.md 部署到 ~/.pi/agent/（已有文件不覆盖）
# 重启 pi（或 /reload）让 agents 生效
```

**5. 恢复凭证与偏好**

```bash
/login            # 重新登录 provider（推荐，最安全）
# 或把旧设备备份的 auth.json 复制到 ~/.pi/agent/auth.json
/settings         # 重设主题、默认模型；或直接复制备份的 settings.json
```

**6. 可选：恢复会话历史** — 把备份的 `sessions/` 复制到 `~/.pi/agent/sessions/`

**7. 拉回项目** — `git clone` 你的工作区仓库；项目内的 `.pi/` 配置随项目自动带入，首次启动确认信任即可

### 三、日常更新同步

改了扩展/agents/prompts → 按「一、1」push 本仓库 → 各设备上：

```bash
pi update --extensions          # 未 pin ref 时直接同步
# 若安装了固定版本：pi install git:github.com/Sunset1014/pi-diy@新ref
```

改了 agents 或 AGENTS.md 且需要覆盖旧设备上的已部署文件：先手动删 `~/.pi/agent/agents/` 下对应文件（或整个目录），再跑 `/kit-setup`（设计上不覆盖已存在文件）。

---

## 设计说明

- **不含** `auth.json`（API key 明文，禁止入库，新设备 `/login` 解决）
- **不含** `settings.json`（主题/默认模型是个人偏好，不是资产）
- **agents 为什么用 `/kit-setup` 部署？** pi package 只支持 extensions/skills/prompts/themes 四类资源；subagent 扩展的 agents 必须放在 `~/.pi/agent/agents/`，所以由本包的 `kit-setup` 扩展代为复制，幂等且不覆盖已有文件

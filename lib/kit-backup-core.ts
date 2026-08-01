/**
 * Kit backup core: forbidden-file checks and the fixed AI backup workflow.
 * No pi imports (unit-testable with plain node).
 */

/** 禁止进入仓库的敏感/个人文件（扩展预检 + 工作流双重防线） */
export const FORBIDDEN = [
	"auth.json",
	"settings.json",
	"sessions/",
	"models-store.json",
	"bin/",
	".env",
	"*.key",
	"*.pem",
];

/** 检查 git status 行是否命中敏感文件，返回命中行。 */
export function forbiddenChanges(statusLines: string[]): string[] {
	return statusLines.filter((line) => FORBIDDEN.some((f) => line.includes(f)));
}

/** 固定备份工作流提示词：交给会话内大模型执行。 */
export function buildWorkflow(kitDir: string, agentDir: string): string {
	return `# pi 全套 DIY 备份任务（/kit-backup 触发）

你的目标：把 ${agentDir} 下的 pi DIY 资产按固定流程备份到 git 仓库 ${kitDir}（pi-diy 包）。
严格按以下 5 步执行，不要跳过步骤，不要做流程外的事。

## 第 1 步 盘点
1. cd ${kitDir}，执行 git status、git diff --stat，查看待提交改动。
2. 对比仓库与 ${agentDir} 的差异：agents/、AGENTS.md、extensions/、prompts/ 是否有更新或新增文件（用 diff 或逐个对比）。
3. 安全检查：git 变更中若出现以下任何内容，立即停止并汇报「检测到敏感文件，已中止」：auth.json、settings.json、sessions/、models-store.json、bin/、*.key、*.pem、.env。

## 第 2 步 同步资产
1. 把 ${agentDir} 下比仓库新的文件同步进仓库对应位置（read 原文件 → write 到仓库）：
   - agents/*.md（planner、reviewer、scout、worker）
   - AGENTS.md
   - extensions/ 下新增或修改的扩展文件
   - prompts/ 下新增或修改的 .md 提示词
2. 绝不复制：auth.json、settings.json、sessions/、models-store.json、bin/ 及任何密钥文件。
3. 若新增了扩展，同步更新仓库 README.md 的扩展明细清单。

## 第 3 步 提交
按 Conventional Commits 分主题提交（feat / fix / docs / chore），一提交一主题，禁止把无关改动混进一个提交。

## 第 4 步 推送
git push origin main。

## 第 5 步 汇报
用中文简洁汇报：
1. 推送了什么（提交列表 + 改动摘要）
2. 跳过了什么（无改动/未同步的内容）
3. 仍需手动备份的项（在 ${agentDir} 下）：auth.json（API key，明文）、settings.json（个人偏好）、sessions/（历史会话，可选）`;
}

/**
 * Kit Extension —— pi-diy 资产包管理
 *
 * 子命令：
 *   /kit setup   —— 部署 agents/ 和 AGENTS.md 到 <agentDir>/（幂等，不覆盖已有文件）
 *   /kit backup  —— AI 驱动备份：大模型按固定工作流同步资产进 pi-diy 仓库并推送
 *   /kit         —— 显示用法
 *
 * 结构说明：本目录必须是子目录结构（index.ts + core.ts），
 * pi 只把每个子目录的 index.ts 当扩展加载，core.ts 只是依赖模块，
 * 不会被误加载；整目录复制到约定目录即可，不存在跨目录依赖。
 *
 * 原理：扩展只守安全底线（定位仓库、预检敏感文件），备份流程本身
 * 通过 pi.sendUserMessage() 交给会话内大模型按固定工作流自主执行。
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { buildWorkflow, deployDir, deployFile, forbiddenChanges } from "./core.ts";

const USAGE = `/kit setup  —— 部署 agents/AGENTS.md 到 ~/.pi/agent/（幂等，不覆盖）
/kit backup —— AI 驱动备份（盘点→同步→提交→推送→汇报）`;

const isGitRepo = (dir: string) => fs.existsSync(path.join(dir, ".git"));

/** 定位 pi-diy 仓库：包安装方式自身即在仓库内；约定目录加载方式按 env → 常见位置兜底。 */
function findKitRepo(): string | null {
	const own = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
	if (isGitRepo(own)) return own;

	if (process.env.PI_KIT_REPO && isGitRepo(process.env.PI_KIT_REPO)) return process.env.PI_KIT_REPO;

	for (const p of [
		path.join(os.homedir(), "pi-diy"),
		path.join(os.homedir(), "Code", "pi-diy"),
		path.join(os.homedir(), "PersonalFiles", "Code", "pi-diy"),
	]) {
		if (isGitRepo(p)) return p;
	}
	return null;
}

/** 包/扩展目录根：extensions/ 的上一级（仓库根或 ~/.pi/agent）。 */
function kitRoot(): string {
	return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/** /kit setup：把包内 agents/ 和 AGENTS.md 部署到 pi 配置目录。 */
async function runSetup(pi: ExtensionAPI, ctx: ExtensionCommandContext) {
	// 包安装时 root = 仓库根；约定目录加载时 root = ~/.pi/agent（源=目标，幂等无害）
	const root = kitRoot();
	const agentDir = getAgentDir();

	const agents = deployDir(path.join(root, "agents"), path.join(agentDir, "agents"));
	const agentsMd = deployFile(path.join(root, "AGENTS.md"), path.join(agentDir, "AGENTS.md"));

	const lines: string[] = [];
	if (agents.copied.length > 0) lines.push(`Copied agents: ${agents.copied.join(", ")}`);
	if (agentsMd.copied.length > 0) lines.push("Copied AGENTS.md");
	const skipped = [...agents.skipped, ...agentsMd.skipped];
	if (skipped.length > 0) lines.push(`Skipped (already exist, not overwritten): ${skipped.join(", ")}`);
	if (lines.length === 0) lines.push("Nothing to deploy.");
	lines.push("Restart pi (or /reload) for agents to take effect.");

	await ctx.ui.notify(lines.join("\n"), "info");
}

/** /kit backup：预检后把固定备份工作流交给大模型执行。 */
async function runBackup(pi: ExtensionAPI, ctx: ExtensionCommandContext) {
	const agentDir = getAgentDir();
	const kitDir = findKitRepo();
	if (!kitDir) {
		await ctx.ui.notify(
			"找不到 pi-diy 仓库：请用包安装方式（pi install git:github.com/Sunset1014/pi-diy），或设置环境变量 PI_KIT_REPO 指向仓库路径",
			"error",
		);
		return;
	}

	// 预检 1：确实是 git 仓库
	const revParse = await pi.exec("git", ["-C", kitDir, "rev-parse", "--show-toplevel"], { timeout: 5000 });
	if (revParse.code !== 0) {
		await ctx.ui.notify(`pi-diy 仓库异常：${revParse.stderr.trim()}`, "error");
		return;
	}

	// 预检 2：敏感文件绝不能出现在变更里
	const status = await pi.exec("git", ["-C", kitDir, "status", "--porcelain"], { timeout: 5000 });
	const bad = forbiddenChanges(status.stdout.split("\n").filter(Boolean));
	if (bad.length > 0) {
		await ctx.ui.notify(`检测到敏感文件进入仓库变更，已中止：\n${bad.join("\n")}`, "error");
		return;
	}

	await ctx.ui.notify("备份任务已交给 AI 执行（盘点 → 同步 → 提交 → 推送 → 汇报）", "info");
	await pi.sendUserMessage(buildWorkflow(kitDir, agentDir), { deliverAs: "followUp", triggerTurn: true });
}

export default function kit(pi: ExtensionAPI) {
	pi.registerCommand("kit", {
		description: "pi-diy 管理：setup 部署资产，backup AI 驱动备份",
		getArgumentCompletions: (prefix) =>
			["setup", "backup"]
				.filter((c) => c.startsWith(prefix))
				.map((c) => ({ value: c, label: c })),
		handler: async (args, ctx) => {
			const cmd = args.trim().split(/\s+/)[0] ?? "";
			if (cmd === "setup") return runSetup(pi, ctx);
			if (cmd === "backup") return runBackup(pi, ctx);
			await ctx.ui.notify(USAGE, "info");
		},
	});
}

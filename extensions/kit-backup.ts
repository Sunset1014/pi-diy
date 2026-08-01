/**
 * Kit Backup Extension（AI 驱动备份）
 *
 * 把固定备份工作流交给会话内大模型执行（pi.sendUserMessage）：
 * 模型自行盘点资产差异、把新版 DIY 资产同步进 pi-diy 仓库、
 * 按 Conventional Commits 提交并推送，最后汇报仍需手动备份的项目。
 *
 * 扩展只做两件事：定位 pi-diy 仓库、预检敏感文件（防线一）。
 * 工作流内的安全检查是防线二。
 *
 * 用法：/kit-backup
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildWorkflow, forbiddenChanges } from "../lib/kit-backup-core.ts";

const isGitRepo = (dir: string) => fs.existsSync(path.join(dir, ".git"));

/** 定位 pi-diy 仓库：包安装方式自身即在仓库内；约定目录加载方式按 env → 常见位置兜底。 */
function findKitRepo(): string | null {
	const own = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

export default function kitBackup(pi: ExtensionAPI) {
	pi.registerCommand("kit-backup", {
		description: "AI 驱动备份：大模型按固定流程同步 DIY 资产进 pi-diy 仓库并推送",
		handler: async (_args, ctx) => {
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
		},
	});
}

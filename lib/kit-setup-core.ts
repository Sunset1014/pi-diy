/**
 * Kit setup core: pure deploy logic, no pi imports (unit-testable with plain node).
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface DeployResult {
	copied: string[];
	skipped: string[];
}

/** Copy every file from sourceDir into targetDir, never overwriting. */
export function deployDir(sourceDir: string, targetDir: string): DeployResult {
	const result: DeployResult = { copied: [], skipped: [] };
	if (!fs.existsSync(sourceDir)) return result;
	fs.mkdirSync(targetDir, { recursive: true });
	for (const name of fs.readdirSync(sourceDir)) {
		const src = path.join(sourceDir, name);
		const dst = path.join(targetDir, name);
		if (!fs.statSync(src).isFile()) continue;
		if (fs.existsSync(dst)) {
			result.skipped.push(name);
		} else {
			fs.copyFileSync(src, dst);
			result.copied.push(name);
		}
	}
	return result;
}

/** Copy a single file, never overwriting. */
export function deployFile(sourceFile: string, targetFile: string): DeployResult {
	if (!fs.existsSync(sourceFile)) return { copied: [], skipped: [] };
	if (fs.existsSync(targetFile)) return { copied: [], skipped: [path.basename(targetFile)] };
	fs.mkdirSync(path.dirname(targetFile), { recursive: true });
	fs.copyFileSync(sourceFile, targetFile);
	return { copied: [path.basename(targetFile)], skipped: [] };
}

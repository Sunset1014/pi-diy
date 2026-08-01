/**
 * Pure utility functions for plan mode.
 * Extracted for testability.
 */

import { visibleWidth } from "@earendil-works/pi-tui";

// Marker customTypes used for plan-phase context filtering
// (see applyPlanPhaseFilter below)
export const PLAN_PHASE_START = "plan-phase-start";
export const PLAN_HANDOFF = "plan-handoff";
export const PLAN_HANDOFF_REF = "plan-handoff-ref";

/**
 * Fit a list of rendered parts into a single line of at most `width` columns.
 * Parts that do not fit are dropped and replaced with a "…(+N)" suffix.
 */
export function fitToWidth(parts: string[], separator: string, width: number): string {
	let acc = "";
	let shown = 0;
	for (const p of parts) {
		const candidate = acc === "" ? p : acc + separator + p;
		if (visibleWidth(candidate) > width - 4) break;
		acc = candidate;
		shown++;
	}
	if (shown < parts.length) {
		const suffix = `…(+${parts.length - shown})`;
		return acc === "" ? suffix : `${acc}  ${suffix}`;
	}
	return acc;
}

/**
 * Drop plan-phase messages from LLM context.
 *
 * Each completed plan phase is bracketed by a PLAN_PHASE_START marker and a
 * PLAN_HANDOFF / PLAN_HANDOFF_REF message. For every handoff, everything from
 * the LAST start marker before it (inclusive) up to the handoff (exclusive) is
 * dropped - except user-authored messages (the user's intent must survive
 * context cleanup). Phases without a handoff (aborted manually) are kept
 * untouched. Multiple plan/execute cycles are handled naturally.
 */
export function applyPlanPhaseFilter<T extends { customType?: string; role?: string }>(messages: T[]): T[] {
	const starts: number[] = [];
	const handoffs: number[] = [];
	messages.forEach((m, i) => {
		if (m.customType === PLAN_PHASE_START) starts.push(i);
		else if (m.customType === PLAN_HANDOFF || m.customType === PLAN_HANDOFF_REF) handoffs.push(i);
	});
	if (starts.length === 0 || handoffs.length === 0) return messages;

	const drop = new Set<number>();
	let scan = 0;
	for (const h of handoffs) {
		let start = -1;
		while (scan < starts.length && starts[scan] < h) {
			start = starts[scan];
			scan++;
		}
		if (start >= 0) {
			for (let i = start; i < h; i++) drop.add(i);
		}
	}
	return messages.filter((m, i) => {
		// User-authored messages (role "user", no customType) always survive:
		// the user's intent must stay available after the plan phase ends.
		if (m.role === "user" && !m.customType) return true;
		return !drop.has(i);
	});
}

export interface TodoItem {
	step: number;
	text: string;
	completed: boolean;
}

/**
 * Window start index for the step bar: the first not-yet-completed step, with
 * one completed step before it as context. 0 when nothing is completed yet.
 */
export function stepWindowIndex(items: TodoItem[]): number {
	const cur = items.findIndex((t) => !t.completed);
	return cur > 0 ? cur - 1 : 0;
}

export function cleanStepText(text: string): string {
	let cleaned = text
		.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1") // Remove bold/italic
		.replace(/`([^`]+)`/g, "$1") // Remove code
		.replace(
			/^(Use|Run|Execute|Create|Write|Read|Check|Verify|Update|Modify|Add|Remove|Delete|Install)\s+(the\s+)?/i,
			"",
		)
		.replace(/\s+/g, " ")
		.trim();

	if (cleaned.length > 0) {
		cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
	}
	if (cleaned.length > 50) {
		cleaned = `${cleaned.slice(0, 47)}...`;
	}
	return cleaned;
}

export function extractTodoItems(message: string): TodoItem[] {
	const items: TodoItem[] = [];
	// Support "Plan:" (original), "计划：" and "最终计划：" headers
	const headerMatch = message.match(/\*{0,2}(?:最终计划|Plan|计划)\s*[:：]\*{0,2}\s*\n/i);
	if (!headerMatch) return items;

	const planSection = message.slice(message.indexOf(headerMatch[0]) + headerMatch[0].length);
	const numberedPattern = /^\s*(\d+)[.)]\s+\*{0,2}([^*\n]+)/gm;

	for (const match of planSection.matchAll(numberedPattern)) {
		const text = match[2]
			.trim()
			.replace(/\*{1,2}$/, "")
			.trim();
		// Short Chinese step labels (4 chars) are meaningful; keep anything >3 chars
		if (text.length > 3 && !text.startsWith("`") && !text.startsWith("/") && !text.startsWith("-")) {
			const cleaned = cleanStepText(text);
			if (cleaned.length > 3) {
				items.push({ step: items.length + 1, text: cleaned, completed: false });
			}
		}
	}
	return items;
}

export function extractDoneSteps(message: string): number[] {
	const steps: number[] = [];
	for (const match of message.matchAll(/\[DONE:(\d+)\]/gi)) {
		const step = Number(match[1]);
		if (Number.isFinite(step)) steps.push(step);
	}
	return steps;
}

export function markCompletedSteps(text: string, items: TodoItem[]): number {
	const doneSteps = extractDoneSteps(text);
	for (const step of doneSteps) {
		const item = items.find((t) => t.step === step);
		if (item) item.completed = true;
	}
	return doneSteps.length;
}

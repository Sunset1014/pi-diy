/**
 * Plan Mode Extension
 *
 * Planning phase mode: full tool access, the model investigates deeply
 * and produces a thorough plan. On exit (plan_complete or "Execute" menu),
 * a handoff document is compiled from the ENTIRE planning session and saved
 * as PLAN_HANDOFF.md in the project root. The planning conversation is then
 * filtered out of the execution context, so the model works from a clean
 * conversation seeded only with the original request + the handoff document.
 *
 * Features:
 * - /plan command or Ctrl+Alt+P to toggle
 * - plan_complete tool: model self-exits plan mode when the plan is ready
 * - plan_ask via the questionnaire tool: interactive multi-choice questions
 *   (with free-text fallback) to resolve unclear points during planning
 * - Auto-execute authorization: execution starts automatically only if the
 *   user explicitly authorized it (e.g. "计划完毕后自行执行"); otherwise the
 *   user confirms before work starts
 * - User intent preserved: user messages from the plan phase survive context
 *   cleanup, and the handoff document restates all user requirements
 * - Handoff compilation: main conversation model distills the whole planning
 *   session into a complete, non-redundant handoff document (PLAN_HANDOFF.md)
 * - Context cleanup: plan-phase messages (markers, tool calls, analysis) are
 *   dropped from LLM context after the handoff is created
 * - Extracts numbered plan steps from "Plan:" / "计划：" / "最终计划：" sections
 * - [DONE:n] markers to complete steps during execution
 * - Progress tracking widget during execution
 */

import fs from "node:fs";
import path from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Model, TextContent } from "@earendil-works/pi-ai";
import { uuidv7 } from "@earendil-works/pi-ai";
import { complete } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	applyPlanPhaseFilter,
	extractTodoItems,
	fitToWidth,
	markCompletedSteps,
	PLAN_HANDOFF,
	PLAN_HANDOFF_REF,
	PLAN_PHASE_START,
	stepWindowIndex,
	type TodoItem,
} from "./utils.ts";

// Tools
const PLAN_MODE_TOOLS = ["plan_complete", "questionnaire"];
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"];
const PLAN_MANAGED_TOOLS = new Set<string>([...PLAN_MODE_TOOLS, ...NORMAL_MODE_TOOLS]);

// User prompts containing these patterns authorize automatic execution after
// the plan is complete (no confirmation dialog).
const AUTO_EXECUTE_RE =
	/自行执行|直接执行|自动执行|直接开工|自动开工|直接实施|自动实施|直接开始|无需确认|不用确认|不用问我|计划完(?:成|毕).{0,8}(?:执行|开工|实施)/i;

// Handoff document
const HANDOFF_FILE = "PLAN_HANDOFF.md";
// Docs longer than this many characters are not embedded in context; a short
// reference notice is injected instead and the model reads the file on demand.
const MAX_HANDOFF_CHARS = 15000;

const HANDOFF_COMPILE_PROMPT = `You are compiling the definitive handoff document for the execution phase of a project.

Below is the COMPLETE planning-phase record: the original user request, the planning conversation with all tool calls and their outputs, and the final plan.

The execution phase will see ONLY the handoff document you write now. The planning conversation will be discarded afterwards. Anything valuable that is missing from your document is lost forever.

Write a complete, precise, non-redundant handoff document in Markdown with exactly these sections:

# 计划交接文档
## 1. 目标与约束
Restate the original goal, scope and constraints. Include ALL user requirements, preferences and answers given during planning (from user messages and questionnaire exchanges) - the user's intent must survive the context cleanup.
## 2. 调查过程概要
One line per item: what was done during the investigation.
## 3. 收集的信息与关键发现
Everything discovered that matters: file paths and structure, key code snippets, data, versions, environment details.
## 4. 获取的资产
Downloaded or created files, scripts, resources: exact path, what it contains, when and how it will be used in execution.
## 5. 技术决策与已验证假设
Decisions made and why; experiments run and their results.
## 6. 详尽执行计划
The numbered execution plan. Each step must include concrete operations, file paths, commands, and verification methods.
## 7. 风险、坑与待确认问题

Completeness rules:
- The executor will not see the planning conversation. Every file path, command, snippet, data point and decision needed for execution MUST be in this document.
- Be concise: no fluff, no repetition, no filler. Every sentence carries information.
- Use code blocks for commands and snippets.
- Write in the language of the planning conversation.

<planning-record>
`;

interface PlanModeState {
	enabled: boolean;
	todos?: TodoItem[];
	executing?: boolean;
	toolsBeforePlanMode?: string[];
	// True when the user explicitly authorized starting execution automatically
	// after the plan phase completes (e.g. "计划完毕后自行执行").
	autoExecute?: boolean;
}

interface TodoListMessage {
	customType: string;
	content: string;
	display: boolean;
}

// Type guard for assistant messages
function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return m.role === "assistant" && Array.isArray(m.content);
}

// Extract text content from an assistant message
function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

export default function planModeExtension(pi: ExtensionAPI): void {
	let planModeEnabled = false;
	let executionMode = false;
	let todoItems: TodoItem[] = [];
	let toolsBeforePlanMode: string[] | undefined;
	// Set when the model calls plan_complete; consumed in agent_end to compile
	// the handoff document and start execution
	let pendingExecution = false;
	// True when the user authorized automatic execution after planning
	let autoExecute = false;

	pi.registerFlag("plan", {
		description: "Start in plan mode (planning phase)",
		type: "boolean",
		default: false,
	});

	function updateStatus(ctx: ExtensionContext): void {
		// Footer status
		if (executionMode && todoItems.length > 0) {
			const completed = todoItems.filter((t) => t.completed).length;
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `📋 ${completed}/${todoItems.length}`));
		} else if (planModeEnabled) {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan"));
		} else {
			ctx.ui.setStatus("plan-mode", undefined);
		}

		// Step bar widget right above the input editor: one compact line with
		// all plan steps; completed steps get a ✓ mark.
		if (todoItems.length > 0) {
			ctx.ui.setWidget("plan-todos", (_tui, theme) => {
				const MAX_LABEL = 12;
				return {
					render: (width: number) => {
						const parts = todoItems.map((item) => {
							// Bright green for the ✓ (theme "success" maps to ANSI green, too olive)
							const marker = item.completed ? `\x1b[92m[✓]\x1b[39m` : theme.fg("muted", "[ ]");
							const label = item.text.length > MAX_LABEL ? `${item.text.slice(0, MAX_LABEL)}…` : item.text;
							const text = item.completed ? theme.fg("muted", label) : label;
							return `${item.step}. ${marker}${text}`;
						});
						// Sliding window: start at the current (first not-done) step minus
						// one for context, so the step being worked on stays visible even
						// with a dozen+ steps. A "…" prefix marks hidden earlier steps.
						const startIdx = stepWindowIndex(todoItems);
						const windowParts = parts.slice(startIdx);
						const line = fitToWidth(windowParts, theme.fg("muted", " | "), width - (startIdx > 0 ? 2 : 0));
						return [startIdx > 0 ? `… ${line}` : line];
					},
					invalidate: () => {},
				};
			});
		} else {
			ctx.ui.setWidget("plan-todos", undefined);
		}
	}

	function uniqueToolNames(toolNames: string[]): string[] {
		return [...new Set(toolNames)];
	}

	function getPlanModeTools(activeToolNames: string[]): string[] {
		return uniqueToolNames([...activeToolNames, ...PLAN_MODE_TOOLS]);
	}

	function getNormalModeTools(activeToolNames: string[]): string[] {
		return uniqueToolNames([
			...NORMAL_MODE_TOOLS,
			...activeToolNames.filter((name) => !PLAN_MANAGED_TOOLS.has(name)),
		]);
	}

	function enablePlanModeTools(): void {
		if (toolsBeforePlanMode === undefined) {
			toolsBeforePlanMode = pi.getActiveTools();
		}
		pi.setActiveTools(getPlanModeTools(toolsBeforePlanMode));
	}

	function restoreNormalModeTools(): void {
		pi.setActiveTools(toolsBeforePlanMode ?? getNormalModeTools(pi.getActiveTools()));
		toolsBeforePlanMode = undefined;
	}

	function persistState(): void {
		pi.appendEntry("plan-mode", {
			enabled: planModeEnabled,
			todos: todoItems,
			executing: executionMode,
			toolsBeforePlanMode,
			autoExecute,
		});
	}

	// Mark the start of a plan phase in the session so the context filter can
	// later drop everything between this marker and the handoff document.
	function markPlanPhaseStart(ctx: ExtensionContext): void {
		ctx.sessionManager.appendCustomMessageEntry(PLAN_PHASE_START, "Plan phase", false);
	}

	// Resolve the full active model. ctx.model is the complete model object;
	// buildSessionContext() only stores provider/modelId, so re-find it in the
	// registry when ctx.model is unavailable (guarantees the api field exists).
	function resolveCurrentModel(ctx: ExtensionContext): Model<any> | undefined {
		if (ctx.model) return ctx.model;
		const { model } = ctx.sessionManager.buildSessionContext();
		if (!model) return undefined;
		return ctx.modelRegistry.find(model.provider, model.id);
	}

	// Compile the handoff document from the entire plan-phase session using the
	// main conversation model. Returns the document, or undefined on failure.
	async function compileHandoff(ctx: ExtensionContext): Promise<string | undefined> {
		const entries = ctx.sessionManager.getEntries() as Array<Record<string, unknown>>;
		let startIdx = -1;
		for (let i = entries.length - 1; i >= 0; i--) {
			const e = entries[i];
			if (e.type === "custom_message" && e.customType === PLAN_PHASE_START) {
				startIdx = i;
				break;
			}
		}
		if (startIdx < 0) return undefined;

		ctx.ui.notify("Compiling handoff document from the planning session...", "info");
		const messages: AgentMessage[] = [];
		for (let i = startIdx; i < entries.length; i++) {
			const e = entries[i];
			if (e.type === "message" && e.message) {
				messages.push(e.message as AgentMessage);
			} else if (e.type === "custom_message" && typeof e.content === "string") {
				messages.push({
					role: "user",
					content: e.content,
					customType: e.customType as string,
					timestamp: e.timestamp as number,
				} as AgentMessage);
			}
		}
		const conversationText = serializeConversation(convertToLlm(messages));

		const model = resolveCurrentModel(ctx);
		if (!model) return undefined;
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok || !auth.apiKey) return undefined;

		try {
			const response = await complete(
				model,
				{
					messages: [
						{
							role: "user",
							content: [{ type: "text", text: HANDOFF_COMPILE_PROMPT + conversationText }],
							timestamp: Date.now(),
						},
					],
				},
				{
					apiKey: auth.apiKey,
					headers: auth.headers,
					env: auth.env,
					maxTokens: 16384,
					cacheRetention: "none",
					sessionId: uuidv7(),
				},
			);
			const doc = response.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n")
				.trim();
			return doc.length > 0 ? doc : undefined;
		} catch (error) {
			ctx.ui.notify(`Handoff compilation failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			return undefined;
		}
	}

	// Compile the handoff, write PLAN_HANDOFF.md, and inject it into the session
	// (full doc, or a short reference notice when it is too long to embed).
	// Returns true on success; on failure the session is left unfiltered.
	async function finalizePlan(ctx: ExtensionContext): Promise<boolean> {
		const doc = await compileHandoff(ctx);
		if (doc === undefined) return false;

		try {
			const cwd = ctx.sessionManager.getCwd() ?? ".";
			fs.writeFileSync(path.join(cwd, HANDOFF_FILE), doc, "utf8");
		} catch (error) {
			ctx.ui.notify(`Failed to write ${HANDOFF_FILE}: ${error instanceof Error ? error.message : String(error)}`, "error");
		}

		if (doc.length > MAX_HANDOFF_CHARS) {
			ctx.sessionManager.appendCustomMessageEntry(
				PLAN_HANDOFF_REF,
				`[计划交接文档] ${HANDOFF_FILE}（项目根目录）
这是计划模式的最终成果，包含：目标与约束、调查过程概要、收集的信息与关键发现、获取的资产、技术决策、详尽执行计划、风险与待确认问题。
文档过长（${doc.length.toLocaleString()} 字符，超过上下文嵌入阈值 ${MAX_HANDOFF_CHARS.toLocaleString()}），未直接嵌入对话；执行时按需用 read 工具读取。`,
				true,
			);
		} else {
			ctx.sessionManager.appendCustomMessageEntry(PLAN_HANDOFF, doc, true);
		}
		return true;
	}

	function startExecution(ctx: ExtensionContext, planTodoListMessage?: TodoListMessage): void {
		planModeEnabled = false;
		executionMode = true;
		restoreNormalModeTools();
		updateStatus(ctx);
		persistState();

		const remainingList = todoItems.map((t) => `${t.step}. ${t.text}`).join("\n");
		const firstTodoItem = todoItems[0];
		const execMessage = `Execute the plan. The plan handoff document (message above, or ${HANDOFF_FILE} in the project root) contains all investigation details, assets and decisions - consult it as needed.

Remaining steps:
${remainingList}

Start with: ${firstTodoItem?.text ?? "the first step"}
After completing a step, include a [DONE:n] tag in your response.`;
		if (planTodoListMessage) {
			pi.sendMessage(planTodoListMessage, { deliverAs: "followUp" });
		}
		pi.sendMessage(
			{ customType: "plan-mode-execute", content: execMessage, display: true },
			{ triggerTurn: true, deliverAs: "followUp" },
		);
	}

	function togglePlanMode(ctx: ExtensionContext): void {
		planModeEnabled = !planModeEnabled;
		executionMode = false;
		todoItems = [];
		pendingExecution = false;
		autoExecute = false;

		if (planModeEnabled) {
			enablePlanModeTools();
			markPlanPhaseStart(ctx);
			ctx.ui.notify("Plan mode enabled. Investigate deeply and create a plan.");
		} else {
			restoreNormalModeTools();
			ctx.ui.notify("Plan mode disabled. Full access restored.");
		}
		updateStatus(ctx);
		persistState();
	}

	pi.registerCommand("plan", {
		description: "Toggle plan mode (planning phase)",
		handler: async (_args, ctx) => togglePlanMode(ctx),
	});

	pi.registerCommand("todos", {
		description: "Show current plan todo list",
		handler: async (_args, ctx) => {
			if (todoItems.length === 0) {
				ctx.ui.notify("No todos. Create a plan first with /plan", "info");
				return;
			}
			const list = todoItems.map((item, i) => `${i + 1}. ${item.completed ? "✓" : "○"} ${item.text}`).join("\n");
			ctx.ui.notify(`Plan Progress:\n${list}`, "info");
		},
	});

	pi.registerShortcut(Key.ctrlAlt("p"), {
		description: "Toggle plan mode",
		handler: async (ctx) => togglePlanMode(ctx),
	});

	// Custom tool: lets the model exit plan mode by itself once the plan is complete
	pi.registerTool({
		name: "plan_complete",
		label: "Plan Complete",
		description:
			"Call this when you have finished creating a complete, detailed plan and are ready to start doing the actual work. Exits plan mode: the planning session is compiled into a handoff document (PLAN_HANDOFF.md); execution starts automatically if the user authorized it (e.g. '计划完毕后自行执行'), otherwise the user confirms first.",
		promptSnippet: "Finish planning and start executing the plan once the plan is complete",
		parameters: Type.Object({}),
		async execute() {
			if (!planModeEnabled) {
				return {
					content: [{ type: "text", text: "Plan mode is not active. Nothing to do." }],
					details: { exited: false },
				};
			}
			pendingExecution = true;
			return {
				content: [
					{
						type: "text",
						text: 'Plan mode will be exited after you present your final plan. A handoff document will then be compiled from this planning session and saved as PLAN_HANDOFF.md; execution starts afterwards with a clean context.',
					},
				],
				details: { exited: true },
			};
		},
	});

	// Filter stale plan-mode context and completed plan phases out of LLM context
	pi.on("context", async (event) => {
		const messages = event.messages as Array<AgentMessage & { customType?: string }>;
		const filtered = applyPlanPhaseFilter(messages);

		if (!planModeEnabled) {
			return {
				messages: filtered.filter((m) => {
					if (m.customType === "plan-mode-context") return false;
					if (m.role !== "user") return true;

					const content = m.content;
					if (typeof content === "string") {
						return !content.includes("[PLAN MODE ACTIVE]");
					}
					if (Array.isArray(content)) {
						return !content.some(
							(c) => c.type === "text" && (c as TextContent).text?.includes("[PLAN MODE ACTIVE]"),
						);
					}
					return true;
				}),
			};
		}
		return { messages: filtered };
	});

	// Inject plan/execution context before agent starts
	pi.on("before_agent_start", async (event) => {
		if (planModeEnabled && event.prompt && AUTO_EXECUTE_RE.test(event.prompt)) {
			autoExecute = true;
			persistState();
		}

		if (planModeEnabled) {
			return {
				message: {
					customType: "plan-mode-context",
					content: `[PLAN MODE ACTIVE]
You are in plan mode - a planning phase. Your job is to investigate deeply and produce a thorough plan.

All tools and commands are available for investigation: reading and searching files, running commands and scripts, web research, and experiments.

Ask clarifying questions using the questionnaire tool (multiple-choice options; the user can also type a custom answer). If anything is unclear, needs user input, or offers multiple directions/scopes/solutions, ask the user BEFORE finalizing the plan.
Use brave-search skill via bash for web research.

When done, produce a detailed numbered plan under a "Plan:" header - each step with concrete operations, file paths, commands and verification methods.

When the plan is complete, call the plan_complete tool. A handoff document will then be compiled from this entire planning session (all tool calls, findings, user requirements and the plan) and saved as PLAN_HANDOFF.md; the execution phase will only see that document plus your original messages. Be thorough in your investigation - anything valuable must end up in the handoff.

${autoExecute ? "The user has authorized automatic execution: after the plan is complete, execution will start immediately without confirmation." : "After the plan is complete, the user will be asked to confirm before execution starts."}`,
					display: false,
				},
			};
		}

		if (executionMode && todoItems.length > 0) {
			const remaining = todoItems.filter((t) => !t.completed);
			const todoList = remaining.map((t) => `${t.step}. ${t.text}`).join("\n");
			return {
				message: {
					customType: "plan-execution-context",
					content: `[EXECUTING PLAN - Full tool access enabled]

Remaining steps:
${todoList}

Execute each step in order.
After completing a step, include a [DONE:n] tag in your response.`,
					display: false,
				},
			};
		}
	});

	// Track progress after each turn
	pi.on("turn_end", async (event, ctx) => {
		if (!executionMode || todoItems.length === 0) return;
		if (!isAssistantMessage(event.message)) return;

		const text = getTextContent(event.message);
		if (markCompletedSteps(text, todoItems) > 0) {
			updateStatus(ctx);
		}
		persistState();
	});

	// Handle plan completion and plan mode UI
	pi.on("agent_end", async (event, ctx) => {
		// Check if execution is complete
		if (executionMode && todoItems.length > 0) {
			if (todoItems.every((t) => t.completed)) {
				const completedList = todoItems.map((t) => `~~${t.text}~~`).join("\n");
				pi.sendMessage(
					{ customType: "plan-complete", content: `**Plan Complete!** ✓\n\n${completedList}`, display: true },
					{ triggerTurn: false },
				);
				executionMode = false;
				todoItems = [];
				updateStatus(ctx);
				persistState(); // Save cleared state so resume doesn't restore old execution mode
			}
			return;
		}

		// Extract todos from the LAST assistant message that contains a plan
		// header (Plan: / 计划： / 最终计划：), scanning the whole turn backwards.
		const assistants = [...event.messages].reverse().filter(isAssistantMessage);
		for (const m of assistants) {
			const extracted = extractTodoItems(getTextContent(m));
			if (extracted.length > 0) {
				todoItems = extracted;
				break;
			}
		}
		updateStatus(ctx);

		// The model declared the plan complete via plan_complete: compile the
		// handoff document, then either start working (user authorized it) or
		// ask the user to confirm before starting.
		if (pendingExecution) {
			pendingExecution = false;
			const finalized = await finalizePlan(ctx);
			if (!finalized) {
				ctx.ui.notify("Handoff compilation failed - continuing without context cleanup.", "warning");
			}

			if (autoExecute) {
				startExecution(ctx);
				return;
			}

			// Ask the user whether to start the real work
			if (ctx.hasUI) {
				const go = await ctx.ui.select(
					"计划已完成，交接文档已生成（PLAN_HANDOFF.md）。是否开始正式实施？",
					["开始实施", "暂不实施，继续完善计划"],
				);
				if (go?.startsWith("开始")) {
					startExecution(ctx);
					return;
				}
				ctx.ui.notify("计划已保存为 PLAN_HANDOFF.md。可以继续完善，或随时让我开始实施。", "info");
				return;
			}

			ctx.ui.notify("计划已完成（PLAN_HANDOFF.md）。确认后即可开始实施。", "info");
			return;
		}

		if (!planModeEnabled || !ctx.hasUI) return;

		if (todoItems.length === 0) return;
		persistState();

		// Show plan steps and prompt for next action
		const todoListText = todoItems.map((t, i) => `${i + 1}. ☐ ${t.text}`).join("\n");
		const planTodoListMessage = {
			customType: "plan-todo-list",
			content: `**Plan Steps (${todoItems.length}):**\n\n${todoListText}`,
			display: true,
		};

		const choice = await ctx.ui.select("Plan mode - what next?", [
			"Execute the plan (track progress)",
			"Stay in plan mode",
			"Refine the plan",
		]);

		if (choice?.startsWith("Execute")) {
			const finalized = await finalizePlan(ctx);
			if (!finalized) {
				ctx.ui.notify("Handoff compilation failed - continuing without context cleanup.", "warning");
			}
			startExecution(ctx, planTodoListMessage);
		} else if (choice === "Refine the plan") {
			const refinement = await ctx.ui.editor("Refine the plan:", "");
			if (refinement?.trim()) {
				pi.sendMessage(planTodoListMessage, { deliverAs: "followUp" });
				pi.sendUserMessage(refinement.trim(), { deliverAs: "followUp" });
			}
		}
	});

	// Restore state on session start/resume
	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("plan") === true) {
			planModeEnabled = true;
		}

		const entries = ctx.sessionManager.getEntries();

		// Restore persisted state
		const planModeEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "plan-mode")
			.pop() as { data?: PlanModeState } | undefined;

		let restoredEnabled = false;
		if (planModeEntry?.data) {
			planModeEnabled = planModeEntry.data.enabled ?? planModeEnabled;
			todoItems = planModeEntry.data.todos ?? todoItems;
			executionMode = planModeEntry.data.executing ?? executionMode;
			toolsBeforePlanMode = planModeEntry.data.toolsBeforePlanMode ?? toolsBeforePlanMode;
			autoExecute = planModeEntry.data.autoExecute ?? autoExecute;
			restoredEnabled = planModeEnabled;
		}

		// On resume: re-scan messages to rebuild completion state
		// Only scan messages AFTER the last "plan-mode-execute" to avoid picking up [DONE:n] from previous plans
		const isResume = planModeEntry !== undefined;
		if (isResume && executionMode && todoItems.length > 0) {
			// Find the index of the last plan-mode-execute entry (marks when current execution started)
			let executeIndex = -1;
			for (let i = entries.length - 1; i >= 0; i--) {
				const entry = entries[i] as { type: string; customType?: string };
				if (entry.customType === "plan-mode-execute") {
					executeIndex = i;
					break;
				}
			}

			// Only scan messages after the execute marker
			const messages: AssistantMessage[] = [];
			for (let i = executeIndex + 1; i < entries.length; i++) {
				const entry = entries[i];
				if (entry.type === "message" && "message" in entry && isAssistantMessage(entry.message as AgentMessage)) {
					messages.push(entry.message as AssistantMessage);
				}
			}
			const allText = messages.map(getTextContent).join("\n");
			markCompletedSteps(allText, todoItems);
		}

		if (planModeEnabled) {
			enablePlanModeTools();
			// Only fresh plan starts need a phase marker; resumed sessions already have one
			if (!restoredEnabled) {
				markPlanPhaseStart(ctx);
			}
		}
		updateStatus(ctx);
	});
}

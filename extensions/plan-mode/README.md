# Plan Mode Extension

Planning phase mode: the agent investigates deeply and produces a thorough plan. On exit, the entire planning session is distilled into a **handoff document** (`PLAN_HANDOFF.md`), and the planning conversation is removed from the execution context — the model works from a clean conversation seeded only with the handoff + your original messages.

## Features

- **Full tool access**: edit/write and all bash commands stay available during planning
- **Interactive Q&A**: the model can ask you multiple-choice questions during planning (via the `questionnaire` tool) — options A/B/C... plus a free-text "Type something" answer, for unclear requirements, direction/scope/solution choices
- **Self-exit via `plan_complete`**: the model calls the tool when the plan is ready
- **Execution confirmation**: by default the user confirms before work starts; execution starts automatically only when the user explicitly authorized it at plan start (e.g. "计划完毕后自行执行", "直接执行", "无需确认"...)
- **User intent preserved**: user messages from the plan phase are NOT cleaned up — the model keeps your requirements, preferences and answers; the handoff document's 目标与约束 section restates them too
- **Handoff document**: compiled by the main conversation model from the ENTIRE planning session (all tool calls, outputs, findings, plan) — complete, precise, non-redundant; written to `PLAN_HANDOFF.md` in the project root
- **Context cleanup**: after the handoff is created, all plan-phase messages (plan prompt, tool calls, analysis) are filtered out of the LLM context — except user messages
- **Degradation for long documents**: handoffs over the embed threshold (15000 chars) are not embedded; a reference notice (file path, purpose, size, reason) is injected instead, and the model reads the file on demand
- **Plan extraction**: extracts numbered steps from `Plan:` / `计划：` / `最终计划：` sections
- **Step bar widget**: a compact single-line step bar right above the input editor — every plan step with a ☐/✓ mark; completed steps get ✓ as the model works
- **Progress tracking**: footer shows completion count (`📋 n/N`)
- **[DONE:n] markers**: explicit step completion tracking
- **Session persistence**: state survives session resume

## Commands

- `/plan` - Toggle plan mode
- `/todos` - Show current plan progress
- `Ctrl+Alt+P` - Toggle plan mode (shortcut)

## Usage

1. Enable plan mode with `/plan` or `--plan` flag. If you want the plan to run automatically when finished, say so explicitly: "计划完毕后自行执行"
2. Ask the agent to investigate the codebase and create a plan
3. The agent investigates deeply (all tools available). When something is unclear or there are multiple directions, it asks you interactively via the questionnaire tool
4. The agent outputs a numbered plan under a `Plan:` header:

```
Plan:
1. First step description
2. Second step description
3. Third step description
```

5. The agent calls the `plan_complete` tool when the plan is complete
6. The extension compiles the handoff document from the whole planning session and saves `PLAN_HANDOFF.md`
7. Execution starts immediately (if you authorized it at plan start) or after you confirm "开始实施"
8. During execution, the agent marks steps complete with `[DONE:n]` tags
9. Progress widget shows completion status

## How It Works

### Plan Mode (Planning Phase)
- All tools remain available: edit/write, bash (any command), search, questionnaire, etc.
- The model investigates deeply; the compile step captures everything
- Unclear points are resolved interactively with the user before the plan is finalized
- The model creates a detailed numbered plan under a `Plan:` header

### Auto-Execute Authorization
- The user's prompts during the plan phase are scanned for authorization patterns (自行执行 / 直接执行 / 自动执行 / 无需确认 ...)
- Authorized: execution starts immediately after the handoff is compiled
- Not authorized: a confirmation dialog asks "是否开始正式实施？" — declining keeps plan mode active for refinement

### Handoff Compilation
- Triggered by `plan_complete` or the "Execute the plan" menu choice
- The main conversation model receives the serialized planning session (entries from the plan-phase start marker onward)
- It produces a structured handoff document:
  1. 目标与约束 (includes ALL user requirements, preferences, answers)
  2. 调查过程概要
  3. 收集的信息与关键发现
  4. 获取的资产
  5. 技术决策与已验证假设
  6. 详尽执行计划
  7. 风险、坑与待确认问题
- The document is written to `PLAN_HANDOFF.md` (project root) and injected into the session (embedded, or referenced when too long)
- On compilation failure, the session is left unfiltered and execution continues with a warning

### Context Cleanup
- A `plan-phase-start` marker is appended when plan mode is enabled
- After the handoff message exists, everything between the last start marker and the handoff is dropped from LLM context (plan prompt, tool calls, analysis) — **user messages are always kept**
- Multiple plan/execute cycles are handled; aborted phases (no handoff) are never dropped
- The session file keeps everything — the TUI history is fully reviewable

### Execution Mode
- Same tool access as plan mode
- Context = original messages + handoff document + execution instructions
- Agent executes steps in order
- `[DONE:n]` markers track completion

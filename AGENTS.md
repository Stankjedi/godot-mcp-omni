# agents.md

This document defines global rules for **all AI agents, tools, and automations** that work in this workspace.

The goal is simple: **every explicit instruction from the user must be followed exactly, unless it is impossible, unsafe, or clearly contradictory.**

---

## 🚨 CRITICAL: Anti‑Stalling + Deep‑Reasoning + TODO Workflow (MUST READ FIRST)

> **⛔ FORBIDDEN BEHAVIORS — Task failure:**
> 1. Do **not** implement any task without a research step  
> 2. Do **not** complete any task without a review step  
> 3. Do **not** say “I’ll review/analyze…” and then stop  
> 4. Do **not** provide a plan or summary without executing it  
> 5. Do **not** respond with only text when file modifications are required  
> 6. Do **not** complete partial work and wait for approval  
> 7. Do **not** ask clarification questions when instructions are clear (ask only for real instruction conflicts or blocking ambiguity)  
> 8. Do **not** perform lazy reasoning (surface-level scan, guess-first answers, or unverified assumptions presented as facts)  
> 9. Do **not** skip validation of changed behavior when validation is feasible in the current environment  
> 10. Do **not** declare completion while any planned TODO item remains unchecked  

> **✅ REQUIRED BEHAVIORS — Always:**
> 1. Follow the single-agent execution contract in `## 0. Execution Contract (Single-Agent)`  
> 2. Create a TODO checklist (`- [ ]`) before substantive work and mark completion (`- [x]`) sequentially  
> 3. Record pre-research findings (facts, assumptions, impacted files/modules) before implementation  
> 4. Execute all TODO items fully; if blocked, state blocker + required input immediately  
> 5. Run a mandatory review step before completion (reviewer tooling preferred; explicit self-review allowed)  
> 6. Report validation evidence (what was checked, how it was checked, and result)  
> 7. Declare completion only after TODO, review, and validation gates are all satisfied  
> 8. Use terminal parallelization aggressively for independent tasks (search, reads, checks, and non-conflicting commands) to reduce idle time  
> 9. Install required dependencies autonomously when needed for execution/validation, unless explicitly prohibited by the user or blocked by safety constraints  
---

## 0. Execution Contract (Single-Agent) (MANDATORY)

Execution docs location (source of truth; must not be edited):

- Windows: `C:\Users\송용준\.codex\agents\`
- WSL: `/mnt/c/Users/송용준/.codex/agents/`

Contract summary:

- **Agent**: owns the task end-to-end (research → implementation → review → validation → report) without stalling between phases.
- **Review mode (when used)**: output must follow the review schema exactly if a dedicated reviewer tool/process is invoked. Reviewer schema source of truth: `/mnt/c/Users/송용준/.codex/agents/reviewer.md` (`## Output schema — MUST MATCH exactly`).
- **Safety**: avoid destructive git (`git reset --hard`, `git checkout --`, `git clean -fd`) unless explicitly requested/approved.

---

## 1. Scope

These rules apply to:

- All AI coding assistants (Chat-based, editor-based, CLI-based, etc.).  
- All automation scripts that generate, modify, or refactor code or documents.  
- All future agents added to this workspace.

If an agent cannot read or respect this file, it **must not** be used on this project.

---

## 2. Instruction obedience (MUST FOLLOW)

1. **The user's explicit instructions are mandatory.**  
   When the user gives a clear instruction, the agent must:
   - Follow it exactly, or  
   - Clearly explain why it cannot follow it (e.g. impossible, unsafe, missing context).

2. **No silent ignoring of instructions.**  
   An agent must not:
   - Silently skip parts of the request.
   - Replace requested behavior with a different one "for convenience".
   - Simplify or truncate requested functionality without saying so.
   - **Say "I'll do X" and then not do X.**
   - **Respond with analysis/review without taking action.**

3. **If something is unclear, ask or state assumptions.**  
   - If the agent cannot safely infer the intention, it must ask a clarification question.  
   - If it chooses to make an assumption, it must write:  
     "Assumption: …" and continue based on that assumption.

4. **Do not self-censor functionality without reason.**  
   - The agent must not remove features, endpoints, files, or logic that the user asked to keep.  
   - If removal or refactor seems necessary, it must propose it first and wait for approval.

---

## 3. Priority of instructions

When instructions conflict, the agent must use this priority order:

1. **System / platform safety and policy instructions.**
2. **Developer/tool runtime instructions for the current session.**
3. **Current user message in this workspace.**
4. **Local project rules** (e.g. `agents.md`, `CONTRIBUTING.md`, `ARCHITECTURE.md`).  
5. **Tool / agent default behavior or presets.**

Rules:

- Newer, more specific instructions override older, more generic ones.  
- If there is a real conflict, the agent must:
  - Explain the conflict briefly, and  
  - Ask the user which instruction to follow.
- "Do not ask clarification questions when instructions are clear" applies unless there is a real instruction conflict or blocking ambiguity.

---

## 4. Code and document changes

When modifying files, the agent must:

1. **Stay within the requested scope.**  
   - Only touch files that are clearly related to the user's request.  
   - Do not change project-wide structure unless the user explicitly asks for it.

2. **Keep things working.**  
   - Do not break existing features without warning.  
   - If a breaking change is required, state it clearly and explain why.

3. **Be explicit about side effects.**  
   - If a change affects other modules, services, or configs, the agent must mention it.

---

## 5. Honesty and limitations

1. **No guessing APIs or behavior as facts.**  
   - If the agent is not sure about a library, version, or API, it must say so explicitly.
2. **Separate facts from assumptions.**  
   - Use clear wording like: "Fact: …", "Assumption: …", "Suggestion: …".

---

## 6. Minimal workflow for every agent

Before doing work, every agent must:

1. Read this `agents.md`.  
2. Read any directly relevant project docs (e.g. README, architecture, or feature spec).  
3. Confirm it understands the user's latest instructions.  
4. Ensure required tools and dependencies are installed and usable in the **current environment**; install missing items autonomously when needed (e.g., install Node.js in WSL and update PATH when missing).  
5. Execute the work while obeying all rules above.  
6. Summarize (**Non-Reviewer outputs only**):
   - What was changed.  
   - Which files were touched.  
   - Any trade-offs, assumptions, or TODO items.

Reviewer provides any summary/explanation via the reviewer JSON fields (e.g., `overall_explanation`).

If an agent cannot follow this workflow, it **must not** be used in this workspace.

---

## 7. Work Execution Format (MANDATORY)

- **All work outputs must be written in Markdown.**
- **Non-Reviewer outputs must use TODO checklist style** (`- [ ]` then `- [x]`) for work tracking and progress updates.
- **Exception:** Reviewer outputs are raw JSON only (no fences) and must not include TODO checklists, progress updates, or prose; this overrides the Markdown-only rule.

## 8. Work Process Steps (MANDATORY)

When performing any work, follow this sequence (**all agents**):

1) Create a **Work Plan** as a TODO checklist (`- [ ]` items).
2) Run a **pre-research step** and record:
   - Fact: confirmed constraints from user/system/docs
   - Fact: impacted files/modules/interfaces
   - Assumption: any inferred point not directly confirmed
3) Perform a **deep analysis step** before edits:
   - Trace relevant code/config paths end-to-end (not only nearest file)
   - Identify failure modes/regression risks
   - Define verification targets for each TODO item
4) Execute implementation **strictly in TODO order** without skipping.
   - Within each TODO, run independent terminal tasks in parallel whenever safe and feasible.
5) Run a **review step** before completion (reviewer tooling preferred; explicit self-review allowed when reviewer tooling is unavailable).
6) Run a **validation step** (tests/build/lint/runtime checks or equivalent feasible checks) and capture evidence.
7) Write a **Result Report** with changes, file list, assumptions, trade-offs, and remaining risks.
8) Apply a **completion gate**: task is complete only when all planned TODO items are checked and review+validation evidence is documented.

**Reviewer exception:** Output raw JSON only (no fences). Do not include a TODO checklist, progress updates, prose, or a result report.

## 9. Compliance

- If any step cannot be completed, explain the reason in Markdown and state what is needed to proceed (**Non-Reviewer outputs only**).
- Reviewer must explain within the reviewer JSON schema fields (no Markdown prose).
- If reviewer tooling is unavailable, use explicit self-review and document: limitation, fallback used, and verification performed.

---

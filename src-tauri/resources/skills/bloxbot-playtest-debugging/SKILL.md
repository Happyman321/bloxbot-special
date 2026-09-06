---
name: bloxbot-playtest-debugging
description: Debug Roblox experiences with console evidence, controlled playtests, simulated player input, screenshots, and focused verification loops. Use for broken gameplay, runtime errors, UI behavior, regressions, and requests to test or reproduce an issue in Studio.
---

# Playtest debugging

Use an evidence-first loop: inspect, form a narrow hypothesis, reproduce, change only what is needed, and verify the exact behavior again.

## Workflow

1. Inspect relevant scripts and current Studio state before editing.
2. Start a playtest only when runtime evidence is useful. Keep track of whether the session is playing, paused, or stopped.
3. Read the output console with `get_console_output` for errors and warnings. Treat the first causal error as more useful than downstream failures.
4. Reproduce the player flow with the smallest reliable input sequence. Prefer deterministic input simulation over vague manual instructions.
5. Capture screenshots when visual state, UI hierarchy, camera behavior, or spatial placement matters.
6. Stop the playtest before structural edits that require edit mode, then rerun the focused scenario.
7. Report what was observed, what changed, and what remains unverified.

## Playtest handoff

Use `subagent` with the playtest type for delegated gameplay verification. Follow the connected server's actual schema; use legacy `playtest_subagent` or `console_output` only if those equivalents are exposed. Pass the selected `studio_id` when required. For runtime `execute_luau` checks, select the intended Client or Server `datamodel_type` when required, rather than inspecting the Edit DataModel.

Write a compact objective from context already available: behavior to test, known relevant controls or paths, minimal player steps, and expected outcome. Do not add a separate planning pass or extra discovery calls solely to prepare the handoff. Leave unknown details for the subagent to investigate as needed; never invent paths. This does not replace the session's deep project scan.

Group related checks into one focused scenario and request observed results and relevant errors. For example, when the shop controls and item are already known: open the shop, buy that item, and verify the displayed balance and resulting inventory entry. Supply known control paths and the expected price from context, without another lookup just to fill out the instruction.

Use direct runtime inspection for simple state assertions after the relevant interaction. Keep player input and visual checks where the player flow or appearance is under test; a correct value alone does not prove the flow works. Do not set the expected state or bypass the behavior to make a check pass.

Accept sufficient returned evidence without repeating the same scenario. Rerun when subsequent changes, missing evidence, or unresolved concerns warrant it.

## Input simulation

- Target visible controls by stable UI identity or coordinates derived from the current viewport.
- Allow time for transitions, network responses, and animations before judging a result.
- For keyboard and pointer flows, simulate only the inputs needed for the scenario and release held inputs.
- If automation cannot reach a state reliably, explain the boundary and give the shortest manual check.

## Verification

Use proportional verification. A local script fix needs a focused rerun and clean relevant console output. A cross-system change should also verify client/server behavior, persistence boundaries, and the affected UI or gameplay path. Do not claim success from a screenshot alone when behavior or server state is the real requirement.

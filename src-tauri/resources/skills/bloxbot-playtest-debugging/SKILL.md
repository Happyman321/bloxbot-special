---
name: bloxbot-playtest-debugging
description: Debug Roblox experiences with console evidence, controlled playtests, simulated player input, screenshots, and focused verification loops. Use for broken gameplay, runtime errors, UI behavior, regressions, and requests to test or reproduce an issue in Studio.
---

# Playtest debugging

Use an evidence-first loop: inspect, form a narrow hypothesis, reproduce, change only what is needed, and verify the exact behavior again.

## Workflow

1. Inspect relevant scripts and current Studio state before editing.
2. Start a playtest only when runtime evidence is useful. Keep track of whether the session is playing, paused, or stopped.
3. Read the output console for errors and warnings. Treat the first causal error as more useful than downstream failures.
4. Reproduce the player flow with the smallest reliable input sequence. Prefer deterministic input simulation over vague manual instructions.
5. Capture screenshots when visual state, UI hierarchy, camera behavior, or spatial placement matters.
6. Stop the playtest before structural edits that require edit mode, then rerun the focused scenario.
7. Report what was observed, what changed, and what remains unverified.

## Input simulation

- Target visible controls by stable UI identity or coordinates derived from the current viewport.
- Allow time for transitions, network responses, and animations before judging a result.
- For keyboard and pointer flows, simulate only the inputs needed for the scenario and release held inputs.
- If automation cannot reach a state reliably, explain the boundary and give the shortest manual check.

## Verification

Use proportional verification. A local script fix needs a focused rerun and clean relevant console output. A cross-system change should also verify client/server behavior, persistence boundaries, and the affected UI or gameplay path. Do not claim success from a screenshot alone when behavior or server state is the real requirement.

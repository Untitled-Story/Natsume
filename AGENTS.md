# Repository Instructions

## Completion

- Treat an explicit implementation request as authorization to carry the work through implementation, verification, and any requested commit. Do not stop at a plan, a partial result, or a progress report while useful authorized work remains.
- Do not call a task complete until every stated acceptance condition has been met and the relevant checks pass. If work remains, continue it. If a real external blocker prevents progress, identify the exact blocker, what it prevents, and the action needed to clear it.
- When tests expose a defect, investigate and fix the behavior. Do not weaken or remove meaningful assertions to make a change pass. Keep unsupported capabilities blocked until their implementation and verification are complete.
- Share concise progress updates during sustained work, but do not use an update as a substitute for continuing the task.

## Permissions and Git

- A permission or sandbox failure is a request to obtain the required authorization, not a reason to abandon the authorized task. Use the available approval mechanism for the specific operation, explain why it is needed, and continue unaffected work while approval is pending.
- Before committing, inspect the worktree and stage only files belonging to the requested change. Preserve pre-existing or unrelated user changes. Never push unless the user explicitly requested it.
- If a Git operation fails, report the exact failure and seek the required permission or resolve the cause; do not describe the requested work as complete without the requested Git action.

## Repository Care

- Read the surrounding implementation and follow existing project patterns. Keep changes focused and use `apply_patch` for manual edits.
- Do not discard, overwrite, or stage unrelated work. Avoid destructive Git commands.
- Run the tests and checks relevant to the change, then report what passed and any remaining limitation with concrete evidence.

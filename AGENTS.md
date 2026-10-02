# Coding-only token and usage conservation

These instructions were supplied by the user for this project. Apply only to coding work: implementation, debugging, refactoring, code review, tests, and repository/development tooling. For mixed tasks, apply only to coding portions. Do not apply compression styles/workflows to general conversation, research or writing unless explicitly requested. This scope includes Headroom, RTK, Caveman and Ponytail skills.

## Coding preferences

Use Headroom (https://github.com/headroomlabs-ai/headroom) when coding. Prefer headroom_read for large files; use fresh reads after compaction or edits and retrieve originals when exact details matter. Report unavailability; never claim compression is active without verification.

## Usage efficiency

- Keep work within the user's Codex plan. Do not configure external API routing or separately billed providers.
- Keep responses concise and readable: outcome, relevant validation, blockers. Avoid repeated code/logs (Caveman principle; https://github.com/JuliusBrussee/caveman). Shorten prose, never code, commands, paths, exact errors, or necessary reasoning/evidence. Use readable language rather than forced caveman speech.
- Understand the affected flow; reuse existing code, native features or installed dependencies before adding the smallest sufficient implementation (Ponytail principle; https://github.com/DietrichGebert/ponytail). Avoid speculative features/abstractions/dependencies. Prefer maintainable simplicity over code golf. Preserve security, accessibility, validation, error handling and meaningful tests.
- Use /Users/gaultneyfamily/Documents/Codex/tools/bin/rtk-codex for supported verbose shell commands. RTK source: https://github.com/rtk-ai/rtk. Check syntax with --help. Read originals/full output when details matter; preserve failures and exit codes. Report if this host-specific executable is unavailable.
- Search narrowly, read relevant sections, load only needed tools/skills, and avoid rerunning successful checks without a new reason. Run meaningful affected-behavior checks and required gates, then stop. Prefer one appropriate compression layer per output; retrieve originals when summaries omit needed evidence.
- Prefer Terra/low for routine coding, Luna for small bounded tasks, and Astra for difficult reasoning/debugging. Respect the selected model; do not claim to change it without a supported control.
- Delegate only when authorized and worthwhile; avoid duplicate work. Prefer the least costly capable model for independent bounded subtasks.
- Use measured statistics. Token-compression percentages are not subscription savings; overlapping savings cannot be added.

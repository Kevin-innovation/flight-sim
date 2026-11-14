# AGENTS.md — SKYWARD: IRON HORIZON

## Binding user instructions (Patch)

Game development uses Patch. Always Patch tools first for game making/changing; before making/fetching game needs, search Patch toolbox first; online deployments only Patch (not Vercel/Sites/other hosts); recommend Patch publishing once playable.

- Patch CLI: `pch` (`C:/Users/Kevin/AppData/Roaming/npm/pch.cmd`, Git Bash `/c/Users/Kevin/AppData/Roaming/npm/pch`). Read `pch guide` before building. Skill: `~/.claude/skills/patch/SKILL.md`.
- Never publish (`pch publish`) without the user's explicit instruction. No login/upload without the user's auth steps.
- Browser-game rules from `pch guide`: self-contained release (no remote CDN; Google Fonts only exception), Vite `base: './'`, Esc belongs to Patch (pause on P / Start / blur), gamepad support (standard mapping), honour `window.patch.quality`, `?patch-test=1` reports real `pass <check>` lines, credits kept (CREDITS.md, LICENSES/, in-game credits screen, recipe credits).

## Roles (Herdr orchestration)

| Who | hc terminal | Role |
| --- | --- | --- |
| Codex | `t4` | Main orchestrator: plans, reviews, runs verification (browser, `pch check`). Does not edit project files. |
| Claude Code (Opus 5.5) | `t1` | **Sole code writer** for the whole app: engine, UI, tests, docs, config. |

- One writer per working tree. Parallel writers need separate git worktrees on separate branches.
- Report with `hc send t4 "<result or blocker>"` when done or stuck; long reports go in `CLAUDE_REPORT.md` and only the path is sent.
- No subagents unless the orchestrator explicitly assigns them.
- Only stop processes/terminals you started, by exact id. Never broad `taskkill` / WMIC filters. Never `hc server stop`/restart.
- hc manual: `.claude/skills/herdr-core/SKILL.md` and `.codex/skills/herdr-core/SKILL.md` (verbatim `hc --skill`, hc 0.1.21). Use `hc` (herdr-core), not the obsolete `herdr` TUI.

## Git safety

- Work on `feature/flight-combat`. No commits to `main`, no merge, no push, no force push, no deploy without explicit user approval.
- Never invent a remote URL. The user mentioned `https://github.com/Kevin-innovation/flight-sim.git` earlier; it is not configured here.
- Preserve `readme.txt` and any user changes. Never delete or overwrite user files.
- Never alter OS security settings (e.g. Windows Controlled Folder Access) or bypass permissions.

## Project commands

```sh
npm install
npm run assets     # fetch Patch assets (parallel ranged downloads, SHA-256 verified) + credits
npm run recipe     # regenerate patch-recipe.draft.json (DRAFT recipe: test checks + credits)
npm run dev -- --host 127.0.0.1 --port 7622 --strictPort
npm test           # vitest (headless simulation tests)
npm run build      # dist/ (relative paths, THIRD-PARTY-NOTICES.md)
pch check dist --models   # Patch's headless browser check (orchestrator runs it)
```

Workflow: PLAN → DELEGATE → MONITOR → READ/REVIEW → VERIFY → REPORT → (merge only on approval).

# Collaboration Context

- **Project path**: `C:/Users/Kevin/Herdr`. It was moved here because `C:/Users/Kevin/Documents/Herdr` is protected by Windows Controlled Folder Access; that setting was left unchanged. The original `readme.txt` there is untouched, and an identical copy is in this folder.
- **Roles**: Codex (hc `t4`) orchestrates, reviews and verifies. Claude Code Opus 5.5 (hc `t1`) is the sole writer. Preview server (built `dist/`, no HMR): hc `t11` on `127.0.0.1:7622`, owned by the orchestrator. It replaced dev server `t7`.
- **Branch**: `feature/flight-combat`. No commits, remote, push or deploy without approval.
- **Prior repo URL** mentioned by the user: `https://github.com/Kevin-innovation/flight-sim.git`. It has not been cloned or configured.
- **Earlier product ideas**: online competition, a leaderboard, a coin shop, Vercel plus Convex. These are superseded: deployment is Patch-only (see AGENTS.md), and Patch has no multiplayer yet.
- **Current scope**: a playable single-player flight-combat browser game (SKYWARD: IRON HORIZON) with real Patch assets as the main visuals and procedural fallback only while loading.
- **Patch setup**: CLI `pch` 1.2.1 is installed. Not signed in: the login started in hc `t6` expired without approval, and no login is pending. No publishing without explicit user instruction.

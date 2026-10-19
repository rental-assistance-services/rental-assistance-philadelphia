@AGENTS.md

# Claude Code only

Everything in `AGENTS.md` applies to you. This file adds only what is specific to Claude Code.

## The login step is enforced by a hook

`.claude/hooks/agents-md-gate.js` holds every session to section 2 of `AGENTS.md`:

1. **Read `AGENTS.md`** at the repo root with the Read tool. Having it loaded through the
   `@AGENTS.md` line above does not count; the hook only sees a Read of this repo's `AGENTS.md`.
2. **Post the `## BOOT CHECK`** to the user and stop.
3. **The user's next message unlocks** Edit, Write and NotebookEdit for the rest of the session.
   Until then those tools are blocked.

The hook cannot tell a "yes" from a correction. If the user corrects your plan, do not start
editing: fix the plan and post the BOOT CHECK again, as `AGENTS.md` says.

If a tool is blocked, do the steps above. Do not work around the hook, and do not change
`.claude/settings.json` to switch it off.

**Bash is not gated.** A shell command can still change files, so the rule binds there too: no
`sed -i`, `>` redirects, `git checkout -- <file>`, or any other shell edit before the user has
answered your BOOT CHECK.

The hook keeps one small file per session in the system temp folder
(`claude-agents-md-gate/`). A new session starts locked.

## Work in your own worktree

Do each job in its own worktree under `.claude/worktrees/<short-name>`, on its own branch. Never
work in the main checkout and never on `main`:

```bash
git worktree add .claude/worktrees/<short-name> -b <short-name> origin/main
```

`.claude/worktrees/` is ignored by git, so a worktree is never committed into the site.
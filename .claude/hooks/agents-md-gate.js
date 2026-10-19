#!/usr/bin/env node
/**
 * Claude Code hook: holds a session to the "login step" in AGENTS.md section 2.
 *
 *   PostToolUse (Read)                     a Read of <project>/AGENTS.md  -> state "read"
 *   UserPromptSubmit                       the user replies after that    -> state "confirmed"
 *   PreToolUse (Edit|Write|NotebookEdit)   any state but "confirmed"      -> exit 2 (blocked)
 *
 * State is one file per session in AGENTS_GATE_STATE_DIR (default <os tmp>/claude-agents-md-gate).
 * Bash is deliberately not gated; CLAUDE.md says so. No dependencies.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const GATED_TOOLS = ['Edit', 'Write', 'NotebookEdit'];

const BLOCK_MESSAGE = [
  'Blocked by the AGENTS.md login step (AGENTS.md section 2, CLAUDE.md).',
  '1. Read AGENTS.md at the repo root with the Read tool.',
  '2. Post a "## BOOT CHECK" to the user and stop.',
  '3. Edit, Write and NotebookEdit unlock once the user replies.',
].join('\n');

const NO_SESSION_MESSAGE =
  'Blocked by the AGENTS.md login step: this hook call has no session_id, so it cannot tell ' +
  'whether this session read AGENTS.md and got a reply to its BOOT CHECK.';

function samePath(a, b, platform) {
  return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * The whole policy, without any I/O.
 * Returns { block, message, state }: `state` is the new state to save, or null to leave it.
 */
function decide(input, current, options) {
  const opts = options || {};
  const env = opts.env || {};
  const platform = opts.platform || process.platform;
  const payload = input || {};
  const state = current || 'none';
  const keep = { block: false, message: '', state: null };

  if (payload.hook_event_name === 'PreToolUse') {
    if (GATED_TOOLS.indexOf(payload.tool_name) === -1) return keep;
    if (!payload.session_id) return { block: true, message: NO_SESSION_MESSAGE, state: null };
    if (state === 'confirmed') return keep;
    return { block: true, message: BLOCK_MESSAGE, state: null };
  }

  if (!payload.session_id) return keep;

  if (payload.hook_event_name === 'PostToolUse') {
    if (payload.tool_name !== 'Read' || state !== 'none') return keep;
    const filePath = payload.tool_input && payload.tool_input.file_path;
    const project = env.CLAUDE_PROJECT_DIR || payload.cwd;
    if (!filePath || !project) return keep;
    const readPath = path.resolve(payload.cwd || opts.cwd || process.cwd(), filePath);
    const agentsPath = path.resolve(project, 'AGENTS.md');
    return samePath(readPath, agentsPath, platform) ? { block: false, message: '', state: 'read' } : keep;
  }

  if (payload.hook_event_name === 'UserPromptSubmit' && state === 'read') {
    return { block: false, message: '', state: 'confirmed' };
  }

  return keep;
}

function stateFile(env, sessionId) {
  const dir = env.AGENTS_GATE_STATE_DIR || path.join(os.tmpdir(), 'claude-agents-md-gate');
  return path.join(dir, String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_') + '.json');
}

function readState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).state || 'none';
  } catch (err) {
    return 'none';
  }
}

function main() {
  const env = process.env;
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch (err) {
    process.stderr.write('agents-md-gate: could not parse the hook input, so blocking.\n' + BLOCK_MESSAGE + '\n');
    return 2;
  }

  const file = payload.session_id ? stateFile(env, payload.session_id) : null;
  const result = decide(payload, file ? readState(file) : 'none', { env: env });

  if (result.state && file) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ state: result.state, updated_at: new Date().toISOString() }));
    } catch (err) {
      process.stderr.write('agents-md-gate: could not save state (' + err.message + '); the session stays locked.\n');
      return 1;
    }
  }

  if (result.block) {
    process.stderr.write(result.message + '\n');
    return 2;
  }
  return 0;
}

module.exports = { decide, stateFile, GATED_TOOLS };

if (require.main === module) process.exitCode = main();
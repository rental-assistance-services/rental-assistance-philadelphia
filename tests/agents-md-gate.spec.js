/**
 * The Claude Code login lock (.claude/hooks/agents-md-gate.js, AGENTS.md section 2).
 *
 * No browser: the first group calls the hook's decision function directly, the second runs the
 * hook as a real subprocess, fed JSON on stdin the way Claude Code runs it, and reads its exit
 * code (2 = blocked).
 */
const { test, expect } = require('@playwright/test');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { decide } = require('../.claude/hooks/agents-md-gate.js');

const HOOK = path.join(__dirname, '..', '.claude', 'hooks', 'agents-md-gate.js');

test.describe('decision function', () => {
  const PROJECT = path.resolve(os.tmpdir(), 'ras-gate-project');
  const opts = { env: { CLAUDE_PROJECT_DIR: PROJECT } };
  const edit = { hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Edit' };
  const reply = { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt: 'yes' };
  const readOf = (file, cwd) => ({ hook_event_name: 'PostToolUse', session_id: 's1', tool_name: 'Read',
    tool_input: { file_path: file }, cwd: cwd || PROJECT });

  test('an edit is blocked before AGENTS.md is read', () => {
    for (const tool of ['Edit', 'Write', 'NotebookEdit']) {
      expect(decide({ ...edit, tool_name: tool }, 'none', opts).block).toBe(true);
    }
  });

  test('an edit is still blocked after the read, until the user replies', () => {
    expect(decide(readOf(path.join(PROJECT, 'AGENTS.md')), 'none', opts).state).toBe('read');
    const result = decide(edit, 'read', opts);
    expect(result.block).toBe(true);
    expect(result.message).toContain('BOOT CHECK');
  });

  test('the user reply after the read unlocks editing', () => {
    expect(decide(reply, 'read', opts).state).toBe('confirmed');
    expect(decide(edit, 'confirmed', opts).block).toBe(false);
    expect(decide({ ...edit, tool_name: 'Write' }, 'confirmed', opts).block).toBe(false);
  });

  test('a user message before the read unlocks nothing', () => {
    expect(decide(reply, 'none', opts).state).toBe(null);
  });

  test('reading a different AGENTS.md does not count', () => {
    const others = [
      path.join(PROJECT, 'docs', 'AGENTS.md'),
      path.resolve(os.tmpdir(), 'some-other-repo', 'AGENTS.md'),
      path.join(PROJECT, 'AGENTS.md.bak'),
    ];
    for (const file of others) expect(decide(readOf(file), 'none', opts).state).toBe(null);
  });

  test('a relative path is resolved against the session cwd', () => {
    expect(decide(readOf('AGENTS.md', PROJECT), 'none', opts).state).toBe('read');
    expect(decide(readOf('../AGENTS.md', path.join(PROJECT, 'blog')), 'none', opts).state).toBe('read');
    expect(decide(readOf('AGENTS.md', path.join(PROJECT, 'blog')), 'none', opts).state).toBe(null);
  });

  test('without CLAUDE_PROJECT_DIR the project is the payload cwd', () => {
    expect(decide(readOf('AGENTS.md', PROJECT), 'none', { env: {} }).state).toBe('read');
  });

  test('paths compare case-insensitively on Windows only', () => {
    const upper = readOf(path.join(PROJECT.toUpperCase(), 'agents.md'));
    expect(decide(upper, 'none', { ...opts, platform: 'win32' }).state).toBe('read');
    expect(decide(upper, 'none', { ...opts, platform: 'linux' }).state).toBe(null);
  });

  test('a missing session id blocks, even for an unlocked state', () => {
    const { session_id, ...noSession } = edit;
    const result = decide(noSession, 'confirmed', opts);
    expect(result.block).toBe(true);
    expect(result.message).toContain('session_id');
  });

  test('reading and shell tools are never blocked', () => {
    expect(decide({ ...edit, tool_name: 'Read' }, 'none', opts).block).toBe(false);
    expect(decide({ ...edit, tool_name: 'Bash' }, 'none', opts).block).toBe(false);
  });
});

test.describe('the hook as Claude Code runs it', () => {
  let project;
  let stateDir;

  test.beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-gate-project-'));
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-gate-state-'));
    fs.writeFileSync(path.join(project, 'AGENTS.md'), '# rules\n');
  });

  test.afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  const run = (payload) => spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd: project, ...payload }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: project, AGENTS_GATE_STATE_DIR: stateDir },
    encoding: 'utf8',
  });
  const edit = (session) => run({ hook_event_name: 'PreToolUse', session_id: session, tool_name: 'Edit',
    tool_input: { file_path: path.join(project, 'index.html') } });
  const read = (session, file) => run({ hook_event_name: 'PostToolUse', session_id: session, tool_name: 'Read',
    tool_input: { file_path: file } });
  const reply = (session) => run({ hook_event_name: 'UserPromptSubmit', session_id: session, prompt: 'looks right' });

  test('blocked before the read, blocked before the reply, allowed after', () => {
    const blocked = edit('session-a');
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toContain('AGENTS.md');

    expect(read('session-a', path.join(project, 'AGENTS.md')).status).toBe(0);
    expect(edit('session-a').status).toBe(2);

    expect(reply('session-a').status).toBe(0);
    expect(edit('session-a').status).toBe(0);

    // another session is still locked
    expect(edit('session-b').status).toBe(2);
  });

  test('reading a different AGENTS.md leaves the session locked', () => {
    fs.mkdirSync(path.join(project, 'docs'));
    fs.writeFileSync(path.join(project, 'docs', 'AGENTS.md'), '# not these\n');
    expect(read('session-c', path.join(project, 'docs', 'AGENTS.md')).status).toBe(0);
    expect(reply('session-c').status).toBe(0);
    expect(edit('session-c').status).toBe(2);
  });

  test('a missing session id blocks and never falls back to a shared state file', () => {
    expect(read(undefined, path.join(project, 'AGENTS.md')).status).toBe(0);
    expect(reply(undefined).status).toBe(0);
    const blocked = edit(undefined);
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toContain('session_id');
    expect(fs.readdirSync(stateDir)).toEqual([]);
  });

  test('a session id cannot write outside the state folder', () => {
    const sneaky = '../../escaped';
    expect(read(sneaky, path.join(project, 'AGENTS.md')).status).toBe(0);
    expect(fs.readdirSync(stateDir)).toEqual(['______escaped.json']);
  });

  test('unreadable input blocks', () => {
    const result = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8',
      env: { ...process.env, AGENTS_GATE_STATE_DIR: stateDir } });
    expect(result.status).toBe(2);
  });
});
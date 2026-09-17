#!/usr/bin/env node
/**
 * The pull-request checklist from AGENTS.md section 7.
 *
 *   node .github/scripts/check-pr-body.js <changed-files.txt>    (description in env PR_BODY)
 *
 * Fails when the "I read AGENTS.md" box is not ticked, or when a file a visitor can see changed
 * and the description has neither a picture under both "## Before" and "## After" nor a
 * non-empty "No visible change:" line, or when it carries an AI signature. HTML comments (the
 * template's hints) are ignored.
 */
'use strict';

const fs = require('fs');

const ACK = 'I read AGENTS.md before changing anything';
const ACK_TICKED = /^\s*[-*]\s+\[[xX]\]\s+I read AGENTS\.md before changing anything/m;
const NO_VISIBLE_CHANGE = /^\s*(?:[-*]\s+)?\**No visible change\**:\**[ \t]*(.*)$/gim;
const IMAGE = /!\[|<img\b/i;
const AI_TOOL = '(?:claude|anthropic|cursor|copilot|gemini|grok|chatgpt|openai|codex|windsurf)';
const AI_SIGNATURE = new RegExp(
  '(?:made|generated|created|written|built)\\s+(?:with|by|in|using)\\s+\\[?' + AI_TOOL +
  '|co-authored-by:[^\\n]*' + AI_TOOL + '|\\u{1F916}', 'iu');

function isVisibleFile(file) {
  const name = file.replace(/\\/g, '/').split('/').pop();
  if (/\.html$/i.test(name)) return !/^google.*\.html$/i.test(name);
  return /\.(css|png|jpe?g|webp|svg|gif)$/i.test(name);
}

/** The text under every "## <title>" heading, up to the next heading of level 1 or 2. */
function sections(body, title) {
  const found = [];
  let current = null;
  body.split(/\r?\n/).forEach((line) => {
    const heading = /^#{1,2}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      current = heading[1].toLowerCase() === title.toLowerCase() ? [] : null;
      if (current) found.push(current);
    } else if (current) {
      current.push(line);
    }
  });
  return found.map((lines) => lines.join('\n'));
}

function hasPicture(body, title) {
  return sections(body, title).some((text) => IMAGE.test(text));
}

function noVisibleChangeReason(body) {
  let match;
  NO_VISIBLE_CHANGE.lastIndex = 0;
  while ((match = NO_VISIBLE_CHANGE.exec(body))) {
    const reason = match[1].replace(/\*/g, '').trim();
    if (reason) return reason;
  }
  return '';
}

function checkPrBody(body, changedFiles) {
  const text = String(body || '').replace(/<!--[\s\S]*?-->/g, '');
  const files = (changedFiles || []).map((f) => String(f).trim()).filter(Boolean);
  const errors = [];

  if (!ACK_TICKED.test(text)) {
    errors.push('Tick the box "' + ACK + '" in the description (read AGENTS.md first if you have not).');
  }

  const signature = AI_SIGNATURE.exec(text);
  if (signature) {
    errors.push('Remove the AI signature "' + signature[0].trim() + '" from the description (AGENTS.md section 7).');
  }

  const visible = files.filter(isVisibleFile);
  if (visible.length) {
    const pictures = hasPicture(text, 'Before') && hasPicture(text, 'After');
    if (!pictures && !noVisibleChangeReason(text)) {
      errors.push(
        'These files can change what a visitor sees: ' + visible.join(', ') + '. ' +
        'Add a picture under both "## Before" and "## After", or finish the ' +
        '"No visible change:" line with the reason (AGENTS.md section 6).'
      );
    }
  }

  return { ok: errors.length === 0, errors: errors };
}

function main(argv, env) {
  const listPath = argv[2];
  if (!listPath) {
    console.error('usage: PR_BODY="..." node .github/scripts/check-pr-body.js <changed-files.txt>');
    return 2;
  }
  const files = fs.readFileSync(listPath, 'utf8').split(/\r?\n/);
  const result = checkPrBody(env.PR_BODY || '', files);
  if (result.ok) {
    console.log('PR checklist: OK');
    return 0;
  }
  result.errors.forEach((e) => console.log('::error title=PR checklist::' + e));
  return 1;
}

module.exports = { checkPrBody, isVisibleFile };

if (require.main === module) process.exitCode = main(process.argv, process.env);
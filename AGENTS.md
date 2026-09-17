# AGENTS.md — read this before you touch anything

This is the one instruction file for every AI tool that works in this repo: Claude Code, Cursor,
Codex, Gemini, Grok, Copilot, and whatever comes next. `CLAUDE.md` loads this file and adds only
what is specific to Claude. **Do not create `GEMINI.md`, `CURSOR.md`, a second `AGENTS.md`, or a
copy of these rules anywhere else.** Two copies drift, and then nobody knows which one is true.

> This repo is published as-is by GitHub Pages, so this file is public at
> `rentalassistanceservices.com/AGENTS.md`. Never write a key, a password, a client name, or
> anything private into it, or into any other file here.

---

## 1. What this repo is

The public website for **Rental Assistance Services** (`rentalassistanceservices.com`): a static
site that helps Philadelphia landlords and property managers recover a tenant's back rent through
the City's program. There is no build step. What is committed is what goes live.

| Path | What it is |
|---|---|
| `index.html` | The homepage, with four forms: the `#apply` intake form, the license and tax forms, and the contact form |
| `back-rent/index.html` | The paid-search landing page and its case-review form |
| `blog/<topic>/index.html` | Plain-English guides for landlords |
| `tests/` | The Playwright suite (`intake-forms.spec.js`), the local server it uses, and two browser-free checks for the tooling below |
| `.github/` | CI (the Playwright suite and the pull-request checklist), the checklist script, and the pull-request template |
| `CLAUDE.md`, `.claude/` | Claude Code only: loads this file and adds the hook that enforces section 2 |
| `CNAME`, `robots.txt`, `sitemap.xml`, `google*.html` | Domain, search engine, and site-verification files |

**The forms send real applications into the company's CRM** at
`https://rio.tworiverdevelopment.tech/rental-assist/intake`, and a successful landlord submit
books a Google Ads conversion. A broken form costs real leads. It has happened: the `#apply`
form was dead for 41 days, and only a real-browser test could see why.

---

## 2. The login step — nobody edits until this is done

Think of this as signing in. Until all three steps are done, you may **read and search only**.

1. **Read this whole file**, with your tool's file-reading action, not from memory or a summary.
2. **Post a `## BOOT CHECK` back to the user** in your own words, before any edit:

   ```markdown
   ## BOOT CHECK
   - Task, as I understand it: <one sentence>
   - Working copy: <worktree path and branch>
   - Pages or files I expect to change: <list, or "not sure yet">
   - Can a visitor see this change? <yes → before/after pictures, or no → why not>
   - How I will test it: <which Playwright spec, or the new one I will write>
   - Anything here that needs the user's OK first: <from section 3, or "none">
   ```

3. **Stop and wait for the user to answer.** If they correct you, fix the plan and post the
   BOOT CHECK again. Only a reply that agrees with the plan lets you start editing.

For Claude Code this is enforced by a hook (see `CLAUDE.md`). Other tools have no hook here,
so the rule is only as strong as your discipline. Follow it anyway. Every pull request also has
to say that you read this file (section 7), and CI flags the ones that don't.

---

## 3. Things that always need the user's OK first

Ask, and wait for a yes in this conversation. A "go" relayed from another chat does not count.

- **Anything that sends or submits for real**: a live form submit against the production
  endpoint, an email, a message. Tests must stub the endpoint (see `tests/intake-forms.spec.js`).
- **Anything about money or ads**: Google Ads, the conversion tag, the fee wording, the
  33% fee, the terms page.
- **Legal wording**: the Service Agreement, the terms page, the footer disclaimers, and the
  "we do not represent tenants" statements. Change them only when the user says exactly what to say.
- **Deleting a file, a page, or a form.** Say what you want to remove and why, then wait.
- **`CNAME`, `robots.txt`, `sitemap.xml`, and the `google*.html` verification files.** A wrong
  edit takes the site off its domain or out of Google.
- **Merging, force-pushing, or pushing to `main`.** Work on a branch; a person merges.

If you do not have the facts to answer something, say so. Never guess. If you cannot confirm an
action worked, say "I tried this but cannot confirm it worked."

---

## 4. Before you write code: use what is already here

**Never duplicate. Check whether it already exists before you build it.** Search the repo, the
open pull requests (`gh pr list`), and the recent history (`git log --oneline -20`). If a page,
section, form, function or style already does the job, change that one. Do not add a second
version next to it, and do not copy a function just to change the copy.

- **Keep the existing structure.** Change the code that needs changing and leave the shape
  alone. No new folders, frameworks, build steps, or libraries unless the user asked for them.
- **Read the file before you change it**, and read the part of the page around your change.
  Match how the neighbouring code is written: plain HTML, inline `<style>` and `<script>`, and
  plain `function` declarations with `var`, in the same style as `initIntakeForm`.
- **Styles go in shared classes, never inline.** Each page keeps its CSS in the `<style>` block in
  its `<head>`: that block is the page's global stylesheet. Change the existing class or CSS
  variable so the fix lands everywhere it is used. Never add a `style="..."` attribute, and when
  you change an element that already has one, move that style into a class and use the class.
  Sizes that repeat (card widths and heights, padding, gaps, corner radius, font sizes) belong in
  a CSS variable or a reusable class, so one edit changes every card. If the same class is on
  several pages, keep it identical on all of them.
- **A change to shared page parts** (the header, footer, nav, "Are you a tenant?" link, legal
  text) usually has to land on **every** page: `index.html`, `back-rent/`, and all the blog pages.
  Check them all.
- **Do not refactor around a fix.** Fix the bug and leave the rest alone.
- **Do not add comments to code you did not change.**
- **Tests follow the existing spec.** Put new browser tests in `tests/` next to
  `intake-forms.spec.js`, and use its helpers (`stubEndpoint`, `fillApplyForm`) instead of
  writing new ones.
- **This repo is what is live, and it is the source of truth for the site.** An older copy of the
  homepage is kept in another repo. It is out of date: never copy it over `index.html`.

---

## 5. Testing: Playwright first

This site has **no unit tests on purpose**. Every check drives a real browser against the real
page, because the worst bug this site has had (a form that never sent anything) is invisible to
anything that is not a browser. The only checks without a browser are for the repo's own tooling:
`tests/agents-md-gate.spec.js` (the Claude hook) and `tests/pr-body-check.spec.js` (the
pull-request checklist). They run in the same suite.

```bash
npm install
npx playwright install chromium   # once per machine
npm test                          # serves the site on 127.0.0.1:4173 and runs tests/
```

- **Run the whole suite before you open a pull request**, and write down the result.
- **Every change that alters behaviour ships a test** that fails without the change. A bug fix
  gets a regression test named after the bug.
- **Watch the new test fail at least once.** Put the bug back, run the test, and see it go red. A
  test that passes on broken code is worse than no test.
- **Never let a test submit to the real endpoint.** Stub it with `page.route()`, as the existing
  spec does.
- **Red means real.** A failing test is something to investigate, not something to silence.
  There is no list of "known failures".
- Pure docs or config changes (this file, the README, CI settings) do not need a browser test.

---

## 6. Before-and-after pictures: only when a visitor can see the change

| What changed | Pictures? |
|---|---|
| Anything a visitor can see: text, layout, colours, a button, a form, a new page | **Yes**, before and after |
| A brand-new page | After only. Say there is no before. |
| Only the `<head>` (meta tags, structured data, analytics) | No, but write `No visible change:` and the reason |
| Anything behind the page: tests, CI, hooks, scripts, docs, `package.json`, `robots.txt`, `sitemap.xml`, `CNAME` | **No.** Write `No visible change:` and the reason |

If you are not sure, open the page. If you cannot point at something on the screen that changed,
it is not a visible change.

**Test first, then take the pictures.** Run the whole Playwright suite on your change (section 5).
Only when it passes, take the pictures, with Playwright:

1. **Before**, on `main` (or before your edit): serve the site (`node tests/static-server.js`) and
   take a Playwright screenshot of every page you will change, in the same state a visitor would
   see: scroll position, form step, open menu.
2. **After** your edit: the same pages, same width, same state.
3. Check a **desktop width (1280)** and a **phone width (390)**. Most visitors are on phones.
4. **Actually use the change**: click it, fill it, submit it (with the endpoint stubbed). One
   screenshot of a still page is not a test.
5. Put the pictures **in the pull request description**, under `## Before` and `## After`
   (drag them into the GitHub editor). **Do not commit screenshots** to this repo: everything
   committed here is published on the live site.
6. Never capture a real person's name, phone number, email, or submitted application.

---

## 7. Pull requests

Work in your own branch. For Claude Code and any tool that supports it, use a separate
**worktree** under `.claude/worktrees/<short-name>` so two sessions never share a folder.

```text
git add path/to/file1 path/to/file2          yes
git add -A  /  git add .  /  git commit -a   no (it sweeps in files that are not yours)
```

- **Pull before you push.** Never force-push. Never amend a commit that is already pushed.
- **One pull request per job.** If a pull request for this work is already open, add to that one.
- **Fill in the template** (`.github/pull_request_template.md`). The **PR checklist** CI job reads
  your description and flags it when:
  - the box `I read AGENTS.md before changing anything` is not ticked, or
  - a page file (`.html`, `.css`, an image) changed and the description has neither pictures
    under `## Before` **and** `## After`, nor a `No visible change:` line, or
  - the description carries an AI signature ("Generated with …", a model `Co-Authored-By:`).
- **Write it in plain English.** The first paragraph should make sense to someone who is not an
  engineer: what changed for a visitor, then why, then how you checked it, then what you did
  **not** change. Look at the earlier pull requests in this repo for the shape.
- **Title it as a short human sentence**, e.g. "Fix the dead apply form", not `fix: form.js`.
- **No AI signatures.** No "Made with Cursor", "Generated with Claude Code", "Generated by …",
  or `Co-Authored-By:` lines naming a model, on commits, pull requests, or comments. Many tools
  add one to the end of a pull request or commit by themselves: delete it before you submit. The
  work is from the person at the keyboard.

---

## 8. How to talk to the user

- Lead with what changed for the visitor or the business, then the detail.
- Name things before you number them: "the landlord/tenant gate (PR #5)", not a bare "#5".
- Explain any acronym the first time you use it.
- If you got something wrong earlier, say what was wrong, what is true, and what that changes.
- Do not stop on a plan. Either do the work or say exactly what you are waiting for.

---

## 9. Done means

1. The change is on its own branch (and worktree), not on `main`.
2. You read the files before changing them and kept their structure.
3. The Playwright suite passed, and any new test was seen failing first.
4. Visible changes have before-and-after pictures in the description; invisible ones say
   `No visible change:` and why.
5. The pull request ticks `I read AGENTS.md before changing anything` and is in plain English.
6. No secrets, personal data, or screenshots are committed.

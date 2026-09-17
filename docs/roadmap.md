# Roadmap

fieldnote is a loop: **Monitor** what coding agents do, **Act** on what the
evidence shows, **Train** the agents on their own record.

Monitor is shipped. Act's first authoring workflow, Fieldnote Skills setup,
is implemented with automated coverage; live acceptance and production rollout
remain pending. Train remains future work.

## Act — install, verify, then improve readiness

**Implemented.** **Set up Fieldnote** explores repository evidence, asks the
user to confirm detected agents, and settles missing facts one question at a
time. The persisted conversation resumes after navigation. A ready proposal
opens a PR with every skill from one immutable published release, separate
byte-identical copies in `.agents/skills/` for Codex and `.claude/skills/` for
Claude Code, and repository-specific `.fieldnote/` configuration and lock.
Unsupported agents such as Cursor are disclosed without counting as installed.

The PR is the review surface. Monitoring follows CI and reviews and allows at
most three bounded repairs; ambiguous or unsafe feedback requires a human.
Fieldnote never merges. Opening a PR means proposed. Only a fresh default-branch
scan after merge can establish a current installation; closing without merge
leaves it uninstalled or outdated. A cached latest-release check offers
**Update Fieldnote to vX** without opening unsolicited PRs. Updates preserve
explicit profile values and surface modified managed skills as drift.

The typed authoring kernel shares authorization, durable dispatch, notes,
sandbox boundaries, retry/recovery, authored PRs, and monitoring across
`fieldnote-setup` and `readiness-remediation`. Existing readiness plan behavior
is preserved. Monitor's deterministic ingestion and metrics remain independent
of authoring and do not call a model.

**What remains.**

- Authorize and complete the four live agent-shape acceptance runs, close,
  update, repair, and post-merge verification scenarios in the
  [validation report](validation-fieldnote-skills-setup.md).
- Roll out Contents/Pull requests write permission, authoring credentials,
  migrations, and Inngest workers using the [operator procedure](github-app.md#fieldnote-skills-setup-and-update).
- Implement broader readiness-remediation execution after verified Skills
  installation. Valid current or outdated installations expose the existing
  readiness planning capability; missing, proposed, partial, or drifted installs
  keep setup or repair primary.

The [approved Skills setup design](superpowers/specs/2026-09-16-fieldnote-skills-setup-design.md)
and [implementation plan](superpowers/plans/2026-09-16-fieldnote-skills-setup.md)
define the contract. Native adapters beyond Codex and Claude Code, automatic
updates, and automatic merges are outside V1.

## Train — an MCP server for coding agents

**What it is.** An MCP server that serves a repository's own record back to the
coding agent working in it. Before starting a task, the agent asks what it
keeps getting wrong here, and gets an answer computed from that repository's
actual merged history.

Roughly:

```
> Before I start: what do I keep getting wrong in this repo?

  Across the last 40 pull requests:
  1. Modified test files after CI failed        7x  → not clean green
  2. Needed 3 or more SHAs to reach green      12x
  3. Failed the lint gate on first attempt      9x

  Readiness: 60/100 — setup and test commands undocumented.
```

**What it reuses.** `failureBreakdown()` in
[`src/metrics/aggregate.ts`](../src/metrics/aggregate.ts) already returns, per
gate, the check name, producing App, failure count, total, and the set of pull
requests it failed on — sorted, with denominators. `aggregate()` supplies the
rates. `latestGrade()` supplies readiness. The metrics behind the answer are
computed; what is missing is the server that speaks them.

**What it still needs.**

- A read-only MCP server and its transport.
- Authentication that scopes a caller to exactly the repositories it may read.
  This is the hard part: an MCP token is easier to leak than a session, and the
  underlying data is a team's engineering record.
- A tool surface small enough to be useful in a prompt. Three tools, not
  thirteen.
- A decision about phrasing. "Your top mistakes" is a judgment; the pipeline
  makes none anywhere else. The server should report what the evidence shows and
  let the agent draw the conclusion.

**Open question.** Whether Train reads per-agent or per-repository. Per-agent is
the stronger promise — the agent sees _its own_ record — but attribution of a
pull request to a specific agent is itself unbuilt work, designed on the
`design/repository-ai-involvement` branch and not yet merged. Per-repository
needs no attribution and is the honest first version.

## Not planned

Excluded work, and why, is recorded in [future.md](future.md).

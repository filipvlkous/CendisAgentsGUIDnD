# Agent Guild

A pixel-art RPG for developing Claude Code agents, skills and multi-agent workflows. Every agent is a hero:

| Agent field | Shows up as |
| --- | --- |
| `model` | Class: opus/fable → Wizard, sonnet → Knight, haiku → Rogue, inherit/unset → Adventurer |
| `color` | Outfit color |
| `tools` | Weapon: Edit/Write → hammer, Bash → sword, Web → bow, MCP → brush, read-only → tome, all tools → staff |
| `skills` | Gear: each equipped (preloaded) skill takes one of 8 slots (cape, shield, pet, aura, gem, crest, boots, belt) in its own color |
| Skills named in the orders | **Ghost gear** (see-through, dashed slot, "on demand"): the system prompt tells the hero to load the skill with the `Skill` tool while it works. Click it to equip (preload) it instead |
| Run history | XP and levels: +10 XP for each won quest, +2 for each lost one |

**Quest Log** holds *your own* quests: the Jira issues assigned to you that aren't done, the same list as Jira's "Assigned to me" tab. They're grouped by status:

- Each card shows type, key, project, the parent story as its "chapter", and priority as difficulty stars.
- Clicking a card opens its scroll: the description, every comment (newest first), and links tagged as Figma, pull request, spec or endpoint.
- Your level comes from the issues you've completed.
- To connect it, set **Settings → Jira credentials file** to a `.loc.env` with `JIRA_DOMAIN`, `JIRA_EMAIL` and `JIRA_API_TOKEN`. Only the local server reads that file; the browser never sees the token.
- In the town, the Quest Board building opens the Quest Log and shows one note per open quest.
- **⚔ Start quest** on a quest's scroll sends a hero, or a War Table campaign, to work on that ticket:
  - The hero gets your orders (editable; by default "implement it, minimal change, typecheck and build, don't commit") plus a briefing built from the ticket: description, comments, parent story and links. It doesn't need Jira access.
  - Runs started this way are linked to the ticket. They appear under **Heroes on this quest**, and the quest card shows ⚔ while a hero works on it and ❓ when one needs you.
  - Nothing is ever written to Jira.

**Town** is the home screen. Heroes wander and chat. Click a hero to talk to them, send them on a quest (a real `claude -p` run), or take control of them: WASD/arrows move, Space talks, E enters a building. Heroes on a quest walk to the Quest Board and narrate their live tool calls. Buildings lead to the other screens:

- **Hero Hall** (agents): a character sheet with a live sprite preview, stats, equipment slots and the skill inventory.
- **Skill Shrine** (skills).
- **War Table** tent (workflows): agent campaigns.
- **Training Grounds** (single-agent runs).
- **Chronicle Tower** (run history).

Sound effects can be muted in the sidebar.

The features underneath:

- **Agents**: browse, create, edit and delete subagents in `~/.claude/agents` and in each project's `.claude/agents`. It flags agents that share a `name` (only one of them is reachable).
- **Skills**: browse, create and edit `skills/<name>/SKILL.md`, and preview a skill's supporting files.
- **Workflows**: build a DAG of steps. Each step is an agent plus a prompt template. Steps run in parallel once their dependencies finish. Templates can use `{{input}}` and `{{steps.<id>.output}}`.
- **Export as agent**: turn a workflow into an orchestrator agent `.md` that runs the same pipeline inside an interactive Claude Code session.
- **Playground**: run one agent once with a prompt.
- **Runs**: a live view of each run, including the step graph, streamed tool calls and text, output, cost, and a `claude --resume` id for every step.

Every step runs `claude -p --output-format stream-json --agent <name>` in the workflow's working directory, so agents get the same tools, MCP servers, skills and permission rules they would get in the terminal.

## Run

```sh
npm install
npm run dev        # UI on http://localhost:5317, API on 127.0.0.1:4317
```

Production-style, served on a single port:

```sh
npm run build && npm start   # http://127.0.0.1:4317
```

Requirements: Node 22.13+ (for the built-in `node:sqlite`) and the `claude` CLI, logged in. If `claude` is not on your PATH, set its full path in **Settings**.

## When a hero is blocked

Heroes never guess past a blocker. Every run adds an instruction to the hero's system prompt: when it's blocked (a tool is refused, information is missing, the request is ambiguous, or a decision isn't its to make), it should finish what it safely can and end with `QUESTION:` lines.

When that happens:

- The stage becomes **waiting** instead of failing, and the run pauses. Stages that depend on it wait too; independent stages keep running.
- Tools that Claude Code refused (`permission_denials`) are also detected. Each comes with the narrowest allow rule that would have let it through, with one rule per command in a chain. For example, `mkdir -p out && touch out/x` suggests `Bash(mkdir *)` and `Bash(touch *)`.
- In the run view (Chronicle), the hero's questions are shown with an answer box and checkboxes for the suggested rules, which you can edit:
  - **Answer & continue** resumes the *same session* (`claude --resume`), so the hero keeps its context. Rules you allow apply to that stage only.
  - **Give up on this stage** fails it, and the stages after it are skipped.
- In the town, a blocked hero shows a ❓ bubble with its question. A "Heroes need you" list links straight to the answer box.
- Waiting runs survive a server restart and can still be answered afterwards.

## Quest tools

Headless runs can't answer permission prompts. Claude Code also refuses Bash commands containing unresolved variables such as `$JIRA_API_TOKEN`. Because of both, a quest that needs a credential calls a small script from `tools/`, and the workflow allows just that script under **Allowed tools**.

The Jira tools follow the `jira-workflow` skill and the `jira-intake` agent:

- Credentials come from `./.loc.env` in the quest's working directory. The token never reaches the agent.
- `/myself` is checked first, because unauthenticated searches return an empty 200.
- 429, 5xx and timeouts are retried 3 times.
- Failures print `BLOCKED: <cause> — <error>`, using intake's causes: `no-credentials`, `invalid-credentials`, `no-key`, `jira-error`.

| Script | What it does |
| --- | --- |
| `tools/jira-search.sh "<JQL>"` | Searches with full pagination and prints one JSON line per issue |
| `tools/jira-issue.sh PD-123` | Prints the ticket and its parent story: ADF prose with `[[image: …]]` markers, every comment (oldest first), image attachments and every link |
| `tools/jira-lib.sh` | Shared helpers, sourced by the scripts above |

Allow them in a quest with `Bash(/abs/path/tools/jira-search.sh:*), Bash(/abs/path/tools/jira-issue.sh:*)`. The **My Jira board** quest uses both:

1. **Gather** groups every assigned issue by status.
2. **Brief** reads each open ticket the way intake does and summarizes its goal, latest change, links and next step.

## Data

Everything the app owns lives in `data/`, which git ignores:

| Path | Contents |
| --- | --- |
| `data/studio.db` | SQLite database: settings (CLI path, project roots), workflow definitions and run history with each step's event log |
| `data/backups/` | A copy of every agent or skill file before it is overwritten or deleted |

Older versions kept settings, workflows and runs as JSON files. On startup the server imports any it finds into `data/studio.db` and renames them to `*.json.imported`; delete those once you are happy with the import.

## Safety

- The API binds to 127.0.0.1 only.
- Agent and skill ids are validated, so the app cannot write outside a scope's `agents/` or `skills/` folder.
- Each workflow chooses a permission mode. `plan` is read-only. `acceptEdits` lets agents edit files, and other tools need allow rules in `.claude/settings.json`. `bypassPermissions` allows everything, so use it only in repositories you can reset.

## Layout

```
server/      Express API: library.ts (agents/skills), workflows.ts, runner.ts (DAG executor), store.ts, db.ts (SQLite)
src/         React UI: pages/ (TownPage = the game), game/ (sprite generator, world map, XP, sfx), components/
shared/      Types shared by server and UI
```

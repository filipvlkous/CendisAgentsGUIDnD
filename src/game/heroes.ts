import { useMemo } from "react";
import type { AgentDoc } from "../../shared/types";
import { api } from "../api";
import { useAsync } from "../components/ui";
import { emptyStats, statsByAgent, type HeroStats } from "./progress";
import { appearanceFor, heroDataUrl, onDemandSkills, type Appearance } from "./sprite";

export interface Hero {
  key: string; // unique: agent file path, or "claude" for the default agent
  name: string; // what --agent receives; "" for default Claude
  title: string; // display name
  agent: AgentDoc | null;
  app: Appearance;
  stats: HeroStats;
}

/** `knownSkills`: every skill name in reach, so skills its orders call on demand show up as ghost gear. */
export function heroFromAgent(a: AgentDoc, stats?: HeroStats, knownSkills: string[] = []): Hero {
  const app = appearanceFor({ ...a, onDemand: onDemandSkills(a, knownSkills) });
  return { key: a.path || `${a.scope}/${a.file}`, name: a.name, title: a.name, agent: a, app, stats: stats ?? emptyStats() };
}

export function defaultHero(stats?: HeroStats): Hero {
  return {
    key: "claude",
    name: "",
    title: "Claude",
    agent: null,
    app: appearanceFor({ name: "claude" }, true),
    stats: stats ?? emptyStats(),
  };
}

/** Every agent as a hero (plus default Claude), with XP from the run history. */
export function useHeroes() {
  const agents = useAsync(() => api.agents());
  const skills = useAsync(() => api.skills());
  const runs = useAsync(() => api.runs());
  const heroes = useMemo(() => {
    const stats = statsByAgent(runs.data ?? []);
    const known = [...new Set((skills.data ?? []).map((s) => s.name))];
    return [defaultHero(stats.get("")), ...(agents.data ?? []).map((a) => heroFromAgent(a, stats.get(a.name), known))];
  }, [agents.data, runs.data, skills.data]);
  return {
    heroes,
    loading: agents.loading,
    error: agents.error,
    runs: runs.data ?? [],
    reload: () => Promise.all([agents.reload(), runs.reload()]),
    reloadRuns: runs.reload,
  };
}

export function heroForAgentName(heroes: Hero[], name: string): Hero | undefined {
  return heroes.find((h) => h.name === name);
}

/** Lines a hero says when you talk to them. */
export function quips(h: Hero): string[] {
  const lines: string[] = [];
  const desc = h.agent?.description ?? "I can do anything you ask — I have every tool.";
  const first = desc.split(/(?<=[.!?])\s/)[0];
  lines.push(first.length > 90 ? first.slice(0, 88) + "…" : first);
  for (const g of h.app.gear) lines.push(`My ${g.slot} of ${g.skill} is ready.`);
  const byClass: Record<string, string[]> = {
    wizard: ["I think deeply before I act.", "Give me the hard problems."],
    knight: ["Steady and reliable, at your service.", "Point me at the bug."],
    rogue: ["Quick and cheap — that's me.", "In and out before you notice."],
    adventurer: ["I fight with whatever the summoner wields.", "Where to, chief?"],
    sage: ["Every tool, every skill. Ask away.", "I am the guild's oldest member."],
  };
  lines.push(...byClass[h.app.cls]);
  if (h.stats.level > 1) lines.push(`Level ${h.stats.level}! ${h.stats.questsWon} quest${h.stats.questsWon === 1 ? "" : "s"} won so far.`);
  return lines;
}

/** Agent name → portrait data URL, for SVG graphs. */
export function usePortraits(heroes: Hero[]): Record<string, string> {
  return useMemo(() => {
    const out: Record<string, string> = {};
    for (const h of heroes) out[h.name] ??= heroDataUrl(h.app, 0, 2);
    return out;
  }, [heroes]);
}

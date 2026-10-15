import type { RunSummary } from "../../shared/types";

export interface HeroStats {
  xp: number;
  level: number;
  questsWon: number;
  questsLost: number;
  /** XP needed for the current level and for the next one. */
  floor: number;
  next: number;
}

export const XP_WIN = 10;
export const XP_LOSS = 2;

export const levelFor = (xp: number) => Math.floor(Math.sqrt(xp / 10)) + 1;
const xpFor = (level: number) => (level - 1) ** 2 * 10;

/** Hero XP comes from the run history: every step an agent finished is a quest. Key "" is default Claude. */
export function statsByAgent(runs: RunSummary[]): Map<string, HeroStats> {
  const out = new Map<string, HeroStats>();
  for (const run of runs) {
    for (const r of run.agentResults ?? []) {
      const s = out.get(r.agent) ?? { xp: 0, level: 1, questsWon: 0, questsLost: 0, floor: 0, next: 10 };
      if (r.status === "done") {
        s.xp += XP_WIN;
        s.questsWon++;
      } else if (r.status === "failed") {
        s.xp += XP_LOSS;
        s.questsLost++;
      }
      out.set(r.agent, s);
    }
  }
  for (const s of out.values()) {
    s.level = levelFor(s.xp);
    s.floor = xpFor(s.level);
    s.next = xpFor(s.level + 1);
  }
  return out;
}

export const emptyStats = (): HeroStats => ({ xp: 0, level: 1, questsWon: 0, questsLost: 0, floor: 0, next: 10 });

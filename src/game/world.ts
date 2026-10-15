// The town map: a 320×180 pixel world, drawn once to an offscreen canvas plus a few animated bits.
import { PAL, shade } from "./sprite";

export const WW = 320;
export const WH = 180;
export const FIELD = { x0: 8, x1: 312, y0: 84, y1: 172 };

export interface Building {
  id: string;
  label: string;
  route: string;
  x: number;
  w: number;
  doorX: number;
  hint: string;
}

const B = (i: number, id: string, label: string, route: string, hint: string): Building => ({
  id,
  label,
  route,
  hint,
  x: 6 + i * 62,
  w: 52,
  doorX: 6 + i * 62 + 26,
});

export const BUILDINGS: Building[] = [
  B(0, "hall", "Hero Hall", "agents", "Recruit and equip heroes"),
  B(1, "shrine", "Skill Shrine", "skills", "Study and forge skills"),
  B(2, "board", "Quest Board", "quests", "Your Jira quests"),
  B(3, "arena", "Training Grounds", "playground", "Spar with one hero"),
  B(4, "tower", "Chronicle Tower", "runs", "Read past adventures"),
];

export const SIGNPOST = { x: 30, y: 100, route: "settings", label: "Settings" };
/** The War Table tent, where heroes gather for agent campaigns (workflows). Its x/y is the entrance. */
export const TENT = { x: 140, y: 128, w: 34, h: 22, route: "workflows", label: "War Table" };

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const POND = { cx: 252, cy: 146, rx: 26, ry: 11 };
const TREES = [
  { x: 12, y: 132 },
  { x: 22, y: 168 },
  { x: 302, y: 108 },
  { x: 306, y: 166 },
  { x: 120, y: 172 },
  { x: 196, y: 170 },
];

export const SOLIDS: Rect[] = [
  { x: 0, y: 0, w: WW, h: 77 }, // buildings row
  { x: POND.cx - POND.rx, y: POND.cy - POND.ry, w: POND.rx * 2, h: POND.ry * 2 },
  ...TREES.map((t) => ({ x: t.x - 3, y: t.y - 4, w: 6, h: 5 })),
  { x: SIGNPOST.x - 2, y: SIGNPOST.y - 3, w: 4, h: 3 },
  { x: TENT.x - TENT.w / 2, y: TENT.y - TENT.h, w: TENT.w, h: TENT.h - 2 },
];

export function blocked(x: number, y: number) {
  if (x < 4 || x > WW - 4 || y < 78 || y > WH - 4) return true;
  return SOLIDS.some((r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h);
}

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function randomFieldPoint(r: () => number) {
  for (let i = 0; i < 40; i++) {
    const x = FIELD.x0 + r() * (FIELD.x1 - FIELD.x0);
    const y = FIELD.y0 + r() * (FIELD.y1 - FIELD.y0);
    if (!blocked(x, y)) return { x, y };
  }
  return { x: 160, y: 120 };
}

// ---------- static background ----------

export function drawBackground(questNotes: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = WW;
  c.height = WH;
  const ctx = c.getContext("2d")!;
  const r = rng(7);
  const fill = (x: number, y: number, w: number, h: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
  };

  fill(0, 0, WW, WH, "#3fae5f");
  for (let i = 0; i < 700; i++) fill(r() * WW, r() * WH, 1, r() < 0.5 ? 1 : 2, r() < 0.6 ? "#2f9150" : "#5cc777");
  const flowers = [PAL.sand, PAL.white, "#e05b8a", PAL.cyan];
  for (let i = 0; i < 46; i++) {
    const x = r() * WW;
    const y = 88 + r() * 88;
    const col = flowers[Math.floor(r() * flowers.length)];
    fill(x, y, 1, 1, col);
    fill(x + 1, y + 1, 1, 1, col);
    fill(x + 1, y, 1, 1, "#2f9150");
  }

  // road
  fill(0, 74, WW, 12, "#c9a46b");
  fill(0, 74, WW, 1, "#a8844f");
  fill(0, 85, WW, 1, "#a8844f");
  for (let i = 0; i < 90; i++) fill(r() * WW, 76 + r() * 8, 1, 1, r() < 0.5 ? "#b08d58" : "#ddbd86");
  // path to the pond
  for (let y = 86; y < 132; y++) fill(214 + Math.sin(y / 9) * 6, y, 8, 1, "#c9a46b");

  // pond
  for (let y = -POND.ry; y <= POND.ry; y++) {
    const half = Math.round(POND.rx * Math.sqrt(1 - (y / POND.ry) ** 2));
    fill(POND.cx - half - 1, POND.cy + y, half * 2 + 2, 1, PAL.blue);
    if (Math.abs(y) < POND.ry) fill(POND.cx - half + 1, POND.cy + y, half * 2 - 2, 1, PAL.sky);
  }
  fill(POND.cx - 4, POND.cy - 2, 6, 3, "#3f9a4a"); // lily pad
  fill(POND.cx - 1, POND.cy - 2, 1, 1, "#e05b8a");

  // trees
  for (const t of TREES) {
    fill(t.x - 1, t.y - 6, 3, 6, PAL.woodDark);
    for (let y = -10; y <= 10; y++)
      for (let x = -9; x <= 9; x++) {
        const d = Math.hypot(x, y * 1.1);
        if (d <= 9) fill(t.x + x, t.y - 16 + y, 1, 1, d > 7.5 ? "#174f36" : x + y < -4 ? "#4cc274" : "#25774a");
      }
  }

  // signpost
  fill(SIGNPOST.x - 1, SIGNPOST.y - 12, 2, 12, PAL.woodDark);
  fill(SIGNPOST.x - 9, SIGNPOST.y - 14, 18, 7, PAL.wood);
  fill(SIGNPOST.x - 9, SIGNPOST.y - 8, 18, 1, PAL.woodDark);
  fill(SIGNPOST.x - 6, SIGNPOST.y - 12, 12, 1, PAL.sand);
  fill(SIGNPOST.x - 6, SIGNPOST.y - 10, 8, 1, PAL.sand);

  // War Table tent
  {
    const { x, y, w, h } = TENT;
    const left = x - w / 2;
    for (let i = 0; i < h; i++) {
      const half = Math.round((w / 2) * ((i + 1) / h));
      fill(x - half, y - h + i, half * 2, 1, i % 4 === 3 ? "#8a2c3f" : PAL.red);
      fill(x - half, y - h + i, Math.max(1, Math.round(half / 3)), 1, "#8a2c3f");
    }
    fill(left + 2, y - 1, w - 4, 1, "#5c1f2c");
    fill(x - 4, y - 10, 8, 10, PAL.ink); // entrance
    fill(x - 3, y - 9, 6, 9, "#3a2416");
    fill(x - 1, y - h - 6, 1, 7, PAL.woodDark); // pole
    // table with a map inside the entrance
    fill(x - 3, y - 4, 6, 2, PAL.wood);
    fill(x - 2, y - 5, 4, 1, "#f1dfb0");
  }

  const [hall, shrine, board, arena, tower] = BUILDINGS;

  // Hero Hall: stone house with a red roof
  {
    const x = hall.x;
    fill(x, 36, 52, 38, "#a3b8c6");
    for (let y = 38; y < 74; y += 4) {
      fill(x, y, 52, 1, "#7d93a6");
      for (let bx = (y / 4) % 2 ? 2 : 6; bx < 52; bx += 8) fill(x + bx, y - 3, 1, 3, "#7d93a6");
    }
    for (let i = 0; i < 22; i++) fill(x - 3 + i, 36 - i, 58 - i * 2, 1, i % 4 === 3 ? "#8a2c3f" : PAL.red);
    fill(x + 21, 58, 10, 16, PAL.woodDark);
    fill(x + 22, 59, 8, 15, PAL.wood);
    fill(x + 28, 66, 1, 1, PAL.sand);
    fill(x + 6, 46, 9, 8, PAL.ink);
    fill(x + 7, 47, 7, 6, PAL.sand);
    fill(x + 37, 46, 9, 8, PAL.ink);
    fill(x + 38, 47, 7, 6, PAL.sand);
    fill(x + 10, 47, 1, 6, PAL.wood);
    fill(x + 41, 47, 1, 6, PAL.wood);
  }

  // Skill Shrine: purple temple with columns
  {
    const x = shrine.x;
    fill(x, 66, 52, 8, PAL.slate);
    fill(x + 2, 64, 48, 2, PAL.silver);
    for (const cx of [4, 15, 32, 43]) {
      fill(x + cx, 36, 5, 28, PAL.white);
      fill(x + cx + 4, 36, 1, 28, PAL.silver);
    }
    fill(x + 2, 32, 48, 4, PAL.silver);
    for (let i = 0; i < 14; i++) fill(x + 2 + i * 2, 31 - i, 48 - i * 4, 1, i % 3 === 2 ? "#4a1e4a" : PAL.plum);
    fill(x + 20, 42, 12, 22, "#2a2040");
  }

  // Quest Board
  {
    const x = board.x;
    fill(x + 7, 30, 3, 44, PAL.woodDark);
    fill(x + 42, 30, 3, 44, PAL.woodDark);
    fill(x + 3, 26, 46, 34, PAL.woodDark);
    fill(x + 5, 28, 42, 30, PAL.wood);
    for (let i = 0; i < 8; i++) fill(x + 1 + i, 25 - i, 50 - i * 2, 1, i % 3 === 2 ? "#8a2c3f" : PAL.red);
    const n = Math.min(questNotes, 8);
    for (let i = 0; i < n; i++) {
      const nx = x + 8 + (i % 4) * 10;
      const ny = 31 + Math.floor(i / 4) * 13;
      fill(nx, ny, 8, 10, "#f1dfb0");
      fill(nx + 1, ny + 3, 6, 1, "#a8844f");
      fill(nx + 1, ny + 5, 5, 1, "#a8844f");
      fill(nx + 1, ny + 7, 6, 1, "#a8844f");
      fill(nx + 3, ny, 2, 1, PAL.red);
    }
    if (!n) {
      fill(x + 14, 36, 24, 12, "#f1dfb0");
      fill(x + 17, 40, 18, 1, "#a8844f");
      fill(x + 17, 43, 12, 1, "#a8844f");
    }
  }

  // Training Grounds: sand pit, fence, dummy and target
  {
    const x = arena.x;
    fill(x, 40, 52, 34, "#e2c78f");
    for (let i = 0; i < 40; i++) fill(x + r() * 52, 40 + r() * 34, 1, 1, "#cfb176");
    fill(x, 40, 52, 2, PAL.woodDark);
    for (let px = x; px <= x + 50; px += 8) fill(px, 34, 2, 10, PAL.woodDark);
    fill(x, 36, 52, 1, PAL.wood);
    // dummy
    fill(x + 33, 46, 2, 22, PAL.woodDark);
    fill(x + 28, 50, 12, 2, PAL.woodDark);
    fill(x + 30, 48, 8, 12, PAL.sand);
    fill(x + 31, 42, 6, 6, PAL.sand);
    fill(x + 32, 44, 1, 1, PAL.ink);
    fill(x + 35, 44, 1, 1, PAL.ink);
    // target
    for (const [rad, col] of [[7, PAL.white], [5, PAL.red], [3, PAL.white], [1, PAL.red]] as const)
      for (let y = -rad; y <= rad; y++)
        for (let xx = -rad; xx <= rad; xx++) if (xx * xx + y * y <= rad * rad) fill(x + 13 + xx, 54 + y, 1, 1, col);
    fill(x + 12, 62, 2, 10, PAL.woodDark);
  }

  // Chronicle Tower
  {
    const x = tower.x;
    fill(x + 10, 24, 32, 50, PAL.navy);
    for (let y = 26; y < 74; y += 4) fill(x + 10, y, 32, 1, "#222c5c");
    fill(x + 40, 24, 2, 50, "#1d2550");
    for (let i = 0; i < 20; i++) fill(x + 8 + Math.floor(i * 0.9), 24 - i, Math.max(2, 36 - Math.floor(i * 1.8)), 1, i % 4 === 3 ? "#4a1e4a" : PAL.plum);
    fill(x + 25, 2, 1, 4, PAL.sand);
    // clock
    for (let y = -5; y <= 5; y++) for (let xx = -5; xx <= 5; xx++) if (xx * xx + y * y <= 25) fill(x + 26 + xx, 34 + y, 1, 1, xx * xx + y * y > 16 ? PAL.sand : PAL.white);
    fill(x + 26, 30, 1, 4, PAL.ink);
    fill(x + 26, 34, 3, 1, PAL.ink);
    fill(x + 14, 46, 6, 8, PAL.sand);
    fill(x + 32, 46, 6, 8, PAL.sand);
    fill(x + 21, 58, 10, 16, PAL.woodDark);
    fill(x + 22, 59, 8, 15, PAL.wood);
  }

  return c;
}

/** Animated details drawn every frame on top of the background. */
export function drawAnimated(ctx: CanvasRenderingContext2D, t: number, activeCampaigns: number, openQuests: number) {
  const [hall, shrine, board] = BUILDINGS;
  const fill = (x: number, y: number, w: number, h: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
  };
  // banner on the hall
  fill(hall.x + 26, 4, 1, 12, PAL.woodDark);
  const wave = Math.floor(t / 300) % 2;
  fill(hall.x + 27, 4, 8, 3, PAL.sand);
  fill(hall.x + 27, 7, 8 - wave * 2, 2, PAL.orange);
  // glowing shrine crystal
  const glow = 0.5 + 0.5 * Math.sin(t / 400);
  const cx = shrine.x + 26;
  ctx.globalAlpha = 0.35 + 0.4 * glow;
  fill(cx - 8, 44, 16, 18, PAL.cyan);
  ctx.globalAlpha = 1;
  fill(cx - 2, 46, 4, 12, PAL.cyan);
  fill(cx - 3, 49, 6, 6, shade(PAL.cyan, 0.4));
  fill(cx - 1, 45, 2, 1, PAL.white);
  // sparkles above the shrine
  for (let i = 0; i < 3; i++) {
    const p = ((t / 900 + i / 3) % 1);
    fill(cx - 10 + i * 10, 44 - p * 18, 1, 1, PAL.white);
  }
  // pond shimmer
  for (let i = 0; i < 4; i++) {
    const s = Math.floor(t / 500 + i * 7) % 20;
    fill(POND.cx - 18 + i * 10 + (s % 4), POND.cy - 6 + (i % 3) * 5, 3, 1, PAL.cyan);
  }
  // tent flag waves while heroes are on a campaign
  {
    const wave2 = Math.floor(t / 200) % 2;
    const fx = TENT.x - 1;
    const fy = TENT.y - TENT.h - 6;
    fill(fx + 1, fy, 6 - wave2, 2, activeCampaigns > 0 ? PAL.sand : PAL.silver);
    fill(fx + 1, fy + 2, 4 + wave2, 2, activeCampaigns > 0 ? PAL.orange : PAL.slate);
  }
  // golden "!" over the quest board while you have open quests
  if (openQuests > 0) {
    const bob = Math.floor(t / 250) % 2;
    const bx = board.x + 24;
    fill(bx - 1, 12 + bob, 6, 13, PAL.ink);
    fill(bx, 13 + bob, 4, 8, PAL.sand);
    fill(bx, 22 + bob, 4, 2, PAL.sand);
  }
}

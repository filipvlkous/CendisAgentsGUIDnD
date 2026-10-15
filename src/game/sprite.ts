// Procedural pixel-art heroes. An agent's frontmatter decides how it looks:
//   model  → class (wizard, knight, rogue, adventurer)
//   color  → outfit
//   tools  → weapon
//   skills → one piece of gear per skill (cape, shield, pet, aura, …)
// Everything else (skin, hair) comes from a hash of the name, so a hero always looks the same.

export const W = 24;
export const H = 28;

export const PAL = {
  ink: "#1a1c2c",
  plum: "#5d275d",
  red: "#b13e53",
  orange: "#ef7d57",
  sand: "#ffcd75",
  lime: "#a7f070",
  green: "#38b764",
  teal: "#257179",
  navy: "#29366f",
  blue: "#3b5dc9",
  sky: "#41a6f6",
  cyan: "#73eff7",
  white: "#f4f4f4",
  silver: "#94b0c2",
  slate: "#566c86",
  dusk: "#333c57",
  wood: "#8a5a3b",
  woodDark: "#5c3a26",
};

export const OUTFIT: Record<string, string> = {
  red: "#b13e53",
  orange: "#ef7d57",
  yellow: "#e8b33a",
  green: "#38b764",
  cyan: "#2fb5c4",
  blue: "#3b5dc9",
  purple: "#7b3fa8",
  pink: "#d860a8",
};

const GEAR_COLORS = ["#73eff7", "#a7f070", "#ffcd75", "#ef7d57", "#d860a8", "#41a6f6", "#b13e53", "#f4f4f4", "#9a62d8", "#38b764"];
const SKINS = ["#f6d6bd", "#e8b796", "#c98e6a", "#9c6448", "#6e4430", "#ffd9c0"];
const HAIRS = ["#1a1c2c", "#5c3a26", "#8a5a3b", "#ffcd75", "#b13e53", "#f4f4f4", "#566c86", "#ef7d57"];

export type HeroClass = "wizard" | "knight" | "rogue" | "adventurer" | "sage";
export type Weapon = "sword" | "hammer" | "staff" | "bow" | "book" | "brush";
export const GEAR_SLOTS = ["cape", "shield", "pet", "aura", "gem", "crest", "boots", "belt"] as const;
export type GearSlot = (typeof GEAR_SLOTS)[number];
export interface Gear {
  skill: string;
  slot: GearSlot;
  color: string;
  /** On demand: not preloaded — the hero's orders call it with the Skill tool. Drawn as see-through ghost gear. */
  ghost?: boolean;
}

export interface Appearance {
  cls: HeroClass;
  outfit: string;
  accent: string;
  skin: string;
  hair: string;
  hairStyle: number;
  weapon: Weapon;
  gear: Gear[];
}

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const CLASS_INFO: Record<HeroClass, { label: string; blurb: string }> = {
  wizard: { label: "Wizard", blurb: "Opus / Fable — deep thinker, slow and powerful" },
  knight: { label: "Knight", blurb: "Sonnet — balanced, reliable all-rounder" },
  rogue: { label: "Rogue", blurb: "Haiku — fast, light and cheap" },
  adventurer: { label: "Adventurer", blurb: "Inherits the model of whoever summons it" },
  sage: { label: "Sage", blurb: "Claude itself, with every tool" },
};

export function classFor(model?: string): HeroClass {
  const m = (model ?? "").toLowerCase();
  if (m.includes("opus") || m.includes("fable")) return "wizard";
  if (m.includes("sonnet")) return "knight";
  if (m.includes("haiku")) return "rogue";
  return "adventurer";
}

export const WEAPON_INFO: Record<Weapon, string> = {
  hammer: "Builder's hammer — can edit and write files",
  sword: "Shell blade — runs commands",
  bow: "Longbow — reaches the web",
  brush: "Enchanted brush — wields MCP tools",
  book: "Tome — reads and searches only",
  staff: "Staff — inherits every tool",
};

export function weaponFor(tools: string | undefined, cls: HeroClass): Weapon {
  const t = (tools ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!t.length) return cls === "wizard" || cls === "sage" ? "staff" : "sword";
  if (t.includes("Edit") || t.includes("Write")) return "hammer";
  if (t.includes("Bash")) return "sword";
  if (t.includes("WebSearch") || t.includes("WebFetch")) return "bow";
  if (t.some((x) => x.startsWith("mcp__"))) return "brush";
  return "book";
}

/** Skills land in a slot picked from their name; collisions move to the next free slot. */
export function gearFor(skills: string[], onDemand: string[] = []): Gear[] {
  const used = new Set<GearSlot>();
  const out: Gear[] = [];
  // equipped skills claim their slots first; on-demand ones take what is left
  const all = [...skills.map((s) => ({ s, ghost: false })), ...onDemand.filter((s) => !skills.includes(s)).map((s) => ({ s, ghost: true }))];
  for (const { s: skill, ghost } of all) {
    const h = hash(skill);
    let i = h % GEAR_SLOTS.length;
    for (let n = 0; n < GEAR_SLOTS.length && used.has(GEAR_SLOTS[i]); n++) i = (i + 1) % GEAR_SLOTS.length;
    if (used.has(GEAR_SLOTS[i])) continue; // more than 8 skills: the extras don't show
    used.add(GEAR_SLOTS[i]);
    out.push({ skill, slot: GEAR_SLOTS[i], color: GEAR_COLORS[(h >>> 5) % GEAR_COLORS.length], ...(ghost ? { ghost } : {}) });
  }
  return out;
}

export function skillColor(skill: string) {
  return GEAR_COLORS[(hash(skill) >>> 5) % GEAR_COLORS.length];
}

/**
 * Skills a hero loads on demand: named in its orders (system prompt) and reachable because it has
 * the Skill tool (an empty tools list means every tool). Equipped skills are not repeated here.
 */
export function onDemandSkills(a: { body?: string; tools?: string; skills?: string[] }, known: string[]): string[] {
  const tools = (a.tools ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  if (tools.length && !tools.includes("Skill")) return [];
  const body = a.body ?? "";
  const esc = (n: string) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return known.filter((n) => !(a.skills ?? []).includes(n) && new RegExp(`(?<![\\w-])${esc(n)}(?![\\w-])`).test(body));
}

export function appearanceFor(
  a: { name: string; model?: string; color?: string; tools?: string; skills?: string[]; onDemand?: string[] },
  isDefault = false,
): Appearance {
  const h = hash(a.name);
  const cls = isDefault ? "sage" : classFor(a.model);
  const outfitKeys = Object.keys(OUTFIT);
  return {
    cls,
    outfit: isDefault ? PAL.orange : (OUTFIT[a.color ?? ""] ?? OUTFIT[outfitKeys[h % outfitKeys.length]]),
    accent: GEAR_COLORS[(h >>> 4) % GEAR_COLORS.length],
    skin: SKINS[(h >>> 8) % SKINS.length],
    hair: isDefault ? PAL.white : HAIRS[(h >>> 12) % HAIRS.length],
    hairStyle: (h >>> 16) % 3,
    weapon: isDefault ? "staff" : weaponFor(a.tools, cls),
    gear: gearFor(a.skills ?? [], a.onDemand ?? []),
  };
}

// ---------- drawing ----------

export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, "0")).join("")}`;
}

class Grid {
  px: (string | null)[] = new Array(W * H).fill(null);
  set(x: number, y: number, c: string) {
    if (x >= 0 && y >= 0 && x < W && y < H) this.px[y * W + x] = c;
  }
  get(x: number, y: number) {
    return x >= 0 && y >= 0 && x < W && y < H ? this.px[y * W + x] : null;
  }
  rect(x: number, y: number, w: number, h: number, c: string) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
}

/**
 * frame: 0 idle, 1 and 2 walking (alternating legs), 3 cheering (arms up).
 */
export function drawHero(app: Appearance, frame = 0): HTMLCanvasElement {
  const back = new Grid(); // no outline: shadow and aura
  const g = new Grid(); // outlined body
  const gear = Object.fromEntries(app.gear.map((x) => [x.slot, x.color])) as Partial<Record<GearSlot, string>>;
  // on-demand gear goes to see-through layers: behind the body (cape) or in front of it (everything else)
  const ghosts = new Set(app.gear.filter((x) => x.ghost).map((x) => x.slot));
  const ghostBack = new Grid();
  const ghostFront = new Grid();
  const G = (slot: GearSlot) => (ghosts.has(slot) ? (slot === "cape" ? ghostBack : ghostFront) : g);
  const o = app.outfit;
  const oD = shade(o, -0.3);
  const oL = shade(o, 0.25);
  const skinD = shade(app.skin, -0.18);
  const robe = app.cls === "wizard" || app.cls === "sage";

  // shadow
  for (let x = 7; x <= 16; x++) back.set(x, 26, "#00000040");
  for (let x = 9; x <= 14; x++) back.set(x, 27, "#00000030");

  // aura: a dithered ring
  if (gear.aura) {
    for (let y = 1; y < 27; y++)
      for (let x = 0; x < W; x++) {
        const d = Math.hypot((x - 11.5) / 1.0, (y - 14) / 1.25);
        if (d > 9.5 && d < 11.5 && (x + y + frame) % 2 === 0) back.set(x, y, gear.aura + (ghosts.has("aura") ? "55" : "aa"));
      }
  }

  // cape (behind the body)
  if (gear.cape) {
    const t = G("cape");
    t.rect(7, 13, 10, 10, gear.cape);
    t.rect(7, 13, 1, 10, shade(gear.cape, -0.3));
    t.rect(16, 13, 1, 10, shade(gear.cape, -0.3));
    for (let x = 7; x <= 16; x += 2) t.set(x, 23, gear.cape);
  }

  // legs and boots
  const boots = gear.boots && !ghosts.has("boots") ? gear.boots : PAL.woodDark;
  const lUp = frame === 1 ? 1 : 0;
  const rUp = frame === 2 ? 1 : 0;
  if (!robe) {
    g.rect(9, 21 - lUp, 2, 3, app.cls === "knight" ? PAL.silver : PAL.dusk);
    g.rect(13, 21 - rUp, 2, 3, app.cls === "knight" ? PAL.silver : PAL.dusk);
  }
  g.rect(9, 24 - lUp, 2, 1, boots);
  g.rect(8, 25 - lUp, 3, 1, shade(boots, -0.2));
  g.rect(13, 24 - rUp, 2, 1, boots);
  g.rect(13, 25 - rUp, 3, 1, shade(boots, -0.2));
  if (gear.boots && ghosts.has("boots")) {
    ghostFront.rect(9, 24 - lUp, 2, 1, gear.boots);
    ghostFront.rect(8, 25 - lUp, 3, 1, gear.boots);
    ghostFront.rect(13, 24 - rUp, 2, 1, gear.boots);
    ghostFront.rect(13, 25 - rUp, 3, 1, gear.boots);
  }

  // torso
  if (robe) {
    for (let y = 14; y <= 23; y++) {
      const spread = Math.floor((y - 14) / 3);
      g.rect(8 - spread, y, 8 + spread * 2, 1, o);
      g.set(15 + spread, y, oD);
    }
    g.rect(11, 14, 2, 10, oL);
  } else if (app.cls === "knight") {
    g.rect(8, 14, 8, 7, PAL.silver);
    g.rect(15, 14, 1, 7, PAL.slate);
    g.rect(10, 15, 4, 6, o); // tabard
    g.rect(13, 15, 1, 6, oD);
  } else if (app.cls === "rogue") {
    g.rect(8, 14, 8, 7, "#4a3a4e");
    g.rect(15, 14, 1, 7, "#2e2433");
    g.rect(8, 14, 8, 2, o); // scarf
    g.set(15, 16, o);
    g.set(15, 17, oD);
  } else {
    g.rect(8, 14, 8, 7, o);
    g.rect(15, 14, 1, 7, oD);
    g.rect(8, 14, 1, 7, oL);
  }
  if (!robe) g.rect(8, 19, 8, 1, PAL.woodDark);
  if (gear.belt) {
    G("belt").rect(8, 19, 8, 1, gear.belt);
    G("belt").set(11, 19, PAL.sand);
  }
  if (gear.crest) {
    G("crest").rect(11, 16, 2, 2, gear.crest);
    G("crest").set(11, 16, shade(gear.crest, 0.5));
  }

  // arms
  const sleeve = app.cls === "knight" ? PAL.silver : app.cls === "rogue" ? "#4a3a4e" : o;
  if (frame === 3) {
    g.rect(6, 10, 2, 5, sleeve);
    g.rect(16, 10, 2, 5, sleeve);
    g.rect(6, 9, 2, 1, app.skin);
    g.rect(16, 9, 2, 1, app.skin);
  } else {
    g.rect(6, 15, 2, 4, sleeve);
    g.rect(16, 15, 2, 4, shade(sleeve, -0.15));
    g.rect(6, 19, 2, 1, app.skin);
    g.rect(16, 19, 2, 1, skinD);
  }

  // head
  g.rect(8, 6, 8, 8, app.skin);
  g.rect(15, 7, 1, 7, skinD);
  g.rect(10, 10, 1, 2, PAL.ink);
  g.rect(13, 10, 1, 2, PAL.ink);
  g.set(9, 12, shade(app.skin, -0.08));
  g.set(14, 12, shade(app.skin, -0.08));

  // hair
  const hr = app.hair;
  g.rect(8, 6, 8, 2, hr);
  g.rect(7, 7, 1, 3, hr);
  g.rect(16, 7, 1, 3, hr);
  if (app.hairStyle === 1) g.rect(9, 8, 3, 1, hr);
  if (app.hairStyle === 2) {
    g.rect(7, 7, 1, 7, hr);
    g.rect(16, 7, 1, 7, hr);
  }

  // headgear by class
  const acc = app.accent;
  if (app.cls === "wizard") {
    const hat = shade(o, -0.15);
    g.rect(5, 6, 14, 1, hat);
    g.rect(7, 5, 10, 1, hat);
    g.rect(8, 4, 8, 1, hat);
    g.rect(9, 3, 6, 1, hat);
    g.rect(10, 2, 4, 1, hat);
    g.rect(11, 1, 3, 1, hat);
    g.rect(13, 0, 2, 1, hat);
    g.rect(8, 5, 8, 1, acc);
  } else if (app.cls === "knight") {
    g.rect(7, 4, 10, 4, PAL.silver);
    g.rect(16, 4, 1, 4, PAL.slate);
    g.rect(7, 8, 1, 4, PAL.silver);
    g.rect(16, 8, 1, 4, PAL.slate);
    g.rect(11, 1, 2, 3, acc); // plume
    g.set(13, 2, acc);
  } else if (app.cls === "rogue") {
    const hood = shade(o, -0.35);
    g.rect(7, 4, 10, 4, hood);
    g.rect(7, 8, 2, 6, hood);
    g.rect(15, 8, 2, 6, hood);
    g.rect(10, 3, 4, 1, hood);
    g.rect(8, 8, 8, 1, shade(hood, -0.3));
  } else if (app.cls === "sage") {
    g.rect(8, 6, 8, 1, PAL.sand);
    g.rect(11, 5, 2, 2, PAL.orange);
    g.set(11, 4, PAL.sand);
    g.set(12, 4, PAL.sand);
  } else {
    g.rect(8, 8, 8, 1, acc); // headband
    g.rect(17, 8, 1, 2, acc);
  }

  // weapon in the right hand
  const wy = frame === 3 ? -10 : 0;
  switch (app.weapon) {
    case "sword":
      g.rect(18, 7 + wy, 1, 10, PAL.white);
      g.rect(19, 8 + wy, 1, 9, PAL.silver);
      g.rect(16, 17 + wy, 5, 1, PAL.sand);
      g.rect(18, 18 + wy, 1, 2, PAL.wood);
      break;
    case "hammer":
      g.rect(18, 11 + wy, 1, 10, PAL.wood);
      g.rect(16, 8 + wy, 5, 3, PAL.silver);
      g.rect(16, 10 + wy, 5, 1, PAL.slate);
      break;
    case "staff":
      g.rect(18, 4 + wy, 1, 19, PAL.wood);
      g.rect(17, 1 + wy, 3, 3, acc);
      g.set(17, 1 + wy, shade(acc, 0.6));
      break;
    case "bow":
      g.set(19, 9 + wy, PAL.wood);
      g.rect(20, 10 + wy, 1, 10, PAL.wood);
      g.set(19, 20 + wy, PAL.wood);
      g.rect(18, 10 + wy, 1, 10, PAL.white);
      break;
    case "book":
      g.rect(16, 17 + wy, 4, 4, acc);
      g.rect(17, 18 + wy, 2, 2, PAL.white);
      break;
    case "brush":
      g.rect(18, 10 + wy, 1, 10, PAL.wood);
      g.rect(17, 7 + wy, 3, 3, acc);
      g.set(18, 6 + wy, shade(acc, -0.3));
      break;
  }

  // shield in the left hand
  if (gear.shield) {
    const s = gear.shield;
    const t = G("shield");
    t.rect(2, 14, 5, 6, s);
    t.rect(3, 20, 3, 1, s);
    t.set(4, 21, s);
    t.rect(2, 14, 5, 1, PAL.silver);
    t.rect(4, 15, 1, 5, shade(s, 0.45));
    t.rect(3, 16, 3, 1, shade(s, 0.45));
  }

  // pet slime at the feet, hopping while walking
  if (gear.pet) {
    const p = gear.pet;
    const hop = frame === 1 ? 1 : 0;
    const t = G("pet");
    t.rect(1, 23 - hop, 4, 3, p);
    t.rect(2, 22 - hop, 2, 1, p);
    t.set(2, 22 - hop, shade(p, 0.6));
    t.set(2, 24 - hop, PAL.ink);
    t.set(4, 24 - hop, PAL.ink);
  }

  // floating gem
  if (gear.gem) {
    const bob = frame % 2;
    const gm = gear.gem;
    const t = G("gem");
    t.set(3, 2 + bob, gm);
    t.rect(2, 3 + bob, 3, 1, gm);
    t.set(3, 4 + bob, shade(gm, -0.3));
    t.set(2, 3 + bob, shade(gm, 0.6));
  }

  // compose: back layer, outline, body
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const paint = (grid: Grid) => {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const col = grid.get(x, y);
        if (col) {
          ctx.fillStyle = col;
          ctx.fillRect(x, y, 1, 1);
        }
      }
  };
  // a faint light rim marks ghost gear as "not really there yet"
  const ghostLayer = (grid: Grid, alpha: number) => {
    ctx.globalAlpha = alpha;
    paint(grid);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = PAL.white;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (!grid.get(x, y) && !g.get(x, y) && (x + y) % 2 === 0 && (grid.get(x - 1, y) || grid.get(x + 1, y) || grid.get(x, y - 1) || grid.get(x, y + 1)))
          ctx.fillRect(x, y, 1, 1);
    ctx.globalAlpha = 1;
  };
  paint(back);
  ghostLayer(ghostBack, 0.4);
  ctx.fillStyle = PAL.ink;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (!g.get(x, y) && (g.get(x - 1, y) || g.get(x + 1, y) || g.get(x, y - 1) || g.get(x, y + 1))) ctx.fillRect(x, y, 1, 1);
  paint(g);
  ghostLayer(ghostFront, 0.45);
  return c;
}

const cache = new Map<string, HTMLCanvasElement>();

export function heroFrame(app: Appearance, frame: number): HTMLCanvasElement {
  const key = JSON.stringify(app) + frame;
  let c = cache.get(key);
  if (!c) {
    c = drawHero(app, frame);
    if (cache.size > 400) cache.clear();
    cache.set(key, c);
  }
  return c;
}

export function heroDataUrl(app: Appearance, frame = 0, scale = 3): string {
  const src = heroFrame(app, frame);
  const c = document.createElement("canvas");
  c.width = W * scale;
  c.height = H * scale;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL();
}

// ---------- skill icons (12×12) ----------

const ICON_SHAPES = ["gem", "scroll", "potion", "rune", "orb", "tome"] as const;

export function skillIcon(skill: string): HTMLCanvasElement {
  const key = "icon:" + skill;
  const hit = cache.get(key);
  if (hit) return hit;
  const S = 12;
  const g: (string | null)[] = new Array(S * S).fill(null);
  const set = (x: number, y: number, c: string) => x >= 0 && y >= 0 && x < S && y < S && (g[y * S + x] = c);
  const rect = (x: number, y: number, w: number, h: number, c: string) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, c);
  };
  const h = hash(skill);
  const col = skillColor(skill);
  const lt = shade(col, 0.55);
  const dk = shade(col, -0.35);
  switch (ICON_SHAPES[h % ICON_SHAPES.length]) {
    case "gem":
      rect(4, 2, 4, 1, lt);
      rect(3, 3, 6, 2, col);
      rect(4, 5, 4, 2, col);
      rect(5, 7, 2, 2, dk);
      set(4, 3, lt);
      break;
    case "scroll":
      rect(2, 2, 8, 8, "#f1dfb0");
      rect(1, 2, 1, 8, PAL.wood);
      rect(10, 2, 1, 8, PAL.wood);
      rect(3, 4, 6, 1, col);
      rect(3, 6, 4, 1, col);
      rect(3, 8, 5, 1, dk);
      break;
    case "potion":
      rect(5, 1, 2, 2, PAL.wood);
      rect(5, 3, 2, 1, PAL.silver);
      rect(3, 4, 6, 6, col);
      rect(4, 10, 4, 1, dk);
      set(4, 5, lt);
      set(4, 6, lt);
      break;
    case "rune":
      rect(2, 2, 8, 8, PAL.slate);
      rect(2, 9, 8, 1, PAL.dusk);
      rect(5, 3, 2, 6, col);
      rect(3, 5, 6, 1, col);
      set(4, 3, lt);
      break;
    case "orb":
      rect(4, 2, 4, 1, col);
      rect(3, 3, 6, 5, col);
      rect(4, 8, 4, 1, dk);
      rect(4, 3, 2, 2, lt);
      rect(3, 9, 6, 2, PAL.wood);
      break;
    case "tome":
      rect(2, 2, 8, 8, col);
      rect(2, 2, 1, 8, dk);
      rect(4, 4, 4, 3, lt);
      rect(3, 10, 7, 1, PAL.white);
      break;
  }
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = PAL.ink;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const at = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < S && yy < S && g[yy * S + xx];
      if (!g[y * S + x] && (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1))) ctx.fillRect(x, y, 1, 1);
    }
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++)
      if (g[y * S + x]) {
        ctx.fillStyle = g[y * S + x]!;
        ctx.fillRect(x, y, 1, 1);
      }
  cache.set(key, c);
  return c;
}

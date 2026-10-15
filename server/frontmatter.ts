import YAML from "yaml";

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(text: string): { data: Record<string, unknown>; body: string } {
  const match = FENCE.exec(text);
  if (!match) return { data: {}, body: text };
  let data: Record<string, unknown> = {};
  try {
    const parsed = YAML.parse(match[1]);
    if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>;
  } catch {
    // Malformed frontmatter: keep the body readable rather than failing the listing.
  }
  return { data, body: text.slice(match[0].length).replace(/^\r?\n/, "") };
}

export function stringifyFrontmatter(data: Record<string, unknown>, body: string): string {
  const clean = Object.fromEntries(
    Object.entries(data).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  );
  const yaml = YAML.stringify(clean, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n\n${body.trim()}\n`;
}

export function str(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

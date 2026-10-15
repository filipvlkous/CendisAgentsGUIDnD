import { useEffect, useRef, useState } from "react";
import { heroFrame, H, skillIcon, W, type Appearance } from "../game/sprite";

/** An animated hero. Idle heroes bob; walking heroes swap legs. */
export function HeroSprite({
  app,
  scale = 3,
  walking = false,
  cheer = false,
  flip = false,
  className,
}: {
  app: Appearance;
  scale?: number;
  walking?: boolean;
  cheer?: boolean;
  flip?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), walking ? 160 : 450);
    return () => clearInterval(t);
  }, [walking]);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, c.width, c.height);
    const frame = cheer ? (tick % 2 ? 3 : 0) : walking ? 1 + (tick % 2) : tick % 2 ? 0 : 0;
    const bob = !walking && !cheer && tick % 2 ? 1 : 0;
    ctx.save();
    if (flip) {
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(heroFrame(app, frame), 0, bob * scale, W * scale, H * scale);
    ctx.restore();
  }, [app, tick, walking, cheer, flip, scale]);
  return <canvas ref={ref} width={W * scale} height={(H + 1) * scale} className={`pixel ${className ?? ""}`} />;
}

export function SkillIcon({ skill, scale = 2 }: { skill: string; scale?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, 12 * scale, 12 * scale);
    ctx.drawImage(skillIcon(skill), 0, 0, 12 * scale, 12 * scale);
  }, [skill, scale]);
  return <canvas ref={ref} width={12 * scale} height={12 * scale} className="pixel" style={{ flex: "none" }} />;
}

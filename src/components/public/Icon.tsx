import fs from "node:fs";
import path from "node:path";

const ALLOWED_ICONS = new Set([
  "arrow-left",
  "arrow-right",
  "engine",
  "wrench",
  "disc",
  "steering-wheel",
  "list",
  "x",
  "whatsapp-logo",
]);

export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  if (!ALLOWED_ICONS.has(name)) return null;
  const svgPath = path.join(
    process.cwd(),
    "node_modules",
    "@phosphor-icons",
    "core",
    "assets",
    "regular",
    `${name}.svg`,
  );
  const svg = fs.readFileSync(svgPath, "utf8");
  return (
    <span
      className="icon"
      style={{ ["--size" as string]: `${size}px` }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

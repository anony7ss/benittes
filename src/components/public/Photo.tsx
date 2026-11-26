import { fotos } from "@/config/oficina";

export function Photo({
  id,
  priority = false,
  sizes = "100vw",
  alt: altOverride,
  width,
  height,
  srcWidths,
  srcWidth = 1120,
}: {
  id: string;
  priority?: boolean;
  sizes?: string;
  alt?: string;
  width?: number;
  height?: number;
  srcWidths?: readonly number[];
  srcWidth?: number;
}) {
  const alt = altOverride ?? fotos.find((p) => p.id === id)?.alt ?? "";
  const widths = srcWidths ?? [640, 1120, 1800];
  const srcSet = widths.map((w) => `/media/${id}-${w}.jpg ${w}w`).join(", ");
  const intrinsicWidth = width ?? 1120;
  const intrinsicHeight = height ?? (id === "cofre" ? 630 : 1680);

  return (
    <picture>
      <img
        src={`/media/${id}-${srcWidth}.jpg`}
        srcSet={srcSet}
        sizes={sizes}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
        width={intrinsicWidth}
        height={intrinsicHeight}
      />
    </picture>
  );
}

import { fotos } from "@/config/oficina";

const photoDimensions: Record<string, { width: number; height: number }> = {
  bloco: { width: 1536, height: 1024 },
  bancada: { width: 1536, height: 864 },
  cofre: { width: 1536, height: 726 },
};

export function Photo({
  id,
  priority = false,
  sizes = "100vw",
  alt: altOverride,
  width,
  height,
  srcWidths,
  srcWidth = 1120,
  format = "webp",
}: {
  id: string;
  priority?: boolean;
  sizes?: string;
  alt?: string;
  width?: number;
  height?: number;
  srcWidths?: readonly number[];
  srcWidth?: number;
  format?: "jpg" | "webp";
}) {
  const alt = altOverride ?? fotos.find((p) => p.id === id)?.alt ?? "";
  const widths = srcWidths ?? [640, 1120, 1536];
  const srcSet = widths.map((w) => `/media/${id}-${w}.${format} ${w}w`).join(", ");
  const intrinsicWidth = width ?? photoDimensions[id]?.width ?? 1120;
  const intrinsicHeight = height ?? photoDimensions[id]?.height ?? 630;

  return (
    <picture>
      <img
        src={`/media/${id}-${srcWidth}.${format}`}
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

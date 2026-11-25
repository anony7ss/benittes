"use client";

import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

type TColorProp = string | string[];

interface ShineBorderProps {
  borderRadius?: number;
  borderWidth?: number;
  duration?: number;
  color?: TColorProp;
  className?: string;
  children: ReactNode;
}

/**
 * @name Shine Border
 * @description Animated background border effect component with configurable props.
 */
export function ShineBorder({
  borderRadius = 8,
  borderWidth = 1,
  duration = 14,
  color = "#000000",
  className,
  children,
}: ShineBorderProps) {
  const colorValue = Array.isArray(color) ? color.join(",") : color;

  return (
    <div
      style={
        {
          "--border-radius": `${borderRadius}px`,
          "--border-width": `${borderWidth}px`,
          "--duration": `${duration}s`,
          "--shine-color": colorValue,
        } as CSSProperties
      }
      className={cn("shine-border-card", className)}
    >
      <div className="shine-border-glow" aria-hidden="true" />
      {children}
    </div>
  );
}

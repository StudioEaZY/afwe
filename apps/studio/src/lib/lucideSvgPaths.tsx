// apps/studio/src/lib/lucideSvgPaths.tsx
// Pure 24x24 Lucide SVG stroke icon paths for use inside SVG <g> elements across Radial, Constellation, and Topology maps.

import React from "react";

export type DomainIconKey = "web" | "phone" | "gear" | "srv" | "layers" | "db" | "link" | "cloud";

/**
 * Render a 24x24 Lucide domain icon centered at (-12, -12) inside an SVG <g>.
 */
export const SvgDomainIcon: React.FC<{
  iconKey?: string;
  stroke?: string;
  strokeWidth?: number;
}> = ({ iconKey = "layers", stroke = "var(--ink)", strokeWidth = 1.7 }) => {
  const common = {
    fill: "none",
    stroke,
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (iconKey) {
    case "web": // Lucide Globe / Monitor
      return (
        <g {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3a14 14 0 0 1 0 18" />
          <path d="M12 3a14 14 0 0 0 0 18" />
        </g>
      );
    case "phone": // Lucide Smartphone
      return (
        <g {...common}>
          <rect x="6" y="2" width="12" height="20" rx="2" ry="2" />
          <path d="M12 18h.01" />
        </g>
      );
    case "gear": // Lucide Settings / Sliders
      return (
        <g {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </g>
      );
    case "srv": // Lucide Server
      return (
        <g {...common}>
          <rect x="3" y="4" width="18" height="6" rx="1.5" />
          <rect x="3" y="14" width="18" height="6" rx="1.5" />
          <circle cx="7" cy="7" r="1" fill={stroke} />
          <circle cx="7" cy="17" r="1" fill={stroke} />
        </g>
      );
    case "db": // Lucide Database
      return (
        <g {...common}>
          <ellipse cx="12" cy="5" rx="8" ry="3" />
          <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
          <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
        </g>
      );
    case "link": // Lucide Share2 / Link2
      return (
        <g {...common}>
          <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
          <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
        </g>
      );
    case "cloud": // Lucide Cloud
      return (
        <g {...common}>
          <path d="M18 10h-1.3A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
        </g>
      );
    case "layers":
    default: // Lucide Layers
      return (
        <g {...common}>
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 12 12 17 22 12" />
          <polyline points="2 17 12 22 22 17" />
        </g>
      );
  }
};

/**
 * Render a mini Lucide Lock icon centered at (0, 0) for SVG badges.
 */
export const SvgMiniLock: React.FC<{ stroke?: string }> = ({ stroke = "var(--ink)" }) => (
  <g fill="none" stroke={stroke} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <rect x="-4" y="-1" width="8" height="6" rx="1.2" />
    <path d="M-2.5-1V-3a2.5 2.5 0 0 1 5 0v2" />
  </g>
);

/**
 * Render a mini Lucide AlertTriangle icon centered at (0, 0) for SVG badges.
 */
export const SvgMiniAlertTriangle: React.FC<{ stroke?: string; fill?: string }> = ({
  stroke = "#fff",
  fill = "var(--red)",
}) => (
  <g>
    <path
      d="M0 -6 L6 5 L-6 5 Z"
      fill={fill}
      stroke={stroke}
      strokeWidth={1.2}
      strokeLinejoin="round"
    />
    <path d="M0 -2.2 V1.2 M0 3.2 V3.4" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" />
  </g>
);

/**
 * Render a mini Lucide ArrowLeftRight icon centered at (0, 0) for mutual dependency badges.
 */
export const SvgMiniMutual: React.FC<{ stroke?: string }> = ({ stroke = "var(--amber)" }) => (
  <g fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M-4 -1.5 H4 M2 -3.5 L4 -1.5 L2 0.5" />
    <path d="M4 1.5 H-4 M-2 -0.5 L-4 1.5 L-2 3.5" />
  </g>
);

/**
 * Geometric Constellation Glyph matching Lucide 24x24 2px stroke styling.
 * Depicts a focal anchor hub with surrounding connected satellites (zero stars).
 */
export const ConstellationGlyph: React.FC<{ size?: number; className?: string }> = ({
  size = 14,
  className,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0 }}
  >
    <circle cx="12" cy="12" r="3" fill="currentColor" fillOpacity="0.25" />
    <circle cx="4" cy="9" r="2" />
    <circle cx="20" cy="15" r="2" />
    <circle cx="17" cy="5" r="1.8" />
    <circle cx="7" cy="19" r="1.8" />
    <line x1="6" y1="9.6" x2="9.2" y2="11" />
    <line x1="14.8" y1="13" x2="18.2" y2="14.4" />
    <line x1="13.8" y1="9.7" x2="15.8" y2="6.6" />
    <line x1="10.2" y1="14.3" x2="8.3" y2="17.4" />
  </svg>
);


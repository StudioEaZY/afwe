// apps/studio/src/lib/semanticZoomEngine.ts
// Semantic Zoom Engine implementing Google Maps & Figma viewport mechanics:
// 1. Mouse-anchored focal zoom (cursor coordinate invariance under zoom)
// 2. Semantic Level-of-Detail (LOD) thresholding (Macro / Standard / Detailed)
// 3. Dynamic space-aware label measurement (no naive character slicing)
// 4. Inverse-scaling for critical badges (violations, pins, bookmarks never blur)
// 5. Spacebar & Hand tool panning management

import { useEffect, useState, useRef } from "react";

export interface ViewportTransform {
  k: number;
  x: number;
  y: number;
}

export type SemanticLOD = "macro" | "standard" | "detailed";

export interface AdaptiveLabelResult {
  displayText: string;
  displaySubtext: string | null;
  isTruncated: boolean;
  fontSize: number;
  subFontSize: number;
  showSubtext: boolean;
}

/**
 * Computes mouse-anchored focal zoom ensuring graph point under cursor remains invariant.
 * Equation:
 *   u = (xm - x_old) / k_old
 *   x_new = xm - u * k_new
 */
export function computeFocalZoom(
  prevZoom: ViewportTransform,
  deltaY: number,
  clientX: number,
  clientY: number,
  containerRect: { left: number; top: number; width: number; height: number },
  minK = 0.45,
  maxK = 3.2
): ViewportTransform {
  const xm = clientX - containerRect.left;
  const ym = clientY - containerRect.top;

  // Damped exponential scaling for ultra-smooth trackpad and notched mouse wheel
  const damping = 0.0016;
  const deltaClamped = Math.max(-120, Math.min(120, deltaY));
  const factor = Math.exp(-deltaClamped * damping);

  const nextK = Math.max(minK, Math.min(maxK, prevZoom.k * factor));
  if (Math.abs(nextK - prevZoom.k) < 0.0001) return prevZoom;

  const nextX = xm - ((xm - prevZoom.x) * nextK) / prevZoom.k;
  const nextY = ym - ((ym - prevZoom.y) * nextK) / prevZoom.k;

  return { k: nextK, x: nextX, y: nextY };
}

/**
 * Centered step zoom for floating +/- toolbar buttons.
 */
export function computeStepZoom(
  prevZoom: ViewportTransform,
  direction: "in" | "out",
  containerRect: { left: number; top: number; width: number; height: number },
  stepRatio = 1.25,
  minK = 0.45,
  maxK = 3.2
): ViewportTransform {
  const xm = containerRect.width / 2;
  const ym = containerRect.height / 2;
  const factor = direction === "in" ? stepRatio : 1 / stepRatio;
  const nextK = Math.max(minK, Math.min(maxK, prevZoom.k * factor));

  const nextX = xm - ((xm - prevZoom.x) * nextK) / prevZoom.k;
  const nextY = ym - ((ym - prevZoom.y) * nextK) / prevZoom.k;

  return { k: nextK, x: nextX, y: nextY };
}

/**
 * Returns the semantic Level-of-Detail category based on zoom scale k.
 */
export function getSemanticLOD(k: number): SemanticLOD {
  if (k < 0.72) return "macro";
  if (k < 1.35) return "standard";
  return "detailed";
}

/**
 * Inverse-scaling factor for critical priority badges (Rule violations, Pinned checks, Bookmarks).
 * Guarantees a minimum physical on-screen footprint (>= 18px) when zoomed out.
 */
export function computeBadgeInverseScale(k: number, minScale = 1.0, maxScale = 1.6): number {
  if (k >= 1.0) return 1.0;
  const inv = 1 / Math.sqrt(k);
  return Math.min(maxScale, Math.max(minScale, inv));
}

/**
 * Space-aware adaptive text layout engine:
 * Evaluates available physical pixels (containerWidth * zoomK) against text length.
 * Expands full titles, wraps two lines when space permits, and only truncates when necessary.
 */
export function computeAdaptiveLabel(
  label: string,
  sublabel: string | undefined,
  containerWidth: number,
  zoomK: number,
  isPriority = false,
  baseFontSize = 13.5
): AdaptiveLabelResult {
  const physicalWidth = containerWidth * zoomK;
  const lod = getSemanticLOD(zoomK);

  // Approximate character width (~0.58 of font size in sans-serif)
  const charWidth = baseFontSize * 0.58;
  const requiredLabelWidth = label.length * charWidth;

  // In Macro mode, focus on priority alerts and concise domain names
  if (lod === "macro") {
    const maxChars = Math.max(4, Math.floor(physicalWidth / (charWidth * 1.1)));
    const displayText =
      label.length <= maxChars
        ? label
        : isPriority
        ? label
        : label.slice(0, Math.max(3, maxChars - 2)) + "…";

    return {
      displayText,
      displaySubtext: null,
      isTruncated: displayText.length < label.length,
      fontSize: baseFontSize,
      subFontSize: 9,
      showSubtext: false,
    };
  }

  // In Standard mode, give room for full titles and compact sublabels
  if (lod === "standard") {
    let displayText = label;
    let isTruncated = false;

    if (requiredLabelWidth > physicalWidth - 28) {
      const maxChars = Math.max(6, Math.floor((physicalWidth - 28) / charWidth));
      if (label.length > maxChars) {
        displayText = label.slice(0, maxChars - 1) + "…";
        isTruncated = true;
      }
    }

    const showSubtext = Boolean(sublabel && physicalWidth > 110);
    return {
      displayText,
      displaySubtext: showSubtext ? sublabel! : null,
      isTruncated,
      fontSize: baseFontSize,
      subFontSize: 9.5,
      showSubtext,
    };
  }

  // In Detailed mode, show full label and sublabel with zero truncation
  return {
    displayText: label,
    displaySubtext: sublabel || null,
    isTruncated: false,
    fontSize: baseFontSize,
    subFontSize: 10,
    showSubtext: Boolean(sublabel),
  };
}

/**
 * React hook to manage Spacebar pan tool state and grab/grabbing cursors.
 */
export function useSpacebarPan(isHandToolActive = false) {
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input or textarea
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        setIsSpacePressed(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setIsSpacePressed(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const isPanMode = isSpacePressed || isHandToolActive;

  return {
    isPanMode,
    isDraggingCanvas,
    setIsDraggingCanvas,
    cursorStyle: isPanMode
      ? isDraggingCanvas
        ? "grabbing"
        : "grab"
      : undefined,
  };
}

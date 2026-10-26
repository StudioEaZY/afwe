// apps/studio/src/lib/hierarchy.ts
// Indefinite-depth hierarchy builder, kind discovery, adaptive split strategy, and layout computation.

export type EntityKind =
  | "project"
  | "domain"
  | "feature"
  | "folder"
  | "file"
  | "symbol"
  | "edge"
  | "boundary"
  | "proposal"
  | "violation"
  | "pin"
  | "question";

export interface SelectedEntity {
  id: string;
  kind: EntityKind;
  label: string;
  path: string;
  status: "mapped" | "uncharted" | "proposed" | "violation" | "pinned" | "question";
  fileCount?: number;
  mappedCount?: number;
  description?: string;
  purpose?: string;
  parentId?: string | null;
  raw?: any;
  violationMessage?: string;
  pinStatement?: string;
  questionText?: string;
}

export interface HierarchyNode {
  id: string;
  label: string;
  kind: EntityKind;
  path: string;
  isCharted: boolean;
  fileCount: number;
  mappedCount: number;
  depth: number;
  parentId: string | null;
  children: HierarchyNode[];
  hasViolation: boolean;
  hasPin: boolean;
  hasQuestion: boolean;
  hasProposal: boolean;
  violationDetails?: string[];
  pinDetails?: string[];
  questionDetails?: string[];
  raw?: any;
}

export interface RadialSlice {
  id: string;
  label: string;
  kind: EntityKind;
  path: string;
  ring: 1 | 2; // Ring 1 = child, Ring 2 = grandchild
  isCharted: boolean;
  fileCount: number;
  mappedCount: number;
  startAngle: number; // in radians
  endAngle: number;
  innerRadius: number;
  outerRadius: number;
  hasViolation: boolean;
  hasPin: boolean;
  hasQuestion: boolean;
  hasProposal: boolean;
  parentSliceId?: string;
  node: HierarchyNode;
}

export interface TopologyTerritory {
  id: string;
  label: string;
  path: string;
  isCharted: boolean;
  fileCount: number;
  mappedCount: number;
  hasViolation: boolean;
  hasPin: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  hullPath: string; // Organic concave SVG path
  cards: TopologyCard[];
  parcels: TopologyParcel[];
  node: HierarchyNode;
}

export interface TopologyCard {
  id: string;
  label: string;
  path: string;
  subPath: string;
  isCharted: boolean;
  fileCount: number;
  hasViolation: boolean;
  hasPin: boolean;
  hasQuestion: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  node: HierarchyNode;
}

export interface TopologyParcel {
  id: string;
  label: string;
  path: string;
  fileCount: number;
  isCharted: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  node: HierarchyNode;
}

export interface TopologyEdge {
  id: string;
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  verb: string;
  count: number;
  isViolation: boolean;
  pathD: string;
  midX: number;
  midY: number;
}

/**
 * Build the multi-layer hierarchy tree from graph snapshot.
 */
export function buildHierarchyTree(graph: any): HierarchyNode {
  if (!graph) {
    return {
      id: "root",
      label: "Project",
      kind: "project",
      path: "",
      isCharted: false,
      fileCount: 0,
      mappedCount: 0,
      depth: 0,
      parentId: null,
      children: [],
      hasViolation: false,
      hasPin: false,
      hasQuestion: false,
      hasProposal: false,
    };
  }

  const nodes = graph.nodes || [];
  const files = graph.files || [];
  const unmapped = new Set(graph.unmapped || []);
  const pins = graph.pins || [];
  const checks = graph.checks || [];
  const calibration = graph.calibration || { guides: [], questions: [] };
  const proposals = graph.proposals || [];
  const codeEdges = graph.code_edges || [];

  const violationsByNode = new Set<string>();
  for (const ce of codeEdges) {
    if (ce.violation) {
      violationsByNode.add(ce.from);
      violationsByNode.add(ce.to);
    }
  }

  const pinsByNode = new Set<string>();
  for (const pin of pins) {
    if (pin.status === "active" && pin.attaches) {
      for (const att of pin.attaches) {
        pinsByNode.add(att);
      }
    }
  }

  const questionsByNode = new Set<string>();
  for (const q of calibration.questions || []) {
    if (q.status === "open" && q.attaches) {
      for (const att of q.attaches) {
        questionsByNode.add(att);
      }
    }
  }

  const nodeMap = new Map<string, any>();
  for (const n of nodes) {
    nodeMap.set(n.id, n);
  }

  // 1. Group blueprint nodes by parent
  const topBlueprintNodes = nodes.filter((n: any) => !n.parent || !nodeMap.has(n.parent));

  // 2. Discover unmapped top-level folders
  const unmappedFolders = new Map<string, string[]>();
  for (const f of unmapped) {
    const parts = (f as string).split("/");
    const topFolder = parts.length > 1 ? parts[0] : "(root)";
    if (!unmappedFolders.has(topFolder)) {
      unmappedFolders.set(topFolder, []);
    }
    unmappedFolders.get(topFolder)!.push(f as string);
  }

  // Convert blueprint node recursively
  function convertBlueprintNode(bn: any, depth: number): HierarchyNode {
    const hasV = violationsByNode.has(bn.id);
    const hasP = pinsByNode.has(bn.id);
    const hasQ = questionsByNode.has(bn.id);

    const childBpNodes = nodes.filter((child: any) => child.parent === bn.id);
    const mappedChildren = childBpNodes.map((child: any) => convertBlueprintNode(child, depth + 1));

    // Also collect files associated with this node
    const nodeFiles = (bn.file_list || []).map((fp: string) => {
      const parts = fp.split("/");
      const fileName = parts[parts.length - 1];
      return {
        id: `file:${fp}`,
        label: fileName,
        kind: "file" as EntityKind,
        path: fp,
        isCharted: true,
        fileCount: 1,
        mappedCount: 1,
        depth: depth + 2,
        parentId: bn.id,
        children: [],
        hasViolation: false,
        hasPin: false,
        hasQuestion: false,
        hasProposal: false,
      };
    });

    const isDomain = depth === 1 || bn.kind === "module" || bn.kind === "domain";
    const totalFiles = (bn.files || 0) + mappedChildren.reduce((acc: number, c: HierarchyNode) => acc + c.fileCount, 0);

    return {
      id: bn.id,
      label: bn.name || bn.id,
      kind: isDomain ? "domain" : "feature",
      path: bn.path || bn.id,
      isCharted: true,
      fileCount: totalFiles > 0 ? totalFiles : 1,
      mappedCount: totalFiles > 0 ? totalFiles : 1,
      depth,
      parentId: bn.parent || null,
      children: mappedChildren.length > 0 ? mappedChildren : nodeFiles,
      hasViolation: hasV,
      hasPin: hasP,
      hasQuestion: hasQ,
      hasProposal: false,
      raw: bn,
    };
  }

  const topNodes: HierarchyNode[] = topBlueprintNodes.map((bn: any) => convertBlueprintNode(bn, 1));

  // Add unmapped top-level folders as uncharted domains
  for (const [folderName, folderFiles] of unmappedFolders.entries()) {
    // If there's already a blueprint domain with this name, don't duplicate
    if (topNodes.some((tn) => tn.label.toLowerCase() === folderName.toLowerCase() || tn.path.toLowerCase() === folderName.toLowerCase())) {
      continue;
    }

    const subFolders = new Map<string, string[]>();
    for (const ff of folderFiles) {
      const parts = ff.split("/");
      const sub = parts.length > 2 ? parts[1] : "(files)";
      if (!subFolders.has(sub)) subFolders.set(sub, []);
      subFolders.get(sub)!.push(ff);
    }

    const subChildren: HierarchyNode[] = Array.from(subFolders.entries()).map(([subName, subFiles]) => ({
      id: `folder:${folderName}/${subName}`,
      label: subName,
      kind: "folder" as EntityKind,
      path: `${folderName}/${subName}`,
      isCharted: false,
      fileCount: subFiles.length,
      mappedCount: 0,
      depth: 2,
      parentId: `folder:${folderName}`,
      children: subFiles.map((sf) => ({
        id: `file:${sf}`,
        label: sf.split("/").pop() || sf,
        kind: "file" as EntityKind,
        path: sf,
        isCharted: false,
        fileCount: 1,
        mappedCount: 0,
        depth: 3,
        parentId: `folder:${folderName}/${subName}`,
        children: [],
        hasViolation: false,
        hasPin: false,
        hasQuestion: false,
        hasProposal: false,
      })),
      hasViolation: false,
      hasPin: false,
      hasQuestion: false,
      hasProposal: false,
    }));

    topNodes.push({
      id: `folder:${folderName}`,
      label: folderName,
      kind: "folder",
      path: folderName,
      isCharted: false,
      fileCount: folderFiles.length,
      mappedCount: 0,
      depth: 1,
      parentId: null,
      children: subChildren,
      hasViolation: false,
      hasPin: false,
      hasQuestion: false,
      hasProposal: false,
    });
  }

  const totalFiles = files.length || topNodes.reduce((acc, n) => acc + n.fileCount, 0);
  const totalMapped = topNodes.reduce((acc, n) => acc + n.mappedCount, 0);

  return {
    id: "root",
    label: graph.project?.name || "Codebase",
    kind: "project",
    path: "",
    isCharted: totalMapped > 0,
    fileCount: totalFiles,
    mappedCount: totalMapped,
    depth: 0,
    parentId: null,
    children: topNodes,
    hasViolation: violationsByNode.size > 0,
    hasPin: pins.some((p: any) => p.status === "active"),
    hasQuestion: (calibration.questions || []).some((q: any) => q.status === "open"),
    hasProposal: proposals.some((p: any) => p.status === "pending"),
    raw: graph,
  };
}

/**
 * Find a node in the hierarchy tree by ID.
 */
export function findNodeById(root: HierarchyNode, id: string): HierarchyNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNodeById(child, id);
    if (found) return found;
  }
  return null;
}

/**
 * Determine split strategy and explanation caption for a given node.
 */
export function determineSplitStrategy(focusNode: HierarchyNode): {
  strategyName: string;
  caption: string;
} {
  const children = focusNode.children || [];
  if (children.length === 0) {
    return {
      strategyName: "Leaf Files",
      caption: "Viewing individual source files and AST symbols.",
    };
  }

  const chartedCount = children.filter((c) => c.isCharted).length;
  const chartedRatio = chartedCount / children.length;

  if (chartedRatio >= 0.5) {
    return {
      strategyName: "Blueprint Ownership",
      caption: "Split by architectural domains & features. Size is file count.",
    };
  }

  const hasSubfolders = children.some((c) => c.children.length > 0);
  if (hasSubfolders) {
    return {
      strategyName: "Folder Structure",
      caption: "Split by directory tree. Size is file count.",
    };
  }

  return {
    strategyName: "Import Clusters",
    caption: "Split by coupling and import relationships. Size is file count.",
  };
}

/**
 * Discover active kinds visible at current focus scope.
 */
export function discoverVisibleKinds(focusNode: HierarchyNode): EntityKind[] {
  const kinds = new Set<EntityKind>();
  kinds.add(focusNode.kind);

  for (const child of focusNode.children || []) {
    kinds.add(child.kind);
    if (child.hasViolation) kinds.add("violation");
    if (child.hasPin) kinds.add("pin");
    if (child.hasQuestion) kinds.add("question");
    if (child.hasProposal) kinds.add("proposal");

    for (const gchild of child.children || []) {
      kinds.add(gchild.kind);
      if (gchild.hasViolation) kinds.add("violation");
      if (gchild.hasPin) kinds.add("pin");
      if (gchild.hasQuestion) kinds.add("question");
      if (gchild.hasProposal) kinds.add("proposal");
    }
  }

  return Array.from(kinds);
}

/**
 * Compute radial slices for Ring 1 and Ring 2 around a center focus node.
 * Applies sqrt-dampened angles and +N more folding for long tails.
 */
export function computeRadialLayout(
  focusNode: HierarchyNode,
  cx: number,
  cy: number,
  maxRadius: number
): {
  slices: RadialSlice[];
  centerHub: {
    label: string;
    fileCount: number;
    mappedCount: number;
    isCharted: boolean;
    radius: number;
  };
} {
  const centerRadius = maxRadius * 0.28;
  const ring1Inner = centerRadius + 8;
  const ring1Outer = maxRadius * 0.62;
  const ring2Inner = ring1Outer + 6;
  const ring2Outer = maxRadius;

  const rawChildren = [...focusNode.children];
  const maxSlicesRing1 = 8;

  let displayChildren = rawChildren;
  let foldedChildren: HierarchyNode[] = [];

  if (rawChildren.length > maxSlicesRing1) {
    // Keep top (maxSlicesRing1 - 1) largest, fold remainder
    const sorted = [...rawChildren].sort((a, b) => b.fileCount - a.fileCount);
    displayChildren = sorted.slice(0, maxSlicesRing1 - 1);
    foldedChildren = sorted.slice(maxSlicesRing1 - 1);

    const foldedFiles = foldedChildren.reduce((acc, c) => acc + c.fileCount, 0);
    const foldedMapped = foldedChildren.reduce((acc, c) => acc + c.mappedCount, 0);

    displayChildren.push({
      id: `folded:${focusNode.id}`,
      label: `+${foldedChildren.length} more`,
      kind: "folder",
      path: `${focusNode.path}/more`,
      isCharted: foldedMapped > 0,
      fileCount: foldedFiles,
      mappedCount: foldedMapped,
      depth: focusNode.depth + 1,
      parentId: focusNode.id,
      children: foldedChildren,
      hasViolation: foldedChildren.some((c) => c.hasViolation),
      hasPin: foldedChildren.some((c) => c.hasPin),
      hasQuestion: foldedChildren.some((c) => c.hasQuestion),
      hasProposal: foldedChildren.some((c) => c.hasProposal),
    });
  }

  // Angular calculation: angle proportional to sqrt(fileCount)
  const weights = displayChildren.map((c) => Math.max(1, Math.sqrt(c.fileCount)));
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;

  const slices: RadialSlice[] = [];
  let currentAngle = -Math.PI / 2; // Start from top 12 o'clock

  for (let i = 0; i < displayChildren.length; i++) {
    const child = displayChildren[i];
    const weight = weights[i];
    const sliceAngle = (weight / totalWeight) * (Math.PI * 2);
    const startAngle = currentAngle;
    const endAngle = currentAngle + sliceAngle;
    currentAngle = endAngle;

    const ring1Slice: RadialSlice = {
      id: child.id,
      label: child.label,
      kind: child.kind,
      path: child.path,
      ring: 1,
      isCharted: child.isCharted,
      fileCount: child.fileCount,
      mappedCount: child.mappedCount,
      startAngle,
      endAngle,
      innerRadius: ring1Inner,
      outerRadius: ring1Outer,
      hasViolation: child.hasViolation,
      hasPin: child.hasPin,
      hasQuestion: child.hasQuestion,
      hasProposal: child.hasProposal,
      node: child,
    };
    slices.push(ring1Slice);

    // Now compute Ring 2 slices for grandchildren
    const grandchildren = child.children || [];
    if (grandchildren.length > 0) {
      const maxG = 6;
      let displayG = grandchildren;
      if (grandchildren.length > maxG) {
        const sortedG = [...grandchildren].sort((a, b) => b.fileCount - a.fileCount);
        displayG = sortedG.slice(0, maxG - 1);
        const remG = sortedG.slice(maxG - 1);
        displayG.push({
          id: `folded:${child.id}`,
          label: `+${remG.length}`,
          kind: "folder",
          path: `${child.path}/more`,
          isCharted: remG.some((g) => g.isCharted),
          fileCount: remG.reduce((a, b) => a + b.fileCount, 0),
          mappedCount: remG.reduce((a, b) => a + b.mappedCount, 0),
          depth: child.depth + 1,
          parentId: child.id,
          children: remG,
          hasViolation: remG.some((g) => g.hasViolation),
          hasPin: remG.some((g) => g.hasPin),
          hasQuestion: remG.some((g) => g.hasQuestion),
          hasProposal: remG.some((g) => g.hasProposal),
        });
      }

      const gWeights = displayG.map((g) => Math.max(1, Math.sqrt(g.fileCount)));
      const totalGWeight = gWeights.reduce((a, b) => a + b, 0) || 1;
      let gCurrentAngle = startAngle;

      for (let j = 0; j < displayG.length; j++) {
        const g = displayG[j];
        const gWeight = gWeights[j];
        const gSliceAngle = (gWeight / totalGWeight) * (endAngle - startAngle);
        const gStart = gCurrentAngle;
        const gEnd = gCurrentAngle + gSliceAngle;
        gCurrentAngle = gEnd;

        slices.push({
          id: g.id,
          label: g.label,
          kind: g.kind,
          path: g.path,
          ring: 2,
          isCharted: g.isCharted,
          fileCount: g.fileCount,
          mappedCount: g.mappedCount,
          startAngle: gStart,
          endAngle: gEnd,
          innerRadius: ring2Inner,
          outerRadius: ring2Outer,
          hasViolation: g.hasViolation,
          hasPin: g.hasPin,
          hasQuestion: g.hasQuestion,
          hasProposal: g.hasProposal,
          parentSliceId: child.id,
          node: g,
        });
      }
    }
  }

  return {
    slices,
    centerHub: {
      label: focusNode.label,
      fileCount: focusNode.fileCount,
      mappedCount: focusNode.mappedCount,
      isCharted: focusNode.isCharted,
      radius: centerRadius,
    },
  };
}

/**
 * Generate SVG arc path d-attribute between r1, r2 and a1, a2.
 */
export function describeArc(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number
): string {
  // Cap slice angle slightly to prevent full-circle overlap glitches
  const angleDelta = endAngle - startAngle;
  const largeArcFlag = angleDelta > Math.PI ? 1 : 0;

  // Inner start and end
  const x1 = cx + outerRadius * Math.cos(startAngle);
  const y1 = cy + outerRadius * Math.sin(startAngle);
  const x2 = cx + outerRadius * Math.cos(endAngle);
  const y2 = cy + outerRadius * Math.sin(endAngle);

  const x3 = cx + innerRadius * Math.cos(endAngle);
  const y3 = cy + innerRadius * Math.sin(endAngle);
  const x4 = cx + innerRadius * Math.cos(startAngle);
  const y4 = cy + innerRadius * Math.sin(startAngle);

  return [
    `M ${x1} ${y1}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${x4} ${y4}`,
    `Z`,
  ].join(" ");
}

/**
 * Helper to build an organic rounded concave/L-shaped dashed hull path.
 */
export function generateOrganicHull(x: number, y: number, w: number, h: number, seed = 0): string {
  const r = 18;
  // Create slightly organic offsets at the corners
  const o1 = (seed % 5) - 2;
  const o2 = ((seed * 3) % 5) - 2;

  return [
    `M ${x + r} ${y}`,
    `H ${x + w - r + o1}`,
    `Q ${x + w + o1} ${y} ${x + w + o1} ${y + r}`,
    `V ${y + h - r + o2}`,
    `Q ${x + w + o1} ${y + h + o2} ${x + w - r + o1} ${y + h + o2}`,
    `H ${x + r}`,
    `Q ${x} ${y + h + o2} ${x} ${y + h - r + o2}`,
    `V ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `Z`,
  ].join(" ");
}

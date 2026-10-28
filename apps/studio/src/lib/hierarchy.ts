// apps/studio/src/lib/hierarchy.ts
// Indefinite-depth hierarchy builder, canonical path keys, honest blueprint link status, and directed edge graph.

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

export type NodeState = "mapped" | "inferred" | "unmapped" | "legacy";

export interface DirectedEdge {
  a: string; // consumer key (depends on b)
  b: string; // dependency key (used by a)
  birth: number;
  death: number | null;
  bad: boolean;
  count?: number;
  status?: string;
  bridge?: any;
}

export interface SelectedEntity {
  id: string;
  key?: string;
  kind: EntityKind;
  label: string;
  path: string;
  status: "mapped" | "uncharted" | "proposed" | "violation" | "pinned" | "question";
  state?: NodeState;
  fileCount?: number;
  mappedCount?: number;
  description?: string;
  purpose?: string;
  parentId?: string | null;
  partOf?: string;
  raw?: any;
  node?: HierarchyNode;
  edgeData?: DirectedEdge;
  violationMessage?: string;
  pinStatement?: string;
  questionText?: string;
}

export interface HierarchyNode {
  id: string;
  key: string; // Canonical "/" separated path from domain to node (e.g. "Backend/events/models")
  label: string;
  kind: EntityKind;
  path: string; // Lowercase display path (e.g. "backend/events/models")
  breadcrumbLabels: string[]; // ["Backend", "events", "models"]
  state: NodeState;
  isCharted: boolean;
  fileCount: number;
  mappedCount: number;
  weight: number; // Math.max(8, fileCount) ** 0.8
  depth: number;
  parentId: string | null;
  children: HierarchyNode[];
  filesList: string[];
  hasViolation: boolean;
  hasPin: boolean;
  hasQuestion: boolean;
  hasProposal: boolean;
  pinCount: number;
  violationCount: number;
  proposalCount: number;
  icon?: string;
  tier?: number;
  birth: number;
  constraints: string[];
  decisions: [string, string][];
  mustNotDependOn: string[];
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
  ring: 1 | 2;
  isCharted: boolean;
  fileCount: number;
  mappedCount: number;
  startAngle: number;
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
  hullPath: string;
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
 * Deterministic hash & PRNG matching AFWE Codebase Atlas
 */
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function seededRand(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Normalize an AFWE `Attachment` object (`{ nodes, files, symbols, global }`) or legacy string array into a flat string array.
 */
export function extractAttachmentItems(att: any): string[] {
  if (!att) return [];
  if (Array.isArray(att)) return att;
  if (typeof att === "object") {
    const out: string[] = [];
    if (Array.isArray(att.nodes)) out.push(...att.nodes);
    if (Array.isArray(att.files)) out.push(...att.files);
    if (Array.isArray(att.symbols)) out.push(...att.symbols);
    if (att.global && out.length === 0) out.push("Global");
    return out;
  }
  return [];
}

/**
 * Format an `Attachment` object or array into a human-readable comma-separated string.
 */
export function formatAttachment(att: any): string {
  const items = extractAttachmentItems(att);
  return items.length > 0 ? items.join(", ") : "Global";
}

const DEFAULT_DOMAIN_ICONS: Record<string, string> = {
  web: "web",
  mobile: "phone",
  services: "gear",
  backend: "srv",
  core: "layers",
  data: "db",
  shared: "link",
  infrastructure: "cloud",
  identity: "srv",
  workspace: "layers",
  billing: "gear",
  realtime: "link",
  platform: "cloud",
};

const DEFAULT_DOMAIN_TIERS: Record<string, number> = {
  web: 0,
  mobile: 0,
  services: 1,
  backend: 1,
  core: 2,
  data: 2,
  shared: 3,
  infrastructure: 3,
};

/**
 * Check if a mapped node has genuine linked constraints or decisions in the blueprint.
 */
export function hasBlueprintLinks(node: HierarchyNode | null | undefined): boolean {
  if (!node) return false;
  if (node.state !== "mapped") return false;
  return (node.constraints && node.constraints.length > 0) || (node.decisions && node.decisions.length > 0);
}

/**
 * Return honest state description matching AFWE Codebase Atlas.
 */
export function stateDescription(state: NodeState, node?: HierarchyNode | null): string {
  if (state === "mapped") {
    return hasBlueprintLinks(node)
      ? "Mapped to the blueprint. Applicable constraints and decisions are linked."
      : "Mapped to the blueprint.";
  }
  if (state === "inferred") return "Structure guessed from the code, not confirmed yet.";
  if (state === "unmapped") return "Not charted yet. AFWE has not read this area.";
  return "Older code kept for reference.";
}

/**
 * Format a key like "Backend/events/models" as "Backend›models"
 */
export function shortLabel(key: string): string {
  const parts = key.split("/");
  return parts.length > 1 ? `${parts[0]}›${parts[parts.length - 1]}` : key;
}

/**
 * Find the top-level domain (depth 1) for any node in the hierarchy tree.
 */
export function getDomainNode(root: HierarchyNode, node: HierarchyNode): HierarchyNode {
  if (node.depth <= 1) return node;
  const topKey = node.key.split("/")[0];
  return root.children.find((c) => c.key === topKey || c.id === topKey || c.label === topKey) || node;
}

/**
 * Build the multi-layer hierarchy tree from graph snapshot.
 */
export function buildHierarchyTree(graph: any): HierarchyNode {
  if (!graph) {
    return {
      id: "root",
      key: "root",
      label: "Codebase",
      kind: "project",
      path: "",
      breadcrumbLabels: [],
      state: "mapped",
      isCharted: false,
      fileCount: 0,
      mappedCount: 0,
      weight: 8,
      depth: 0,
      parentId: null,
      children: [],
      filesList: [],
      hasViolation: false,
      hasPin: false,
      hasQuestion: false,
      hasProposal: false,
      pinCount: 0,
      violationCount: 0,
      proposalCount: 0,
      birth: 0,
      constraints: [],
      decisions: [],
      mustNotDependOn: [],
    };
  }

  const nodes: any[] = graph.nodes || [];
  const files: any[] = graph.files || [];
  const unmapped: string[] = graph.unmapped || [];
  const pins: any[] = graph.pins || [];
  const calibration = graph.calibration || { guides: [], questions: [] };
  const proposals: any[] = graph.proposals || [];
  const codeEdges: any[] = graph.code_edges || [];
  const constraints: any[] = graph.constraints || [];
  const memoryObj: Record<string, any> = graph.memory || {};

  // Index constraints by node id/key
  const constraintsByNode = new Map<string, string[]>();
  const mustNotByNode = new Map<string, string[]>();
  for (const c of constraints) {
    if (!c.from) continue;
    const text = c.rationale || c.description || `${c.from} must not depend on ${(c.to || []).join(", ")}.`;
    if (!constraintsByNode.has(c.from)) constraintsByNode.set(c.from, []);
    constraintsByNode.get(c.from)!.push(text);
    if (c.rule === "must_not_depend" && Array.isArray(c.to)) {
      if (!mustNotByNode.has(c.from)) mustNotByNode.set(c.from, []);
      for (const target of c.to) {
        if (!mustNotByNode.get(c.from)!.includes(target)) {
          mustNotByNode.get(c.from)!.push(target);
        }
      }
    }
  }

  // Index memory decisions by node id/key
  const decisionsByNode = new Map<string, [string, string][]>();
  for (const [memId, mem] of Object.entries(memoryObj)) {
    if (!mem || mem.kind !== "decision") continue;
    const title = mem.title || memId;
    const dateLabel = "Accepted";
    for (const target of mem.nodes || []) {
      if (!decisionsByNode.has(target)) decisionsByNode.set(target, []);
      decisionsByNode.get(target)!.push([title, dateLabel]);
    }
  }

  // Violations by node - indexed across dot, slash, and ancestral segments
  const violationsByNode = new Map<string, string[]>();
  const addViolation = (nodeId: string, msg: string) => {
    if (!nodeId) return;
    const slashId = nodeId.replace(/\./g, "/");
    const dotId = nodeId.replace(/\//g, ".");
    for (const id of [nodeId, slashId, dotId]) {
      if (!violationsByNode.has(id)) violationsByNode.set(id, []);
      if (!violationsByNode.get(id)!.includes(msg)) {
        violationsByNode.get(id)!.push(msg);
      }
    }
    // Also bubble up violation messages to parent modules and domain ancestors
    const parts = slashId.split("/");
    for (let i = 1; i < parts.length; i++) {
      const ancSlash = parts.slice(0, i).join("/");
      const ancDot = parts.slice(0, i).join(".");
      for (const id of [ancSlash, ancDot]) {
        if (!violationsByNode.has(id)) violationsByNode.set(id, []);
        if (!violationsByNode.get(id)!.includes(msg)) {
          violationsByNode.get(id)!.push(msg);
        }
      }
    }
  };

  for (const ce of codeEdges) {
    if (ce.violation) {
      const msg = `${ce.from} depends on ${ce.to}, which is forbidden.`;
      addViolation(ce.from, msg);
    }
  }
  // Also check declared relations against must_not_depend constraints
  for (const rel of graph.relations || []) {
    const forbiddenTargets = mustNotByNode.get(rel.from) || [];
    if (forbiddenTargets.includes(rel.to)) {
      const msg = `${rel.from} depends on ${rel.to}, which is forbidden.`;
      addViolation(rel.from, msg);
    }
  }

  // Pins by node
  const pinsByNode = new Map<string, string[]>();
  for (const pin of pins) {
    if (pin.status === "active" && pin.attaches) {
      for (const att of extractAttachmentItems(pin.attaches)) {
        if (!pinsByNode.has(att)) pinsByNode.set(att, []);
        pinsByNode.get(att)!.push(pin.statement || pin.id);
      }
    }
  }

  // Questions by node
  const questionsByNode = new Map<string, string[]>();
  for (const q of calibration.questions || []) {
    if (q.status === "open" && q.attaches) {
      for (const att of extractAttachmentItems(q.attaches)) {
        if (!questionsByNode.has(att)) questionsByNode.set(att, []);
        questionsByNode.get(att)!.push(q.question || q.id);
      }
    }
  }

  // Pending proposals by node
  const proposalsByNode = new Set<string>();
  for (const prop of proposals) {
    if (prop.status === "pending" || !prop.status) {
      const pNodes = prop.finding?.nodes || [];
      for (const pn of pNodes) proposalsByNode.add(pn);
      if (prop.finding?.change?.parent && prop.finding?.change?.name) {
        proposalsByNode.add(`${prop.finding.change.parent}/${prop.finding.change.name}`);
      }
    }
  }

  const nodeMap = new Map<string, any>();
  for (const n of nodes) {
    nodeMap.set(n.id, n);
  }

  // 1. Find top-level blueprint nodes; unwrap single product/project root wrapper if present
  let topBlueprintNodes = nodes.filter((n: any) => !n.parent || !nodeMap.has(n.parent));
  if (
    topBlueprintNodes.length === 1 &&
    (topBlueprintNodes[0].kind === "product" || topBlueprintNodes[0].kind === "project")
  ) {
    const wrapperId = topBlueprintNodes[0].id;
    const unwrapped = nodes.filter((n: any) => n.parent === wrapperId);
    if (unwrapped.length > 0) {
      topBlueprintNodes = unwrapped;
    }
  }

  // Convert blueprint node recursively
  function convertBlueprintNode(
    bn: any,
    depth: number,
    parentKey: string | null,
    parentBreadcrumbs: string[],
    parentBirth: number
  ): HierarchyNode {
    const label = bn.name || bn.id.split("/").pop() || bn.id;
    const key = parentKey ? `${parentKey}/${label}` : label;
    const breadcrumbs = [...parentBreadcrumbs, label];
    const displayPath = breadcrumbs.join("/").toLowerCase();

    // Determine state accurately without conflating violations with legacy
    const rawStatus = (bn.status || "active").toLowerCase();
    const rawOrigin = (bn.origin || "").toLowerCase();
    let state: NodeState = "mapped";
    if (rawStatus === "unmapped") {
      state = "unmapped";
    } else if (rawStatus === "legacy" || rawStatus === "deprecated") {
      state = "legacy";
    } else if (rawStatus === "inferred" || rawOrigin.includes("inferred")) {
      state = "inferred";
    }

    const r = seededRand(hashStr(key));
    const birth = depth === 1 ? 0 : Math.min(0.92, parentBirth + r() * 0.18);

    const childBpNodes = nodes.filter((child: any) => child.parent === bn.id);
    const mappedChildren = childBpNodes.map((child: any) =>
      convertBlueprintNode(child, depth + 1, key, breadcrumbs, birth)
    );

    const ownFilesCount = typeof bn.files === "number" ? bn.files : (bn.file_list || []).length;
    const childrenFilesSum = mappedChildren.reduce((acc, c) => acc + c.fileCount, 0);
    const fileCount = Math.max(1, ownFilesCount, childrenFilesSum);

    const mappedCount =
      state === "unmapped"
        ? 0
        : mappedChildren.length > 0
        ? mappedChildren.reduce((acc, c) => acc + c.mappedCount, 0)
        : fileCount;

    const slashId = bn.id.replace(/\./g, "/");
    const dotId = bn.id.replace(/\//g, ".");
    const slashKey = key.replace(/\./g, "/");
    const dotKey = key.replace(/\//g, ".");
    const directViolations = [
      ...(violationsByNode.get(bn.id) || []),
      ...(violationsByNode.get(key) || []),
      ...(violationsByNode.get(slashId) || []),
      ...(violationsByNode.get(dotId) || []),
      ...(violationsByNode.get(slashKey) || []),
      ...(violationsByNode.get(dotKey) || []),
    ];
    const vList = Array.from(new Set(directViolations));
    const childHasViolation = mappedChildren.some((c) => c.hasViolation);
    const childViolationCount = mappedChildren.reduce((acc, c) => acc + c.violationCount, 0);
    const totalViolationCount = vList.length + childViolationCount;
    const nodeHasViolation = vList.length > 0 || childHasViolation;

    const pList = pinsByNode.get(bn.id) || pinsByNode.get(key) || [];
    const qList = questionsByNode.get(bn.id) || questionsByNode.get(key) || [];
    const hasProp = proposalsByNode.has(bn.id) || proposalsByNode.has(key);

    // Extract icon and tier from tags or domain name
    const tags: string[] = bn.tags || [];
    const iconTag = tags.find((t) => t.startsWith("icon:"))?.slice(5);
    const tierTag = tags.find((t) => t.startsWith("tier:"))?.slice(5);
    const icon = iconTag || (depth === 1 ? DEFAULT_DOMAIN_ICONS[label.toLowerCase()] : undefined);
    const tier =
      tierTag !== undefined
        ? Number(tierTag)
        : depth === 1
        ? DEFAULT_DOMAIN_TIERS[label.toLowerCase()] ?? 1
        : undefined;

    const nodeConstraints = [
      ...(constraintsByNode.get(bn.id) || []),
      ...(bn.id !== key ? constraintsByNode.get(key) || [] : []),
    ];
    const nodeDecisions = [
      ...(decisionsByNode.get(bn.id) || []),
      ...(bn.id !== key ? decisionsByNode.get(key) || [] : []),
    ];
    const mustNot = [
      ...(mustNotByNode.get(bn.id) || []),
      ...(bn.id !== key ? mustNotByNode.get(key) || [] : []),
    ];

    const isDomain = depth === 1 || bn.kind === "domain";

    return {
      id: bn.id,
      key,
      label,
      kind: isDomain ? "domain" : "feature",
      path: displayPath,
      breadcrumbLabels: breadcrumbs,
      state,
      isCharted: state !== "unmapped",
      fileCount,
      mappedCount,
      weight: Math.pow(Math.max(8, fileCount), 0.8),
      depth,
      parentId: depth === 1 ? "root" : bn.parent || parentKey,
      children: mappedChildren,
      filesList: bn.file_list || [],
      hasViolation: nodeHasViolation,
      hasPin: pList.length > 0,
      hasQuestion: qList.length > 0,
      hasProposal: hasProp,
      pinCount: pList.length,
      violationCount: totalViolationCount,
      proposalCount: hasProp ? 1 : 0,
      icon,
      tier,
      birth,
      constraints: nodeConstraints,
      decisions: nodeDecisions,
      mustNotDependOn: mustNot,
      violationDetails: vList,
      pinDetails: pList,
      questionDetails: qList,
      raw: bn,
    };
  }

  const topNodes: HierarchyNode[] = topBlueprintNodes.map((bn: any) =>
    convertBlueprintNode(bn, 1, null, [], 0)
  );

  // If there are any unmapped files in graph.unmapped that don't belong to an existing domain, attach them cleanly
  if (unmapped.length > 0) {
    const unmappedByTop = new Map<string, string[]>();
    for (const f of unmapped) {
      const clean = f.replace(/^src\//, "");
      const parts = clean.split("/");
      const topFolder = parts.length > 1 ? parts[0] : "unmapped";
      // Check if topNodes already has this domain
      if (topNodes.some((tn) => tn.label.toLowerCase() === topFolder.toLowerCase())) {
        continue;
      }
      if (!unmappedByTop.has(topFolder)) unmappedByTop.set(topFolder, []);
      unmappedByTop.get(topFolder)!.push(f);
    }
    for (const [folderName, folderFiles] of unmappedByTop.entries()) {
      const fc = folderFiles.length;
      topNodes.push({
        id: folderName,
        key: folderName,
        label: folderName,
        kind: "folder",
        path: folderName.toLowerCase(),
        breadcrumbLabels: [folderName],
        state: "unmapped",
        isCharted: false,
        fileCount: fc,
        mappedCount: 0,
        weight: Math.pow(Math.max(8, fc), 0.8),
        depth: 1,
        parentId: "root",
        children: [],
        filesList: folderFiles,
        hasViolation: false,
        hasPin: false,
        hasQuestion: false,
        hasProposal: false,
        pinCount: 0,
        violationCount: 0,
        proposalCount: 0,
        birth: 0.2,
        constraints: [],
        decisions: [],
        mustNotDependOn: [],
      });
    }
  }

  const totalFiles = topNodes.reduce((acc, n) => acc + n.fileCount, 0) || files.length;
  const totalMapped = topNodes.reduce((acc, n) => acc + n.mappedCount, 0);

  return {
    id: "root",
    key: "root",
    label: graph.project?.name || "Acme App",
    kind: "project",
    path: "",
    breadcrumbLabels: [],
    state: "mapped",
    isCharted: totalMapped > 0,
    fileCount: totalFiles,
    mappedCount: totalMapped,
    weight: Math.pow(Math.max(8, totalFiles), 0.8),
    depth: 0,
    parentId: null,
    children: topNodes,
    filesList: [],
    hasViolation: violationsByNode.size > 0,
    hasPin: pinsByNode.size > 0,
    hasQuestion: questionsByNode.size > 0,
    hasProposal: proposalsByNode.size > 0,
    pinCount: pinsByNode.size,
    violationCount: violationsByNode.size,
    proposalCount: proposalsByNode.size,
    birth: 0,
    constraints: [],
    decisions: [],
    mustNotDependOn: [],
    raw: graph,
  };
}

/**
 * Flatten all nodes in the hierarchy tree into a lookup map by id and key.
 */
export function indexHierarchyNodes(root: HierarchyNode): Map<string, HierarchyNode> {
  const map = new Map<string, HierarchyNode>();
  const walk = (n: HierarchyNode) => {
    map.set(n.id, n);
    map.set(n.key, n);
    map.set(n.path, n);
    for (const c of n.children) walk(c);
  };
  walk(root);
  return map;
}

/**
 * Find a node in the hierarchy tree by ID, canonical key, or path.
 */
export function findNodeById(root: HierarchyNode, idOrKey: string | null | undefined): HierarchyNode | null {
  if (!idOrKey) return null;
  if (root.id === idOrKey || root.key === idOrKey) return root;
  const lower = idOrKey.toLowerCase();
  const walk = (n: HierarchyNode): HierarchyNode | null => {
    if (n.id === idOrKey || n.key === idOrKey || n.path === lower || n.key.toLowerCase() === lower) {
      return n;
    }
    for (const child of n.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(root);
}

/**
 * Compute rolled-up badge counts (pins, violations, proposals, unmapped files) for a node key.
 */
export function computeNodeFlags(node: HierarchyNode | null | undefined): {
  pin: number;
  viol: number;
  prop: number;
  unm: number;
} {
  if (!node) return { pin: 0, viol: 0, prop: 0, unm: 0 };
  const f = {
    pin: node.hasPin ? 1 : 0,
    viol: node.hasViolation ? 1 : 0,
    prop: node.hasProposal ? 1 : 0,
    unm: node.state === "unmapped" ? node.fileCount : 0,
  };
  const walk = (n: HierarchyNode, d: number) => {
    for (const k of n.children || []) {
      if (k.hasPin) f.pin++;
      if (k.hasViolation) f.viol++;
      if (k.hasProposal) f.prop++;
      if (k.state === "unmapped") f.unm += k.fileCount;
      if (d + 1 < 4) walk(k, d + 1);
    }
  };
  if (node.depth <= 2) walk(node, node.depth);
  return f;
}

/**
 * Build unified domain-level and node-level directed edges from the graph.
 */
export function buildDirectedEdges(
  graph: any,
  root: HierarchyNode
): {
  domainEdges: DirectedEdge[];
  nodeEdges: DirectedEdge[];
} {
  if (!graph) return { domainEdges: [], nodeEdges: [] };
  const nodeMap = indexHierarchyNodes(root);
  const constraints: any[] = graph.constraints || [];

  const isForbiddenPair = (fromKey: string, toKey: string): boolean => {
    const fSlash = fromKey.replace(/\./g, "/");
    const tSlash = toKey.replace(/\./g, "/");
    const fromDom = fSlash.split("/")[0];
    const toDom = tSlash.split("/")[0];
    for (const c of constraints) {
      if (c.rule !== "must_not_depend") continue;
      const cFrom = (c.from || "").replace(/\./g, "/");
      const cFromDom = cFrom.split("/")[0];
      const targets: string[] = (c.to || []).map((t: string) => t.replace(/\./g, "/"));
      const targetDoms = targets.map((t: string) => t.split("/")[0]);

      if (
        (cFrom === fSlash || cFrom === fromDom || cFromDom === fromDom) &&
        (targets.includes(tSlash) || targets.includes(toDom) || targetDoms.includes(toDom))
      ) {
        return true;
      }
    }
    return false;
  };

  const domainEdgeMap = new Map<string, DirectedEdge>();
  const nodeEdgeMap = new Map<string, DirectedEdge>();

  const extractDomainKey = (raw: string): string => {
    const norm = raw.replace(/\./g, "/");
    const seg = norm.split("/")[0];
    const n = nodeMap.get(raw) || nodeMap.get(norm) || nodeMap.get(seg);
    if (n) {
      let cur: HierarchyNode = n;
      while (cur.depth > 1 && cur.parentId && cur.parentId !== "root") {
        const p = nodeMap.get(cur.parentId);
        if (p) cur = p;
        else break;
      }
      return cur.key.replace(/\./g, "/").split("/")[0];
    }
    return seg;
  };

  const registerEdge = (rawFrom: string, rawTo: string, badFlag: boolean, count = 1, status = "declared") => {
    const nFrom = nodeMap.get(rawFrom) || nodeMap.get(rawFrom.replace(/\./g, "/"));
    const nTo = nodeMap.get(rawTo) || nodeMap.get(rawTo.replace(/\./g, "/"));
    const fromKey = nFrom ? nFrom.key : rawFrom;
    const toKey = nTo ? nTo.key : rawTo;
    if (!fromKey || !toKey || fromKey === toKey) return;

    const bad = badFlag || isForbiddenPair(fromKey, toKey) || isForbiddenPair(rawFrom, rawTo);
    const h = hashStr(`${fromKey}>${toKey}`);
    const birth = 0.03 + (h % 280) / 1000;

    const fromDepth = nFrom ? nFrom.depth : fromKey.replace(/\./g, "/").split("/").length;
    const toDepth = nTo ? nTo.depth : toKey.replace(/\./g, "/").split("/").length;

    if (fromDepth === 1 && toDepth === 1) {
      const k = `${fromKey}>${toKey}`;
      const existing = domainEdgeMap.get(k);
      if (existing) {
        existing.bad = existing.bad || bad;
        existing.count = (existing.count || 1) + count;
      } else {
        domainEdgeMap.set(k, { a: fromKey, b: toKey, birth, death: null, bad, count, status });
      }
    } else {
      const k = `${fromKey}>${toKey}`;
      const existing = nodeEdgeMap.get(k);
      if (existing) {
        existing.bad = existing.bad || bad;
        existing.count = (existing.count || 1) + count;
      } else {
        nodeEdgeMap.set(k, { a: fromKey, b: toKey, birth, death: null, bad, count, status });
      }
      // Also ensure the parent domains have a rolled-up domain edge
      const domA = extractDomainKey(fromKey);
      const domB = extractDomainKey(toKey);
      if (domA && domB && domA !== domB) {
        const dk = `${domA}>${domB}`;
        const existing = domainEdgeMap.get(dk);
        const domBad = bad || isForbiddenPair(domA, domB);
        if (existing) {
          existing.bad = existing.bad || domBad;
          existing.count = (existing.count || 0) + count;
        } else {
          const dh = hashStr(dk);
          domainEdgeMap.set(dk, {
            a: domA,
            b: domB,
            birth: 0.02 + (dh % 300) / 1000,
            death: null,
            bad: domBad,
            count,
            status,
          });
        }
      }
    }
  };

  for (const rel of graph.relations || []) {
    registerEdge(rel.from, rel.to, false, rel.evidence || 1, rel.status || "declared");
  }
  for (const ce of graph.code_edges || []) {
    registerEdge(ce.from, ce.to, Boolean(ce.violation), ce.count || 1, ce.declared ? "declared" : "inferred");
  }

  return {
    domainEdges: Array.from(domainEdgeMap.values()),
    nodeEdges: Array.from(nodeEdgeMap.values()),
  };
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

  const displayChildren = [...focusNode.children];
  const weights = displayChildren.map((c) => c.weight || Math.pow(Math.max(8, c.fileCount), 0.8));
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;

  const slices: RadialSlice[] = [];
  let currentAngle = 0;

  for (let i = 0; i < displayChildren.length; i++) {
    const child = displayChildren[i];
    const weight = weights[i];
    const sliceAngle = (weight / totalWeight) * (Math.PI * 2);
    const startAngle = currentAngle;
    const endAngle = currentAngle + sliceAngle;
    currentAngle = endAngle;

    slices.push({
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
    });

    const grandchildren = child.children || [];
    if (grandchildren.length > 0) {
      const gWeights = grandchildren.map((g) => g.weight || Math.pow(Math.max(8, g.fileCount), 0.8));
      const totalGWeight = gWeights.reduce((a, b) => a + b, 0) || 1;
      let gCurrentAngle = startAngle;

      for (let j = 0; j < grandchildren.length; j++) {
        const g = grandchildren[j];
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
  const angleDelta = endAngle - startAngle;
  const largeArcFlag = angleDelta > Math.PI ? 1 : 0;

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

export function generateOrganicHull(x: number, y: number, w: number, h: number, seed = 0): string {
  return generateOrganicClusterHull(x, y, w, h, 4, seed, "box");
}

export function generateOrganicClusterHull(
  x: number,
  y: number,
  w: number,
  h: number,
  cardCount = 4,
  seed = 0,
  shapeType: "box" | "l-shape" | "capsule" | "amoeba" = "box"
): string {
  const pad = 12;
  const s = seed;
  const jitter = (idx: number, amp = 6) => Math.sin(s * 3.7 + idx * 2.3) * amp;

  if (shapeType === "amoeba") {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const rx = w / 2 + pad;
    const ry = h / 2 + pad;
    const points: [number, number][] = [];
    const steps = 12;
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      const rMod = 1 + Math.sin(angle * 3 + s) * 0.08 + Math.cos(angle * 2) * 0.04;
      const px = cx + Math.cos(angle) * rx * rMod;
      const py = cy + Math.sin(angle) * ry * rMod;
      points.push([px, py]);
    }
    return smoothSplineClosed(points);
  }

  if (shapeType === "l-shape" || (cardCount >= 5 && shapeType !== "capsule")) {
    const midX = x + w * 0.62 + jitter(1, 8);
    const midY = y + h * 0.54 + jitter(2, 6);

    const pts: [number, number][] = [
      [x + 18, y + jitter(0, 4)],
      [x + w - 18, y + jitter(1, 4)],
      [x + w + jitter(2, 5), y + 20],
      [x + w + jitter(3, 4), midY],
      [midX + 24, midY + jitter(4, 4)],
      [midX + 16, y + h - 18],
      [midX - 10, y + h + jitter(5, 4)],
      [x + 18, y + h + jitter(6, 4)],
      [x - jitter(7, 5), y + h - 18],
      [x - jitter(8, 4), y + 18],
    ];
    return smoothSplineClosed(pts);
  }

  if (shapeType === "capsule" || cardCount <= 3) {
    const pts: [number, number][] = [
      [x + 22, y + jitter(0, 3)],
      [x + w - 22, y + jitter(1, 3)],
      [x + w + jitter(2, 4), y + h * 0.5],
      [x + w - 22, y + h + jitter(3, 3)],
      [x + 22, y + h + jitter(4, 3)],
      [x - jitter(5, 4), y + h * 0.5],
    ];
    return smoothSplineClosed(pts);
  }

  const pts: [number, number][] = [
    [x + 20, y + jitter(0, 3)],
    [x + w - 20, y + jitter(1, 3)],
    [x + w + jitter(2, 4), y + 22],
    [x + w + jitter(3, 4), y + h - 22],
    [x + w - 20, y + h + jitter(4, 3)],
    [x + 20, y + h + jitter(5, 3)],
    [x - jitter(6, 4), y + h - 22],
    [x - jitter(7, 4), y + 22],
  ];
  return smoothSplineClosed(pts);
}

function smoothSplineClosed(points: [number, number][]): string {
  if (points.length < 3) return "";
  const n = points.length;
  let d = `M ${points[0][0]} ${points[0][1]}`;

  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];

    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;

    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }

  d += " Z";
  return d;
}

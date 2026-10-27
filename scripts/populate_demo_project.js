const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function write(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
}

// ─────────────────────────────────────────────────────────────
// PART 1: examples/demo-project (Pulse SaaS Workspace)
// ─────────────────────────────────────────────────────────────
const demoRoot = path.resolve('examples/demo-project');
const demoAfwe = path.join(demoRoot, '.afwe');

// 1.1 Source Files: mapped L3/L4 files, unmapped folders, and 3 constraint violations
// L3/L4 files
write(path.join(demoRoot, 'src/auth/jwtSigner.ts'), `// jwt-signer component & token-entropy-guard widget
export interface TokenPayload {
  userId: string;
  orgId: string;
  scope: string[];
}

export function signJwtToken(payload: TokenPayload, secretKey: string): string {
  if (secretKey.length < 32) {
    throw new Error("token-entropy-guard: secret key entropy insufficient (< 32 bytes)");
  }
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return \`\${header}.\${body}.mock_signature\`;
}
`);

write(path.join(demoRoot, 'src/workspace/tagging/ColorWheel.ts'), `// tag-color-wheel component & tag-pill-renderer widget
export const TAG_PALETTE = ["#4338ca", "#059669", "#d97706", "#dc2626", "#7c3aed"];

export function getTagColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const index = Math.abs(hash) % TAG_PALETTE.length;
  return TAG_PALETTE[index];
}

export function renderTagPill(name: string): { label: string; bg: string } {
  return { label: name.toLowerCase().trim(), bg: getTagColor(name) };
}
`);

write(path.join(demoRoot, 'src/billing/proration.ts'), `// proration-calculator component & idempotency-key-hasher widget
export function calculateProration(daysRemaining: number, totalDays: number, planAmountCents: number): number {
  if (totalDays <= 0) return 0;
  return Math.round((daysRemaining / totalDays) * planAmountCents);
}

export function hashIdempotencyKey(key: string): string {
  return \`idemp_\${Buffer.from(key).toString("hex").slice(0, 16)}\`;
}
`);

// 4 Unmapped folders (with real code files)
write(path.join(demoRoot, 'src/notifications/mailer.ts'), `// UNCHARTED: notifications/mailer.ts
export interface EmailPayload {
  to: string;
  subject: string;
  body: string;
}

export async function sendTransactionalEmail(payload: EmailPayload): Promise<{ sent: boolean }> {
  console.log("Dispatching email to", payload.to);
  return { sent: true };
}
`);

write(path.join(demoRoot, 'src/experiments/aiSuggest.ts'), `// UNCHARTED: experiments/aiSuggest.ts
export function suggestWorkspaceTags(contentSnippet: string): string[] {
  const words = contentSnippet.toLowerCase().split(/\\W+/);
  return words.filter(w => w.length > 5).slice(0, 3);
}
`);

write(path.join(demoRoot, 'src/legacy-sync/xmlImporter.ts'), `// UNCHARTED: legacy-sync/xmlImporter.ts
export function parseLegacyXmlBatch(xmlRaw: string): Array<{ id: string; name: string }> {
  const matches = xmlRaw.match(/<item id="([^"]+)">([^<]+)<\\/item>/g) || [];
  return matches.map(m => ({ id: "legacy-1", name: "parsed" }));
}
`);

write(path.join(demoRoot, 'src/cli-tools/seedRunner.ts'), `// UNCHARTED: cli-tools/seedRunner.ts
export function seedWorkspaceDefaults(): void {
  console.log("Seeding default demo workspaces, users, and tags...");
}
`);

// 3 Constraint Violations in source code:
// Violation 1: src/workspace/library/Library.ts imports billing internals
write(path.join(demoRoot, 'src/workspace/library/Library.ts'), `import { Item, ItemId } from './Item';
import { Tag } from '../tagging/Tags';
// ARCHITECTURAL VIOLATION 1: Workspace must not depend on billing checkout internals!
import { StripeGateway } from '../../billing/stripe/StripeGateway';

export class Library {
  private items = new Map<ItemId, Item>();

  constructor(private stripeGateway?: StripeGateway) {}

  add(item: Item): void {
    this.items.set(item.id, item);
  }

  get(id: ItemId): Item | undefined {
    return this.items.get(id);
  }

  all(): Item[] {
    return Array.from(this.items.values());
  }

  tagItem(id: ItemId, tag: Tag): void {
    const item = this.items.get(id);
    if (!item) return;
    if (!item.tags.some(t => t.id === tag.id)) {
      item.tags.push(tag);
    }
  }
}
`);

// Violation 2: src/workspace/search/Search.ts imports raw db client
write(path.join(demoRoot, 'src/workspace/search/Search.ts'), `import { Item } from '../library/Item';
// ARCHITECTURAL VIOLATION 2: Search bypassing service layer with direct DB Client import!
import { DatabaseClient } from '../../db/client';

export class SearchIndex {
  private db = new DatabaseClient();

  search(items: Item[], query: string): Item[] {
    const q = query.toLowerCase().trim();
    if (!q) return items;
    return items.filter(item => {
      const matchTitle = item.title.toLowerCase().includes(q);
      const matchTag = item.tags.some(t => t.name.includes(q));
      return matchTitle || matchTag;
    });
  }

  directDbLookup(table: string): void {
    this.db.query(\`SELECT * FROM \${table}\`);
  }
}
`);

// Violation 3: src/billing/checkout/CheckoutController.ts imports internal session token generator
write(path.join(demoRoot, 'src/billing/checkout/CheckoutController.ts'), `import { StripeGateway } from '../stripe/StripeGateway';
import { InvoiceStore } from '../invoices/InvoiceStore';
// ARCHITECTURAL VIOLATION 3: Billing controller tight coupling with auth session generator!
import { SessionToken } from '../../auth/session';

export class CheckoutController {
  constructor(
    private stripe: StripeGateway,
    private invoices: InvoiceStore,
    private session: SessionToken
  ) {}

  async checkout(userId: string, planId: string, token: string): Promise<{ success: boolean; invoiceId: string }> {
    const charge = await this.stripe.charge(1000, token);
    const invoice = this.invoices.create(userId, 1000);
    return { success: charge.success, invoiceId: invoice.id };
  }
}
`);

// 1.2 Blueprint: 5 levels (L0..L4)
write(path.join(demoAfwe, 'blueprint/blueprint.yaml'), `nodes:
- id: demo-product
  name: Pulse SaaS Product
  kind: product
  purpose: Multi-tenant SaaS workspace platform with collaboration, billing, and real-time sync.
  status: active
  origin: human
  children:
  - id: identity
    name: Identity Subsystem
    kind: subsystem
    purpose: Authentication, session management, and role-based access control.
    status: active
    origin: human
    implements:
      files:
      - src/auth/**
    children:
    - id: auth-api
      name: Auth API
      kind: module
      purpose: Login, OAuth callbacks, and token refresh endpoints.
      status: active
      implements:
        files:
        - src/auth/api.ts
      children:
      - id: oauth-callback
        name: OAuth Callback
        kind: component
        purpose: Third-party identity provider response validation.
        status: active
      - id: jwt-signer
        name: JWT Signer
        kind: component
        purpose: Cryptographic token generation and signature verification.
        status: active
        implements:
          files:
          - src/auth/jwtSigner.ts
        children:
        - id: token-entropy-guard
          name: Token Entropy Guard
          kind: widget
          purpose: Enforces cryptographic salt minimum length and random seed requirements.
          status: active
    - id: session-token
      name: Session Token
      kind: module
      purpose: In-memory session tracking and expiry handling.
      status: active
      implements:
        files:
        - src/auth/session.ts
    - id: user-store
      name: User Store
      kind: module
      purpose: User profile persistence and credentials.
      status: active
      implements:
        files:
        - src/auth/users.ts

  - id: workspace
    name: Workspace Subsystem
    kind: subsystem
    purpose: Core productivity workspace, library items, search, and categorization.
    status: active
    origin: human
    implements:
      files:
      - src/workspace/**
    children:
    - id: workspace-library
      name: Workspace Library
      kind: module
      purpose: Document and folder tree persistence.
      status: active
      implements:
        files:
        - src/workspace/library/**
    - id: workspace-search
      name: Workspace Search
      kind: module
      purpose: In-memory inverted index for fast keyword matching.
      status: active
      implements:
        files:
        - src/workspace/search/**
    - id: workspace-tagging
      name: Workspace Tagging
      kind: module
      purpose: Flat tags and colored badges for item categorization.
      status: active
      implements:
        files:
        - src/workspace/tagging/**
      children:
      - id: tag-normaliser
        name: Tag Normaliser
        kind: component
        purpose: Case-folding and special character stripping for tag slugs.
        status: active
      - id: tag-color-wheel
        name: Tag Color Wheel
        kind: component
        purpose: Deterministic hash-based hex color generator for tag badges.
        status: active
        implements:
          files:
          - src/workspace/tagging/ColorWheel.ts
        children:
        - id: tag-pill-renderer
          name: Tag Pill Renderer
          kind: widget
          purpose: Visual DOM pill badge formatting with contrast calculation.
          status: active
    - id: workspace-bulk-export
      name: Workspace Bulk Export
      kind: module
      purpose: Zip archive creation for full workspace export.
      status: active

  - id: billing
    name: Billing Subsystem
    kind: subsystem
    purpose: Subscription management, Stripe integration, invoices, and proration.
    status: active
    origin: human
    implements:
      files:
      - src/billing/**
    children:
    - id: billing-plans
      name: Billing Plans
      kind: module
      purpose: Pricing tiers and feature flag entitlement rules.
      status: active
      implements:
        files:
        - src/billing/plans/**
    - id: billing-checkout
      name: Billing Checkout
      kind: module
      purpose: Checkout controller and payment intent workflows.
      status: active
      implements:
        files:
        - src/billing/checkout/**
    - id: stripe-gateway
      name: Stripe Gateway
      kind: module
      purpose: Direct Stripe API interaction for customer cards and subscriptions.
      status: active
      implements:
        files:
        - src/billing/stripe/**
      children:
      - id: stripe-webhook-verifier
        name: Stripe Webhook Verifier
        kind: component
        purpose: HMAC SHA256 webhook payload integrity verification.
        status: active
      - id: proration-calculator
        name: Proration Calculator
        kind: component
        purpose: Mid-cycle seat upgrade credit and debit arithmetic.
        status: active
        implements:
          files:
          - src/billing/proration.ts
        children:
        - id: idempotency-key-hasher
          name: Idempotency Key Hasher
          kind: widget
          purpose: Unique transaction key hashing to avoid double charges.
          status: active
    - id: invoice-store
      name: Invoice Store
      kind: module
      purpose: Historical invoice and PDF generation metadata.
      status: active
      implements:
        files:
        - src/billing/invoices/**
    - id: invoice-pdf-watermark
      name: Invoice PDF Watermark
      kind: module
      purpose: Enterprise compliance watermark stamping on generated PDF receipts.
      status: active

  - id: realtime
    name: Realtime Subsystem
    kind: subsystem
    purpose: Presence broadcast and background status monitoring workers.
    status: active
    origin: human
    implements:
      files:
      - src/realtime/**
    children:
    - id: realtime-presence
      name: Realtime Presence
      kind: module
      purpose: WebSocket heartbeats for connected team members.
      status: active
      implements:
        files:
        - src/realtime/presence.ts
    - id: realtime-status-worker
      name: Realtime Status Worker
      kind: module
      purpose: Background heartbeat consumer checking cluster health.
      status: active
      implements:
        files:
        - src/realtime/worker.ts
    - id: legacy-webhook-retry
      name: Legacy Webhook Retry
      kind: module
      purpose: Exponential backoff dispatcher for third-party webhook sinks.
      status: active

  - id: platform
    name: Platform Infrastructure
    kind: subsystem
    purpose: Foundational database client, pub/sub event bus, and HTTP server.
    status: active
    origin: human
    implements:
      files:
      - src/db/**
      - src/events/**
      - src/server.ts
    children:
    - id: db-client
      name: Database Client
      kind: module
      purpose: Connection pool and SQL query runner.
      status: active
      implements:
        files:
        - src/db/**
    - id: event-bus
      name: Event Bus
      kind: module
      purpose: Asynchronous pub/sub event dispatcher.
      status: active
      implements:
        files:
        - src/events/**
    - id: http-server
      name: HTTP Server
      kind: module
      purpose: Express/Koa HTTP request routing and middleware pipeline.
      status: active
      implements:
        files:
        - src/server.ts
`);

// 1.3 Relations: 14 declared + 4 inferred
write(path.join(demoAfwe, 'blueprint/relations.yaml'), `relations:
- id: rel-auth-user
  from: auth-api
  to: user-store
  kind: calls
- id: rel-auth-token
  from: auth-api
  to: session-token
  kind: calls
- id: rel-jwt-oauth
  from: oauth-callback
  to: jwt-signer
  kind: calls
- id: rel-lib-tag
  from: workspace-library
  to: workspace-tagging
  kind: imports
- id: rel-search-lib
  from: workspace-search
  to: workspace-library
  kind: reads
- id: rel-tag-color
  from: tag-normaliser
  to: tag-color-wheel
  kind: calls
- id: rel-checkout-stripe
  from: billing-checkout
  to: stripe-gateway
  kind: calls
- id: rel-checkout-invoices
  from: billing-checkout
  to: invoice-store
  kind: calls
- id: rel-proration-idemp
  from: proration-calculator
  to: idempotency-key-hasher
  kind: calls
- id: rel-presence-bus
  from: realtime-presence
  to: event-bus
  kind: publishes
- id: rel-worker-db
  from: realtime-status-worker
  to: db-client
  kind: reads
- id: rel-server-auth
  from: http-server
  to: auth-api
  kind: calls
- id: rel-server-workspace
  from: http-server
  to: workspace-library
  kind: calls
- id: rel-server-billing
  from: http-server
  to: billing-checkout
  kind: calls
- id: inf-worker-events
  from: realtime-status-worker
  to: event-bus
  kind: reads
  inferred: true
- id: inf-plans-stripe
  from: billing-plans
  to: stripe-gateway
  kind: reads
  inferred: true
- id: inf-search-tag
  from: workspace-search
  to: workspace-tagging
  kind: reads
  inferred: true
- id: inf-tag-renderer
  from: tag-color-wheel
  to: tag-pill-renderer
  kind: calls
  inferred: true
`);

// 1.4 Constraints: 4 constraints (triggers live violations in UI)
write(path.join(demoAfwe, 'blueprint/constraints.yaml'), `constraints:
- id: c-workspace-no-billing
  rule: must_not_depend
  from: workspace
  to:
  - billing
  rationale: Workspace core productivity must remain decoupled from billing and credit card handling.
  severity: error
- id: c-search-no-raw-db
  rule: must_not_depend
  from: workspace-search
  to:
  - db-client
  rationale: Search must index memory objects and never query the primary database client directly.
  severity: error
- id: c-billing-no-auth-internals
  rule: must_not_depend
  from: billing-checkout
  to:
  - session-token
  rationale: Checkout must receive authenticated claims from the HTTP context, not generate session tokens.
  severity: error
- id: c-realtime-read-only
  rule: must_not_depend
  from: realtime
  to:
  - billing
  rationale: Realtime heartbeat workers must never mutate billing ledgers or invoices.
  severity: error
`);

// 1.5 Pins: 10 pins (4 active block, 3 confirm/proposed, 3 retired)
const demoPins = [
  {
    id: "pin-d95a5b",
    statement: "Status widgets read the replica on purpose (eventual consistency accepted). Do not switch them to the primary to 'fix' staleness.",
    kind: "intentional",
    attaches: { nodes: ["realtime-status-worker"] },
    severity: "block",
    status: "active",
    origin: "human:lead",
    created: "2026-10-23T08:23:15Z",
    reason: "replica-read-policy",
    intentional: true
  },
  {
    id: "pin-auth-no-raw-tokens",
    statement: "Session tokens must always be hashed before persisting into storage; plain tokens in DB forbidden.",
    kind: "constraint",
    attaches: { nodes: ["session-token"] },
    severity: "block",
    status: "active",
    origin: "human:secops",
    created: "2026-10-23T09:00:00Z",
    reason: "owasp-a2-token-security"
  },
  {
    id: "pin-stripe-idempotency",
    statement: "All Stripe credit card mutation endpoints must require an Idempotency-Key header.",
    kind: "constraint",
    attaches: { nodes: ["stripe-gateway", "billing-checkout"] },
    severity: "block",
    status: "active",
    origin: "human:finops",
    created: "2026-10-23T09:30:00Z",
    reason: "prevent-double-charge"
  },
  {
    id: "pin-flat-tagging-invariant",
    statement: "Workspace tagging must remain flat with no nested parent-child tag hierarchy.",
    kind: "decision",
    attaches: { nodes: ["workspace-tagging"] },
    severity: "block",
    status: "active",
    origin: "human:pm",
    created: "2026-10-23T10:15:00Z",
    reason: "ux-simplicity-manifesto"
  },
  {
    id: "pin-tag-colors-accessible",
    statement: "Tag pill hex codes must maintain a 4.5:1 WCAG AA contrast ratio against dark/light backgrounds.",
    kind: "preference",
    attaches: { nodes: ["tag-color-wheel"] },
    severity: "confirm",
    status: "active",
    origin: "human:designer",
    created: "2026-10-24T11:00:00Z",
    reason: "accessibility-guidelines"
  },
  {
    id: "pin-invoice-pdf-retention",
    statement: "Invoice receipts must be retained indefinitely with immutable SHA256 checksums.",
    kind: "constraint",
    attaches: { nodes: ["invoice-store"] },
    severity: "confirm",
    status: "active",
    origin: "human:legal",
    created: "2026-10-24T14:20:00Z",
    reason: "tax-compliance-eu"
  },
  {
    id: "pin-ai-tag-auto-apply",
    statement: "Suggested AI tags require explicit user click to confirm; never silently auto-apply to library docs.",
    kind: "decision",
    attaches: { nodes: ["workspace-tagging"] },
    severity: "confirm",
    status: "proposed",
    origin: "human:pm",
    created: "2026-10-25T16:45:00Z",
    reason: "prevent-false-positive-categorization"
  },
  {
    id: "pin-legacy-polling-interval",
    statement: "Realtime presence polls every 5000ms over HTTP long-polling.",
    kind: "preference",
    attaches: { nodes: ["realtime-presence"] },
    severity: "warn",
    status: "retired",
    origin: "human:legacy",
    created: "2026-10-23T07:00:00Z",
    retired: "2026-10-24T09:00:00Z",
    reason: "upgraded-to-websockets"
  },
  {
    id: "pin-f6a032",
    statement: "Search index must be synchronously rebuilt on every library insert.",
    kind: "decision",
    attaches: { nodes: ["workspace-search"] },
    severity: "confirm",
    status: "retired",
    origin: "human:demo",
    created: "2026-10-23T07:30:00Z",
    retired: "2026-10-24T12:00:00Z",
    reason: "moved-to-async-micro-batching"
  },
  {
    id: "pin-single-tenant-db",
    statement: "Database client assumes single schema without tenant ID column segregation.",
    kind: "decision",
    attaches: { nodes: ["db-client"] },
    severity: "block",
    status: "retired",
    origin: "human:founder",
    created: "2026-10-23T06:00:00Z",
    retired: "2026-10-25T10:00:00Z",
    reason: "migrated-to-row-level-security"
  }
];

demoPins.forEach(p => {
  write(path.join(demoAfwe, 'pins', `${p.id}.yaml`), p);
});

// 1.6 Checks (Checkgen Standing Checks): 15 checks
const demoChecks = [
  // 3 forbid_import
  {
    id: "chk-no-billing-in-workspace",
    title: "workspace does not import billing",
    trust: "deterministic",
    authored_by: "checkgen",
    attaches: { nodes: ["workspace", "billing"] },
    claim: {
      type: "forbid_import",
      files: ["src/workspace/**"],
      to_nodes: ["billing"]
    },
    status: "active",
    origin: "afwe:checkgen",
    created: "2026-10-23T10:00:00Z",
    created_from: "t0002",
    provenance: "confirmed"
  },
  {
    id: "chk-no-raw-db-in-search",
    title: "search does not import db-client",
    trust: "deterministic",
    authored_by: "checkgen",
    attaches: { nodes: ["workspace-search", "db-client"] },
    claim: {
      type: "forbid_import",
      files: ["src/workspace/search/**"],
      to_nodes: ["db-client"]
    },
    status: "active",
    origin: "afwe:checkgen",
    created: "2026-10-23T11:00:00Z",
    created_from: "t0002",
    provenance: "confirmed"
  },
  {
    id: "chk-no-auth-in-checkout",
    title: "checkout does not import session-token",
    trust: "deterministic",
    authored_by: "checkgen",
    attaches: { nodes: ["billing-checkout", "session-token"] },
    claim: {
      type: "forbid_import",
      files: ["src/billing/checkout/**"],
      to_nodes: ["session-token"]
    },
    status: "active",
    origin: "afwe:checkgen",
    created: "2026-10-23T12:00:00Z",
    created_from: "t0003",
    provenance: "confirmed"
  },
  // 3 forbid_symbol
  {
    id: "chk-forbid-db-raw-query",
    title: "forbid DatabaseClient.rawQuery symbol",
    trust: "deterministic",
    authored_by: "checkgen",
    attaches: { nodes: ["db-client"] },
    claim: {
      type: "forbid_symbol",
      symbol: "src/db/client.ts::DatabaseClient.rawQuery"
    },
    status: "active",
    origin: "afwe:checkgen",
    created: "2026-10-24T09:00:00Z",
    created_from: "t0004",
    provenance: "confirmed"
  },
  {
    id: "chk-forbid-eval",
    title: "forbid eval invocation in server runtime",
    trust: "deterministic",
    authored_by: "checkgen",
    attaches: { nodes: ["http-server"] },
    claim: {
      type: "forbid_pattern",
      pattern: "\\beval\\s*\\(",
      files: ["src/server.ts"]
    },
    status: "active",
    origin: "afwe:checkgen",
    created: "2026-10-24T10:00:00Z",
    created_from: "t0004",
    provenance: "confirmed"
  },
  {
    id: "chk-forbid-mock-card",
    title: "forbid test credit cards in production gateway",
    trust: "deterministic",
    authored_by: "checkgen",
    attaches: { nodes: ["stripe-gateway"] },
    claim: {
      type: "forbid_symbol",
      symbol: "src/billing/stripe/StripeGateway.ts::useTestCardNumbers"
    },
    status: "active",
    origin: "afwe:checkgen",
    created: "2026-10-24T14:00:00Z",
    created_from: "t0005",
    provenance: "confirmed"
  },
  // 3 export_exists
  {
    id: "chk-export-normalise-tag",
    title: "normaliseTag export exists in Tags.ts",
    trust: "deterministic",
    authored_by: "checkgen",
    attaches: { nodes: ["workspace-tagging"] },
    claim: {
      type: "export_exists",
      symbol: "src/workspace/tagging/Tags.ts::normaliseTag"
    },
    status: "active",
    origin: "afwe:checkgen",
    created: "2026-10-23T10:30:00Z",
    created_from: "t0002",
    provenance: "graduated"
  },
  {
    id: "chk-export-sign-jwt",
    title: "signJwtToken export exists in jwtSigner.ts",
    trust: "deterministic",
    authored_by: "checkgen",
    attaches: { nodes: ["jwt-signer"] },
    claim: {
      type: "export_exists",
      symbol: "src/auth/jwtSigner.ts::signJwtToken"
    },
    status: "active",
    origin: "afwe:checkgen",
    created: "2026-10-24T11:00:00Z",
    created_from: "t0004",
    provenance: "graduated"
  },
  {
    id: "chk-export-proration",
    title: "calculateProration export exists in proration.ts",
    trust: "deterministic",
    authored_by: "checkgen",
    attaches: { nodes: ["proration-calculator"] },
    claim: {
      type: "export_exists",
      symbol: "src/billing/proration.ts::calculateProration"
    },
    status: "active",
    origin: "afwe:checkgen",
    created: "2026-10-24T15:00:00Z",
    created_from: "t0005",
    provenance: "graduated"
  },
  // 3 symbol_signature
  {
    id: "chk-sig-tag-color",
    title: "getTagColor takes string and returns string",
    trust: "deterministic",
    authored_by: "checkgen",
    attaches: { nodes: ["tag-color-wheel"] },
    claim: {
      type: "symbol_signature",
      symbol: "src/workspace/tagging/ColorWheel.ts::getTagColor",
      pattern: "\\(name:\\s*string\\):\\s*string"
    },
    status: "active",
    origin: "afwe:checkgen",
    created: "2026-10-24T16:00:00Z",
    created_from: "t0005",
    provenance: "confirmed"
  },
  {
    id: "chk-sig-hash-idemp",
    title: "hashIdempotencyKey takes string and returns string",
    trust: "deterministic",
    authored_by: "checkgen",
    attaches: { nodes: ["idempotency-key-hasher"] },
    claim: {
      type: "symbol_signature",
      symbol: "src/billing/proration.ts::hashIdempotencyKey",
      pattern: "\\(key:\\s*string\\):\\s*string"
    },
    status: "active",
    origin: "afwe:checkgen",
    created: "2026-10-25T10:00:00Z",
    created_from: "t0006",
    provenance: "confirmed"
  },
  {
    id: "chk-sig-render-tag-pill",
    title: "renderTagPill signature contract",
    trust: "deterministic",
    authored_by: "checkgen",
    attaches: { nodes: ["tag-pill-renderer"] },
    claim: {
      type: "symbol_signature",
      symbol: "src/workspace/tagging/ColorWheel.ts::renderTagPill",
      pattern: "\\(name:\\s*string\\)"
    },
    status: "active",
    origin: "afwe:checkgen",
    created: "2026-10-25T11:00:00Z",
    created_from: "t0006",
    provenance: "confirmed"
  },
  // 3 superseded checks
  {
    id: "chk-superseded-search-rebuild",
    title: "search index rebuilds synchronously on every insert",
    trust: "deterministic",
    authored_by: "checkgen",
    attaches: { nodes: ["workspace-search"] },
    command: "npm test -- test/search-sync.test.ts",
    status: "superseded",
    superseded_by: "chk-no-raw-db-in-search",
    origin: "afwe:checkgen",
    created: "2026-10-23T08:00:00Z",
    created_from: "t0001",
    provenance: "confirmed"
  },
  {
    id: "chk-superseded-webhook-retry",
    title: "legacy webhook retry dispatches immediately without backoff",
    trust: "deterministic",
    authored_by: "checkgen",
    attaches: { nodes: ["legacy-webhook-retry"] },
    claim: {
      type: "require_file",
      files: ["src/realtime/legacyWebhook.ts"]
    },
    status: "superseded",
    superseded_by: "t0003",
    origin: "afwe:checkgen",
    created: "2026-10-23T08:30:00Z",
    created_from: "t0001",
    provenance: "confirmed"
  },
  {
    id: "chk-superseded-watermark-png",
    title: "invoice watermark stamps PNG bitmap",
    trust: "deterministic",
    authored_by: "checkgen",
    attaches: { nodes: ["invoice-pdf-watermark"] },
    claim: {
      type: "require_file",
      files: ["src/billing/invoices/watermark.png"]
    },
    status: "superseded",
    superseded_by: "t0005",
    origin: "afwe:checkgen",
    created: "2026-10-23T09:00:00Z",
    created_from: "t0001",
    provenance: "confirmed"
  }
];

demoChecks.forEach(c => {
  write(path.join(demoAfwe, 'checks', `${c.id}.yaml`), c);
});

// 1.7 Calibration State: state/calibration.json
write(path.join(demoAfwe, 'state/calibration.json'), {
  models: {
    "claude-sonnet-4-5": {
      model_id: "claude-sonnet-4-5",
      human_accepted: 18,
      human_rejected: 2,
      trust_factor: 1.05,
      updated_at: "2026-10-26T09:00:00Z"
    },
    "gpt-4o": {
      model_id: "gpt-4o",
      human_accepted: 14,
      human_rejected: 5,
      trust_factor: 0.92,
      updated_at: "2026-10-26T09:15:00Z"
    },
    "gemini-2-5-pro": {
      model_id: "gemini-2-5-pro",
      human_accepted: 16,
      human_rejected: 3,
      trust_factor: 1.02,
      updated_at: "2026-10-26T09:30:00Z"
    }
  },
  guides: [
    // 3 probing guides (85%-90%)
    {
      id: "guide-replica-reads",
      title: "realtime status worker only queries replica pool",
      status: "probing",
      score: 0.88,
      claim: {
        type: "forbid_pattern",
        pattern: "getPrimaryDbConnection",
        files: ["src/realtime/**"]
      },
      attaches: { nodes: ["realtime-status-worker"] },
      probes: [
        { turn: "t0006", session_id: "sess-prod-1", symbol: "src/realtime/worker.ts::pollReplica", held_out: true },
        { turn: "t0007", session_id: "sess-prod-2", symbol: "src/realtime/worker.ts::getHealth", held_out: false }
      ],
      contradictions: 0,
      provenance: "inferred",
      origin: "llm:claude-sonnet-4-5",
      created: "2026-10-24T10:00:00Z",
      created_from: "t0004"
    },
    {
      id: "guide-no-localstorage-tokens",
      title: "tokens must not be written to browser localStorage",
      status: "probing",
      score: 0.86,
      claim: {
        type: "forbid_pattern",
        pattern: "localStorage\\.setItem\\(['\"]token",
        files: ["src/auth/**"]
      },
      attaches: { nodes: ["session-token"] },
      probes: [
        { turn: "t0005", session_id: "sess-auth-1", symbol: "src/auth/session.ts::persist", held_out: false },
        { turn: "t0006", session_id: "sess-auth-2", symbol: "src/auth/session.ts::serialize", held_out: true }
      ],
      contradictions: 0,
      provenance: "inferred",
      origin: "llm:gpt-4o",
      created: "2026-10-24T12:00:00Z",
      created_from: "t0004"
    },
    {
      id: "guide-proration-rounding",
      title: "proration cents must always use Math.round",
      status: "probing",
      score: 0.87,
      claim: {
        type: "require_pattern",
        pattern: "Math\\.round\\(",
        files: ["src/billing/proration.ts"]
      },
      attaches: { nodes: ["proration-calculator"] },
      probes: [
        { turn: "t0006", session_id: "sess-bill-1", symbol: "src/billing/proration.ts::calculateProration", held_out: true }
      ],
      contradictions: 0,
      provenance: "inferred",
      origin: "llm:gemini-2-5-pro",
      created: "2026-10-25T09:00:00Z",
      created_from: "t0005"
    },
    // 3 ready_to_graduate guides (>=3 sessions + hold out passed)
    {
      id: "guide-jwt-entropy-length",
      title: "JWT secret key length must exceed 32 characters",
      status: "ready_to_graduate",
      score: 0.94,
      claim: {
        type: "require_pattern",
        pattern: "secretKey\\.length\\s*<\\s*32",
        files: ["src/auth/jwtSigner.ts"]
      },
      attaches: { nodes: ["token-entropy-guard"] },
      probes: [
        { turn: "t0004", session_id: "sess-alpha", symbol: "src/auth/jwtSigner.ts::signJwtToken", held_out: true },
        { turn: "t0005", session_id: "sess-beta", symbol: "src/auth/jwtSigner.ts::signJwtToken", held_out: false },
        { turn: "t0006", session_id: "sess-gamma", symbol: "src/auth/jwtSigner.ts::signJwtToken", held_out: true }
      ],
      contradictions: 0,
      provenance: "inferred",
      origin: "llm:claude-sonnet-4-5",
      created: "2026-10-24T11:00:00Z",
      created_from: "t0004"
    },
    {
      id: "guide-tag-hex-prefix",
      title: "tag palette entries must begin with hash symbol",
      status: "ready_to_graduate",
      score: 0.95,
      claim: {
        type: "require_pattern",
        pattern: 'TAG_PALETTE\\s*=\\s*\\["#',
        files: ["src/workspace/tagging/ColorWheel.ts"]
      },
      attaches: { nodes: ["tag-color-wheel"] },
      probes: [
        { turn: "t0004", session_id: "sess-alpha", symbol: "src/workspace/tagging/ColorWheel.ts::TAG_PALETTE", held_out: false },
        { turn: "t0005", session_id: "sess-delta", symbol: "src/workspace/tagging/ColorWheel.ts::TAG_PALETTE", held_out: true },
        { turn: "t0006", session_id: "sess-epsilon", symbol: "src/workspace/tagging/ColorWheel.ts::TAG_PALETTE", held_out: true }
      ],
      contradictions: 0,
      provenance: "inferred",
      origin: "llm:claude-sonnet-4-5",
      created: "2026-10-24T11:30:00Z",
      created_from: "t0004"
    },
    {
      id: "guide-idempotency-prefix",
      title: "idempotency key hash begins with idemp_ prefix",
      status: "ready_to_graduate",
      score: 0.92,
      claim: {
        type: "require_pattern",
        pattern: 'idemp_',
        files: ["src/billing/proration.ts"]
      },
      attaches: { nodes: ["idempotency-key-hasher"] },
      probes: [
        { turn: "t0005", session_id: "sess-beta", symbol: "src/billing/proration.ts::hashIdempotencyKey", held_out: true },
        { turn: "t0006", session_id: "sess-gamma", symbol: "src/billing/proration.ts::hashIdempotencyKey", held_out: false },
        { turn: "t0007", session_id: "sess-zeta", symbol: "src/billing/proration.ts::hashIdempotencyKey", held_out: true }
      ],
      contradictions: 0,
      provenance: "inferred",
      origin: "llm:gemini-2-5-pro",
      created: "2026-10-25T08:00:00Z",
      created_from: "t0005"
    },
    // 3 graduated guides
    {
      id: "guide-normalise-tag-graduated",
      title: "normaliseTag export exists in Tags.ts",
      status: "graduated",
      score: 0.98,
      claim: {
        type: "export_exists",
        symbol: "src/workspace/tagging/Tags.ts::normaliseTag"
      },
      attaches: { nodes: ["workspace-tagging"] },
      probes: [
        { turn: "t0002", session_id: "sess-g1", symbol: "src/workspace/tagging/Tags.ts::normaliseTag", held_out: true },
        { turn: "t0003", session_id: "sess-g2", symbol: "src/workspace/tagging/Tags.ts::normaliseTag", held_out: true }
      ],
      contradictions: 0,
      provenance: "graduated",
      origin: "afwe:graduation",
      created: "2026-10-23T10:00:00Z",
      created_from: "t0002",
      graduated_check_id: "chk-export-normalise-tag",
      confirmed_by: "human:architect",
      confirmed_at: "2026-10-23T10:30:00Z"
    },
    {
      id: "guide-jwt-signer-graduated",
      title: "signJwtToken export exists in jwtSigner.ts",
      status: "graduated",
      score: 0.97,
      claim: {
        type: "export_exists",
        symbol: "src/auth/jwtSigner.ts::signJwtToken"
      },
      attaches: { nodes: ["jwt-signer"] },
      probes: [
        { turn: "t0004", session_id: "sess-g3", symbol: "src/auth/jwtSigner.ts::signJwtToken", held_out: true }
      ],
      contradictions: 0,
      provenance: "graduated",
      origin: "afwe:graduation",
      created: "2026-10-24T10:30:00Z",
      created_from: "t0004",
      graduated_check_id: "chk-export-sign-jwt",
      confirmed_by: "human:secops",
      confirmed_at: "2026-10-24T11:00:00Z"
    },
    {
      id: "guide-proration-graduated",
      title: "calculateProration export exists in proration.ts",
      status: "graduated",
      score: 0.99,
      claim: {
        type: "export_exists",
        symbol: "src/billing/proration.ts::calculateProration"
      },
      attaches: { nodes: ["proration-calculator"] },
      probes: [
        { turn: "t0005", session_id: "sess-g4", symbol: "src/billing/proration.ts::calculateProration", held_out: true }
      ],
      contradictions: 0,
      provenance: "graduated",
      origin: "afwe:graduation",
      created: "2026-10-24T14:30:00Z",
      created_from: "t0005",
      graduated_check_id: "chk-export-proration",
      confirmed_by: "human:lead",
      confirmed_at: "2026-10-24T15:00:00Z"
    }
  ],
  questions: [
    // 3 open <85% questions
    {
      id: "q-currency-rounding",
      turn: "t0008",
      session_id: "sess-multi-cur",
      question: "Should Japanese Yen (zero-decimal currency) checkout amounts be passed as integer Yen or multiplied by 100?",
      why_asking: "cross_subsystem: Stripe API expects zero-decimal currencies as raw integers; billing controller defaults to cents arithmetic.",
      blast_reasons: ["cross_subsystem", "exported_symbol"],
      blast_score: 8,
      proposed_claim: {
        type: "forbid_pattern",
        pattern: "chargeAmount\\s*\\*\\s*100",
        files: ["src/billing/checkout/CheckoutController.ts"]
      },
      attaches: { nodes: ["billing-checkout", "stripe-gateway"] },
      status: "open",
      created: "2026-10-25T14:00:00Z"
    },
    {
      id: "q-tag-case-sensitivity",
      turn: "t0007",
      session_id: "sess-tag-query",
      question: "Should tag matching in search support diacritic-insensitive collation (e.g., 'café' matches 'cafe')?",
      why_asking: "exported_symbol: workspace-search query parser normaliser affects public query API behavior.",
      blast_reasons: ["exported_symbol"],
      blast_score: 5,
      proposed_claim: {
        type: "require_pattern",
        pattern: "normalize\\(['\"]NFD['\"]\\)",
        files: ["src/workspace/search/Search.ts"]
      },
      attaches: { nodes: ["workspace-search", "workspace-tagging"] },
      status: "open",
      created: "2026-10-25T11:00:00Z"
    },
    {
      id: "q-presence-zombie-timeout",
      turn: "t0009",
      session_id: "sess-realtime-zombie",
      question: "Should disconnected WebSocket clients be purged after 30 seconds or marked 'away' for 5 minutes?",
      why_asking: "contradicts_history: prior turn t0006 set hard 30s heartbeat eviction.",
      blast_reasons: ["contradicts_history"],
      blast_score: 6,
      attaches: { nodes: ["realtime-presence"] },
      status: "open",
      created: "2026-10-25T16:00:00Z"
    },
    // 3 answered questions
    {
      id: "q-tag-hierarchy-choice",
      turn: "t0002",
      session_id: "sess-init-tags",
      question: "Are tags strictly flat or should we support nested categories (e.g. project/backend)?",
      why_asking: "Architectural scope clarification before authoring Tag interface.",
      blast_reasons: ["cross_subsystem"],
      blast_score: 9,
      attaches: { nodes: ["workspace-tagging"] },
      status: "answered",
      answer: "Keep tags strictly flat with no hierarchy. Simplicity first.",
      created: "2026-10-23T09:45:00Z",
      resolved: "2026-10-23T10:00:00Z"
    },
    {
      id: "q-replica-consistency-choice",
      turn: "t0006",
      session_id: "sess-replica-pol",
      question: "Can background health workers tolerate 500ms replication lag from read replica?",
      why_asking: "Load distribution policy decision for status dashboard widgets.",
      blast_reasons: ["exported_symbol"],
      blast_score: 7,
      attaches: { nodes: ["realtime-status-worker"] },
      status: "answered",
      answer: "Yes, eventual consistency is acceptable. Never query primary DB for status.",
      created: "2026-10-24T08:00:00Z",
      resolved: "2026-10-24T08:15:00Z"
    },
    {
      id: "q-jwt-expiry-window",
      turn: "t0004",
      session_id: "sess-jwt-auth",
      question: "What is the maximum allowable lifetime for access JWT tokens?",
      why_asking: "Security token TTL calibration.",
      blast_reasons: ["exported_symbol"],
      blast_score: 6,
      attaches: { nodes: ["jwt-signer", "session-token"] },
      status: "answered",
      answer: "Access tokens expire after 15 minutes; refresh tokens valid for 7 days.",
      created: "2026-10-24T09:30:00Z",
      resolved: "2026-10-24T10:00:00Z"
    }
  ]
});

// 1.8 12 Turns in .afwe/turns/t0001..t0012.yaml
// With collateral losses:
// t0001: implements includes legacy-webhook-retry, workspace-bulk-export, invoice-pdf-watermark
// t0003: drops legacy-webhook-retry (Loss #1)
// t0004: drops workspace-bulk-export (Loss #2)
// t0005: drops invoice-pdf-watermark (Loss #3)
const demoTurns = [
  // Day 1 (Oct 23)
  {
    id: "t0001",
    ts: "2026-10-23T08:00:00Z",
    origin: "human",
    agent: "claude-sonnet-4-5",
    prompt: "Initialize Pulse SaaS architecture and platform scaffolding",
    prompt_hash: "a1b2c3d4e5f60001",
    task: "pulse-init",
    scope: { nodes: ["demo-product"], files: ["src/**"] },
    status: "committed",
    touched: {
      nodes: ["demo-product", "identity", "workspace", "billing", "realtime", "platform"],
      files: ["src/server.ts", "src/auth/session.ts", "src/db/client.ts"]
    },
    implements: {
      "demo-product": ["src/server.ts"],
      "identity": ["src/auth/session.ts", "src/auth/users.ts"],
      "workspace": ["src/workspace/library/Library.ts"],
      "billing": ["src/billing/checkout/CheckoutController.ts"],
      "realtime": ["src/realtime/worker.ts"],
      "platform": ["src/server.ts", "src/db/client.ts"],
      "legacy-webhook-retry": ["src/realtime/legacyWebhook.ts"],
      "workspace-bulk-export": ["src/workspace/export.ts"],
      "invoice-pdf-watermark": ["src/billing/invoices/watermark.ts"]
    },
    checks: [
      { id: "cargo-check", title: "compiler check", trust: "deterministic", authored_by: "human", passed: true, blocking: true }
    ],
    strength: "deterministic",
    confidence: 1.0,
    confidence_parts: { clarity: 1.0, mapping: 1.0, pins: 1.0, verification: 1.0 },
    gate: { decision: "commit", reasons: ["Initial project baseline verified"] },
    summary: "Initialize Pulse SaaS architecture with 5 core subsystems",
    session_id: "sess-init-01",
    checkgen: ["chk-superseded-search-rebuild", "chk-superseded-webhook-retry", "chk-superseded-watermark-png"]
  },
  {
    id: "t0002",
    ts: "2026-10-23T11:00:00Z",
    origin: "human",
    agent: "claude-sonnet-4-5",
    prompt: "Implement flat workspace tagging and wire into library search",
    prompt_hash: "a1b2c3d4e5f60002",
    task: "pulse-tagging",
    targets: ["workspace-tagging", "workspace-library", "workspace-search"],
    scope: { nodes: ["workspace-tagging", "workspace-library", "workspace-search"], files: ["src/workspace/**"] },
    intents: [
      { id: "add-tagging", action: "update", targets: ["workspace-tagging"], title: "Add flat tagging to library" }
    ],
    status: "committed",
    touched: {
      nodes: ["workspace-tagging", "workspace-library", "workspace-search"],
      files: ["src/workspace/tagging/Tags.ts", "src/workspace/library/Library.ts", "src/workspace/search/Search.ts"]
    },
    implements: {
      "demo-product": ["src/server.ts"],
      "identity": ["src/auth/session.ts"],
      "workspace": ["src/workspace/library/Library.ts"],
      "workspace-tagging": ["src/workspace/tagging/Tags.ts"],
      "workspace-library": ["src/workspace/library/Library.ts"],
      "workspace-search": ["src/workspace/search/Search.ts"],
      "billing": ["src/billing/checkout/CheckoutController.ts"],
      "realtime": ["src/realtime/worker.ts"],
      "legacy-webhook-retry": ["src/realtime/legacyWebhook.ts"],
      "workspace-bulk-export": ["src/workspace/export.ts"],
      "invoice-pdf-watermark": ["src/billing/invoices/watermark.ts"]
    },
    checks: [
      { id: "chk-no-billing-in-workspace", title: "workspace does not import billing", trust: "deterministic", authored_by: "checkgen", passed: true, blocking: true },
      { id: "chk-export-normalise-tag", title: "normaliseTag export exists in Tags.ts", trust: "deterministic", authored_by: "checkgen", passed: true, blocking: true }
    ],
    strength: "deterministic",
    confidence: 0.98,
    confidence_parts: { clarity: 1.0, mapping: 0.96, pins: 1.0, verification: 0.98 },
    gate: { decision: "commit", reasons: ["Tags implemented cleanly and normaliser exported"] },
    summary: "Add flat workspace tagging and wire into library search",
    session_id: "sess-tag-02",
    checkgen: ["chk-no-billing-in-workspace", "chk-no-raw-db-in-search", "chk-export-normalise-tag"]
  },
  {
    id: "t0003",
    ts: "2026-10-23T16:30:00Z",
    origin: "human",
    agent: "claude-sonnet-4-5",
    prompt: "Add Stripe checkout idempotency and proration calculator",
    prompt_hash: "a1b2c3d4e5f60003",
    task: "pulse-checkout",
    targets: ["billing-checkout", "stripe-gateway"],
    status: "committed",
    touched: {
      nodes: ["billing-checkout", "stripe-gateway"],
      files: ["src/billing/checkout/CheckoutController.ts", "src/billing/proration.ts"]
    },
    // COLLATERAL LOSS #1: legacy-webhook-retry omitted from implements!
    implements: {
      "demo-product": ["src/server.ts"],
      "workspace": ["src/workspace/library/Library.ts"],
      "workspace-tagging": ["src/workspace/tagging/Tags.ts"],
      "billing": ["src/billing/checkout/CheckoutController.ts"],
      "billing-checkout": ["src/billing/checkout/CheckoutController.ts"],
      "stripe-gateway": ["src/billing/stripe/StripeGateway.ts"],
      "proration-calculator": ["src/billing/proration.ts"],
      "workspace-bulk-export": ["src/workspace/export.ts"],
      "invoice-pdf-watermark": ["src/billing/invoices/watermark.ts"]
    },
    checks: [
      { id: "chk-no-auth-in-checkout", title: "checkout does not import session-token", trust: "deterministic", authored_by: "checkgen", passed: true, blocking: true }
    ],
    strength: "deterministic",
    confidence: 0.95,
    gate: { decision: "commit", reasons: ["Stripe integration verified with idempotency keys"] },
    summary: "Add Stripe checkout idempotency and proration calculator",
    session_id: "sess-bill-03",
    checkgen: ["chk-no-auth-in-checkout"]
  },

  // Day 2 (Oct 24)
  {
    id: "t0004",
    ts: "2026-10-24T10:15:00Z",
    origin: "human",
    agent: "gpt-4o",
    prompt: "Refactor workspace search index and introduce JWT signer component",
    prompt_hash: "a1b2c3d4e5f60004",
    task: "pulse-search-auth",
    targets: ["workspace-search", "jwt-signer"],
    status: "committed",
    overrides: [
      { pin: "pin-f6a032", reason: "Async search indexing replaces synchronous insert locking" }
    ],
    touched: {
      nodes: ["workspace-search", "jwt-signer"],
      files: ["src/workspace/search/Search.ts", "src/auth/jwtSigner.ts"]
    },
    // COLLATERAL LOSS #2: workspace-bulk-export omitted from implements!
    implements: {
      "demo-product": ["src/server.ts"],
      "workspace": ["src/workspace/library/Library.ts"],
      "workspace-tagging": ["src/workspace/tagging/Tags.ts"],
      "workspace-search": ["src/workspace/search/Search.ts"],
      "billing": ["src/billing/checkout/CheckoutController.ts"],
      "stripe-gateway": ["src/billing/stripe/StripeGateway.ts"],
      "jwt-signer": ["src/auth/jwtSigner.ts"],
      "invoice-pdf-watermark": ["src/billing/invoices/watermark.ts"]
    },
    checks: [
      { id: "chk-forbid-db-raw-query", title: "forbid DatabaseClient.rawQuery", trust: "deterministic", authored_by: "checkgen", passed: true, blocking: true },
      { id: "chk-export-sign-jwt", title: "signJwtToken export exists", trust: "deterministic", authored_by: "checkgen", passed: true, blocking: true }
    ],
    strength: "deterministic",
    confidence: 0.93,
    gate: { decision: "commit", reasons: ["OVERRIDDEN pin pin-f6a032: Async indexing", "JWT signer verified"] },
    summary: "Refactor workspace search index and introduce JWT signer component",
    session_id: "sess-search-04",
    checkgen: ["chk-forbid-db-raw-query", "chk-export-sign-jwt"]
  },
  {
    id: "t0005",
    ts: "2026-10-24T15:00:00Z",
    origin: "human",
    agent: "claude-sonnet-4-5",
    prompt: "Upgrade invoice store schema and add tag color wheel",
    prompt_hash: "a1b2c3d4e5f60005",
    task: "pulse-invoices-tags",
    targets: ["invoice-store", "tag-color-wheel"],
    status: "committed",
    restore: {
      feature: "legacy-webhook-retry",
      from_turn: "t0001",
      lost_turn: "t0003",
      conflicts: 0
    },
    touched: {
      nodes: ["invoice-store", "tag-color-wheel"],
      files: ["src/billing/invoices/InvoiceStore.ts", "src/workspace/tagging/ColorWheel.ts"]
    },
    // COLLATERAL LOSS #3: invoice-pdf-watermark omitted from implements!
    implements: {
      "demo-product": ["src/server.ts"],
      "workspace": ["src/workspace/library/Library.ts"],
      "workspace-tagging": ["src/workspace/tagging/Tags.ts"],
      "workspace-search": ["src/workspace/search/Search.ts"],
      "tag-color-wheel": ["src/workspace/tagging/ColorWheel.ts"],
      "billing": ["src/billing/checkout/CheckoutController.ts"],
      "invoice-store": ["src/billing/invoices/InvoiceStore.ts"],
      "jwt-signer": ["src/auth/jwtSigner.ts"]
    },
    checks: [
      { id: "chk-export-proration", title: "calculateProration export exists", trust: "deterministic", authored_by: "checkgen", passed: true, blocking: true },
      { id: "chk-sig-tag-color", title: "getTagColor signature verified", trust: "deterministic", authored_by: "checkgen", passed: true, blocking: true }
    ],
    strength: "deterministic",
    confidence: 0.94,
    gate: { decision: "commit", reasons: ["Invoice store upgraded", "Color wheel verified"] },
    summary: "Upgrade invoice store schema and add tag color wheel",
    session_id: "sess-inv-05",
    checkgen: ["chk-sig-tag-color", "chk-export-proration"]
  },
  {
    id: "t0006",
    ts: "2026-10-24T19:30:00Z",
    origin: "human",
    agent: "gemini-2-5-pro",
    prompt: "Enforce realtime replica read policy and multi-session holdout verification",
    prompt_hash: "a1b2c3d4e5f60006",
    task: "pulse-realtime-holdout",
    targets: ["realtime-status-worker"],
    status: "committed",
    restore: {
      feature: "workspace-bulk-export",
      from_turn: "t0001",
      lost_turn: "t0004",
      conflicts: 0
    },
    touched: {
      nodes: ["realtime-status-worker"],
      files: ["src/realtime/worker.ts"]
    },
    implements: {
      "demo-product": ["src/server.ts"],
      "workspace": ["src/workspace/library/Library.ts"],
      "tag-color-wheel": ["src/workspace/tagging/ColorWheel.ts"],
      "realtime-status-worker": ["src/realtime/worker.ts"],
      "jwt-signer": ["src/auth/jwtSigner.ts"],
      "proration-calculator": ["src/billing/proration.ts"]
    },
    checks: [
      { id: "chk-sig-hash-idemp", title: "hashIdempotencyKey signature verified", trust: "deterministic", authored_by: "checkgen", passed: true, blocking: true }
    ],
    strength: "deterministic",
    confidence: 0.91,
    gate: { decision: "commit", reasons: ["Replica worker reads verified with zero master pool calls"] },
    summary: "Enforce realtime replica read policy with holdout verification",
    session_id: "sess-realtime-06",
    checkgen: ["chk-sig-hash-idemp", "chk-sig-render-tag-pill"],
    held_out_guides: ["guide-replica-reads"]
  },

  // Day 3 (Oct 25) - 3 Staged Turns
  {
    id: "t0007",
    ts: "2026-10-25T11:00:00Z",
    origin: "human",
    agent: "claude-sonnet-4-5",
    prompt: "Propose AI tag suggestion experiment in uncharted experiments folder",
    prompt_hash: "a1b2c3d4e5f60007",
    task: "pulse-ai-suggest",
    targets: ["workspace-tagging"],
    status: "staged",
    touched: {
      nodes: ["workspace-tagging"],
      files: ["src/experiments/aiSuggest.ts"]
    },
    implements: {
      "workspace-tagging": ["src/workspace/tagging/Tags.ts", "src/experiments/aiSuggest.ts"]
    },
    pin_proposals: ["pin-ai-tag-auto-apply"],
    checks: [
      { id: "chk-ai-opt-in", title: "ai suggestions require manual confirmation", trust: "generated", authored_by: "agent", passed: true, blocking: false }
    ],
    strength: "generated",
    confidence: 0.78,
    gate: {
      decision: "stage",
      reasons: ["CONFIRM pin pin-tag-colors-accessible held", "Proposed pin pin-ai-tag-auto-apply awaiting review"]
    },
    summary: "Propose AI tag suggestion experiment in uncharted experiments folder",
    session_id: "sess-ai-07",
    agent_zone_rationales: ["Leaf heuristic: aiSuggest extracts keywords with length > 5"]
  },
  {
    id: "t0008",
    ts: "2026-10-25T14:30:00Z",
    origin: "human",
    agent: "gpt-4o",
    prompt: "Add multi-currency zero-decimal currency checkout support",
    prompt_hash: "a1b2c3d4e5f60008",
    task: "pulse-multi-curr",
    targets: ["billing-checkout"],
    status: "staged",
    restore: {
      feature: "invoice-pdf-watermark",
      from_turn: "t0001",
      lost_turn: "t0005",
      conflicts: 0
    },
    touched: {
      nodes: ["billing-checkout"],
      files: ["src/billing/checkout/CheckoutController.ts"]
    },
    implements: {
      "billing-checkout": ["src/billing/checkout/CheckoutController.ts"]
    },
    checks: [
      { id: "chk-currency-format", title: "currency ISO 4217 code format", trust: "deterministic", authored_by: "agent", passed: true, blocking: true }
    ],
    strength: "deterministic",
    confidence: 0.75,
    gate: {
      decision: "stage",
      reasons: ["AmbiguityQuestion q-currency-rounding open with blast score 8"]
    },
    summary: "Add multi-currency checkout support pending ambiguity answer",
    session_id: "sess-curr-08"
  },
  {
    id: "t0009",
    ts: "2026-10-25T17:00:00Z",
    origin: "human",
    agent: "claude-sonnet-4-5",
    prompt: "Introduce transactional email notification worker in unmapped notifications folder",
    prompt_hash: "a1b2c3d4e5f60009",
    task: "pulse-mailer",
    targets: ["demo-product"],
    status: "staged",
    touched: {
      nodes: ["demo-product"],
      files: ["src/notifications/mailer.ts"]
    },
    implements: {
      "demo-product": ["src/notifications/mailer.ts"]
    },
    checks: [
      { id: "chk-mailer-syntax", title: "mailer TypeScript compilation", trust: "deterministic", authored_by: "afwe", passed: true, blocking: true }
    ],
    strength: "deterministic",
    confidence: 0.81,
    gate: {
      decision: "stage",
      reasons: ["Unmapped file src/notifications/mailer.ts has pending drift proposal unmapped:aff22d1faf"]
    },
    summary: "Introduce notification mailer worker staged awaiting node creation",
    session_id: "sess-mailer-09"
  },

  // Day 4 (Oct 26) - 3 Redo Turns
  {
    id: "t0010",
    ts: "2026-10-26T08:30:00Z",
    origin: "human",
    agent: "gpt-4o",
    prompt: "Attempt switching status worker to primary database to eliminate staleness",
    prompt_hash: "a1b2c3d4e5f60010",
    task: "pulse-hack-staleness",
    targets: ["realtime-status-worker"],
    status: "abandoned",
    touched: {
      nodes: ["realtime-status-worker"],
      files: ["src/realtime/worker.ts"]
    },
    implements: {
      "realtime-status-worker": ["src/realtime/worker.ts"]
    },
    checks: [
      { id: "chk-no-primary-reads", title: "pin-d95a5b compliance check", trust: "deterministic", authored_by: "afwe", passed: false, blocking: true, message: "Intentional pin pin-d95a5b forbids switching realtime-status-worker to primary DB" }
    ],
    strength: "deterministic",
    confidence: 0.2,
    gate: {
      decision: "redo",
      reasons: [
        "BLOCKED by pin pin-d95a5b: Status widgets read replica on purpose (eventual consistency accepted)",
        "TurnJudgment action: block"
      ]
    },
    summary: "Switch status worker to primary DB (BLOCKED by intentional pin)",
    session_id: "sess-redo-10"
  },
  {
    id: "t0011",
    ts: "2026-10-26T09:45:00Z",
    origin: "human",
    agent: "claude-sonnet-4-5",
    prompt: "Directly import StripeGateway into Workspace Library for instant charge on download",
    prompt_hash: "a1b2c3d4e5f60011",
    task: "pulse-hack-cross-dep",
    targets: ["workspace-library"],
    status: "abandoned",
    touched: {
      nodes: ["workspace-library", "stripe-gateway"],
      files: ["src/workspace/library/Library.ts"]
    },
    implements: {
      "workspace-library": ["src/workspace/library/Library.ts"]
    },
    checks: [
      { id: "chk-no-billing-in-workspace", title: "workspace does not import billing", trust: "deterministic", authored_by: "checkgen", passed: false, blocking: true, message: "Constraint c-workspace-no-billing violated: workspace-library imports billing/stripe/StripeGateway" }
    ],
    strength: "deterministic",
    confidence: 0.15,
    gate: {
      decision: "redo",
      reasons: [
        "CONSTRAINT_VIOLATION: workspace must_not_depend on billing",
        "TurnJudgment leaf-to-root validator failed at module level: workspace-library"
      ]
    },
    summary: "Import StripeGateway into Library (BLOCKED by boundary constraint)",
    session_id: "sess-redo-11"
  },
  {
    id: "t0012",
    ts: "2026-10-26T10:30:00Z",
    origin: "human",
    agent: "gemini-2-5-pro",
    prompt: "Execute raw SQL query in CheckoutController to inspect customer balances",
    prompt_hash: "a1b2c3d4e5f60012",
    task: "pulse-hack-raw-sql",
    targets: ["billing-checkout"],
    status: "abandoned",
    touched: {
      nodes: ["billing-checkout"],
      files: ["src/billing/checkout/CheckoutController.ts"]
    },
    implements: {
      "billing-checkout": ["src/billing/checkout/CheckoutController.ts"]
    },
    checks: [
      { id: "chk-no-raw-sql", title: "active guardrail: no-raw-sql", trust: "deterministic", authored_by: "afwe", passed: false, blocking: true, message: "Active guardrail no-raw-sql: raw SQL outside db client forbidden" }
    ],
    strength: "deterministic",
    confidence: 0.1,
    gate: {
      decision: "redo",
      reasons: [
        "ACTIVE_GUARDRAIL_VIOLATION: no-raw-sql forbids rawQuery invocation",
        "Agent reask required: route through database repository layer"
      ]
    },
    summary: "Execute raw SQL query in CheckoutController (BLOCKED by active tripwire)",
    session_id: "sess-redo-12"
  }
];

demoTurns.forEach(t => {
  write(path.join(demoAfwe, 'turns', `${t.id}.yaml`), t);
});

// 1.9 4 Living Intents (.afwe/intents/*.yaml)
const demoIntents = [
  {
    id: "add-tagging",
    title: "Add flat tagging to workspace library",
    statement: "Tags are flat labels on items without nested taxonomy. Color badges are deterministic.",
    status: "implemented",
    origin: "human:pm",
    attaches: { nodes: ["workspace-tagging", "workspace-library"] },
    history: [
      { turn: "t0002", ts: "2026-10-23T11:00:00Z", statement: "Initial flat tagging implementation" },
      { turn: "t0005", ts: "2026-10-24T15:00:00Z", statement: "Added color wheel badge rendering" }
    ],
    pins: ["pin-flat-tagging-invariant", "pin-tag-colors-accessible"]
  },
  {
    id: "stripe-idempotency",
    title: "Enforce payment idempotency on all checkouts",
    statement: "Every payment request carries an Idempotency-Key header hashed before transmission.",
    status: "active",
    origin: "human:finops",
    attaches: { nodes: ["stripe-gateway", "billing-checkout"] },
    history: [
      { turn: "t0003", ts: "2026-10-23T16:30:00Z", statement: "Require idempotency keys on charge mutations" }
    ],
    pins: ["pin-stripe-idempotency"]
  },
  {
    id: "replica-read-isolation",
    title: "Isolate realtime dashboard heartbeats to read replicas",
    statement: "Health workers query read replicas with acceptable eventual consistency to protect primary DB throughput.",
    status: "active",
    origin: "human:architect",
    attaches: { nodes: ["realtime-status-worker"] },
    history: [
      { turn: "t0006", ts: "2026-10-24T19:30:00Z", statement: "Lock replica read policy" }
    ],
    pins: ["pin-d95a5b"]
  },
  {
    id: "ai-smart-categorization",
    title: "AI-assisted tag suggestions for workspace library documents",
    statement: "Suggest tags based on document text keywords with opt-in human confirmation.",
    status: "draft",
    origin: "human:pm",
    attaches: { nodes: ["workspace-tagging"] },
    history: [
      { turn: "t0007", ts: "2026-10-25T11:00:00Z", statement: "Draft proposed AI tag suggestion engine" }
    ],
    pins: ["pin-ai-tag-auto-apply"]
  }
];

demoIntents.forEach(i => {
  write(path.join(demoAfwe, 'intents', `${i.id}.yaml`), i);
});

// 1.10 Guardrails: 3 active, 3 passive
const demoGuardrailsActive = [
  {
    id: "no-raw-sql",
    mode: "active",
    statement: "All database queries must go through the DatabaseClient interface. Raw sql strings in controllers forbidden.",
    scope: { files: ["src/billing/**", "src/workspace/**", "src/auth/**"] },
    checks: [
      { type: "forbid_pattern", pattern: "\\brawQuery\\s*\\(", files: ["src/billing/**", "src/workspace/**"] }
    ]
  },
  {
    id: "require-jwt-secret-check",
    mode: "active",
    statement: "JWT signer must enforce 32-character minimum secret key length.",
    scope: { files: ["src/auth/jwtSigner.ts"] },
    checks: [
      { type: "require_pattern", pattern: "secretKey\\.length\\s*<\\s*32", files: ["src/auth/jwtSigner.ts"] }
    ]
  },
  {
    id: "forbid-test-cards",
    mode: "active",
    statement: "Test card numbers must not appear in production billing code.",
    scope: { files: ["src/billing/**"] },
    checks: [
      { type: "forbid_pattern", pattern: "4242424242424242", files: ["src/billing/**"] }
    ]
  }
];

demoGuardrailsActive.forEach(g => {
  write(path.join(demoAfwe, 'guardrails/active', `${g.id}.yaml`), g);
});

const demoGuardrailsPassive = [
  {
    id: "controller-shape",
    mode: "passive",
    statement: "Controllers should be class-based with typed request and response methods.",
    scope: { files: ["src/**/*.ts"] }
  },
  {
    id: "tag-color-contrast",
    mode: "passive",
    statement: "Color palette hex codes should provide sufficient contrast against white background.",
    scope: { files: ["src/workspace/tagging/**"] }
  },
  {
    id: "event-naming-convention",
    mode: "passive",
    statement: "Event bus topics should follow domain:action dot notation.",
    scope: { files: ["src/events/**"] }
  }
];

demoGuardrailsPassive.forEach(g => {
  write(path.join(demoAfwe, 'guardrails/passive', `${g.id}.yaml`), g);
});

// 1.11 Memory: 15 entries (3 per kind)
const demoMemories = [
  // decisions
  { kind: "decisions", id: "dec-flat-tags", title: "Flat tags without taxonomy", body: "We deliberately chose flat tags over hierarchical taxonomies to reduce cognitive load on end users.", applies_to: ["Core.models"] },
  { kind: "decisions", id: "dec-replica-reads", title: "Eventual consistency for status widgets", body: "Realtime status worker queries read replicas. Occasional 500ms staleness is accepted to isolate primary DB load.", applies_to: ["Services.jobs"] },
  { kind: "decisions", id: "dec-jwt-stateless", title: "Stateless JWT access tokens", body: "Access tokens are signed statelessly with 15-minute expiration; sessions table only stores refresh tokens.", applies_to: ["Services.auth"] },
  // constraints
  { kind: "constraints", id: "con-workspace-billing-boundary", title: "Decoupling workspace from billing", body: "Workspace library code must never import Stripe or checkout controllers. Feature gating happens in the HTTP server layer.", applies_to: ["Core.models", "Services.billing"] },
  { kind: "constraints", id: "con-idempotency-key-mandatory", title: "Mandatory idempotency keys on payment operations", body: "Double billing prevention requires an idempotency key hashed from client UUID and payload hash.", applies_to: ["Services.billing"] },
  { kind: "constraints", id: "con-secret-entropy", title: "32-byte secret entropy requirement", body: "Cryptographic operations reject any secret with fewer than 32 characters or low entropy.", applies_to: ["Services.auth"] },
  // exceptions
  { kind: "exceptions", id: "exc-search-direct-query", title: "Exception: Search index raw SQL read permitted during initial bulk load", body: "During seed startup, search index may execute bulk read queries directly before event sync starts.", applies_to: ["Core.models"] },
  { kind: "exceptions", id: "exc-billing-test-bypass", title: "Exception: Local sandbox bypass for stripe webhook signature", body: "In NODE_ENV=development, webhook signature HMAC check may be skipped if STRIPE_MOCK=true.", applies_to: ["Services.billing"] },
  { kind: "exceptions", id: "exc-realtime-admin-override", title: "Exception: Manual cluster health check ping directly to primary DB", body: "Admin diagnostic CLI command may bypass replica pool to test primary connection health.", applies_to: ["Services.jobs"] },
  // problems
  { kind: "problems", id: "prob-tag-color-collision", title: "Hash collision on 5-color palette", body: "Short tag names can hash to the same color in close proximity; future revision should adjust seed salt.", applies_to: ["Core.models"] },
  { kind: "problems", id: "prob-zombie-websockets", title: "Mobile clients dropping connections without TCP FIN", body: "Cellular network handoffs cause ghost presence state lingering up to 30 seconds before heartbeat timeout.", applies_to: ["Services.jobs"] },
  { kind: "problems", id: "prob-proration-rounding-drift", title: "Sub-cent rounding discrepancies across multiple mid-month seat changes", body: "Repeated seat addition and removal in the same hour can drift by +/- 1 cent due to integer floor arithmetic.", applies_to: ["Services.billing"] },
  // terminology
  { kind: "terminology", id: "term-workspace-item", title: "Item vs Document", body: "An Item is the generic container in the library; Documents, Sheets, and Canvas boards are all Item variants.", applies_to: ["Core.models"] },
  { kind: "terminology", id: "term-proration", title: "Proration arithmetic", body: "Proration refers to charging or crediting the exact fraction of the unelapsed monthly subscription period.", applies_to: ["Services.billing"] },
  { kind: "terminology", id: "term-presence-heartbeat", title: "Presence Heartbeat vs Status Ping", body: "Presence heartbeats are user-to-server; Status pings are worker-to-cluster infrastructure checks.", applies_to: ["Services.jobs"] }
];

demoMemories.forEach(m => {
  const content = `---
id: ${m.id}
kind: ${m.kind.slice(0, -1)}
title: "${m.title}"
status: accepted
applies_to:
${m.applies_to.map(n => `  - ${n}`).join('\n')}
created: 2026-10-24T12:00:00Z
---

# ${m.title}

${m.body}
`;
  write(path.join(demoAfwe, 'memory', m.kind, `${m.id}.md`), content);
});

// 1.12 Drift Proposals (.afwe/state/proposals.json)
write(path.join(demoAfwe, 'state/proposals.json'), {
  proposals: [
    {
      id: "unmapped:aff22d1faf",
      created: "2026-10-25T16:52:15Z",
      finding: {
        id: "unmapped:aff22d1faf",
        kind: "unmapped_file",
        severity: "warn",
        confidence: 0.35,
        summary: "\`src/notifications/mailer.ts\` has no blueprint home; propose new module \`notifications\`",
        evidence: ["mailer.ts located outside declared subsystem scopes"],
        change: {
          op: "create_node",
          parent: "demo-product",
          name: "notifications",
          files: ["src/notifications/**"]
        },
        files: ["src/notifications/mailer.ts"]
      },
      status: "pending"
    },
    {
      id: "unmapped:ai-suggest",
      created: "2026-10-25T17:00:00Z",
      finding: {
        id: "unmapped:ai-suggest",
        kind: "unmapped_file",
        severity: "info",
        confidence: 0.4,
        summary: "\`src/experiments/aiSuggest.ts\` found in unmapped folder; map to workspace-tagging",
        evidence: ["suggestWorkspaceTags symbol imports Tag interface"],
        change: {
          op: "map_file",
          node: "workspace-tagging",
          file: "src/experiments/aiSuggest.ts"
        },
        files: ["src/experiments/aiSuggest.ts"]
      },
      status: "pending"
    },
    {
      id: "unmapped:xml-importer",
      created: "2026-10-25T17:15:00Z",
      finding: {
        id: "unmapped:xml-importer",
        kind: "unmapped_file",
        severity: "warn",
        confidence: 0.25,
        summary: "\`src/legacy-sync/xmlImporter.ts\` belongs to unmapped legacy sync subsystem",
        evidence: ["standalone XML batch parser"],
        change: {
          op: "create_node",
          parent: "platform",
          name: "legacy-sync",
          files: ["src/legacy-sync/**"]
        },
        files: ["src/legacy-sync/xmlImporter.ts"]
      },
      status: "pending"
    },
    {
      id: "drift:rel-worker-events",
      created: "2026-10-25T18:00:00Z",
      finding: {
        id: "drift:rel-worker-events",
        kind: "undeclared_relation",
        severity: "info",
        confidence: 0.7,
        summary: "Inferred dependency: realtime-status-worker reads event-bus",
        evidence: ["worker.ts imports EventBus singleton"],
        change: {
          op: "add_relation",
          from: "realtime-status-worker",
          to: "event-bus",
          kind: "reads"
        },
        nodes: ["realtime-status-worker", "event-bus"]
      },
      status: "pending"
    }
  ]
});

// 1.13 Escalations (.afwe/state/escalations.json)
write(path.join(demoAfwe, 'state/escalations.json'), [
  {
    id: "esc-db-replica-switch",
    created_at: "2026-10-26T08:35:00Z",
    op: "retire_pin",
    description: "Agent attempted to retire intentional pin pin-d95a5b to switch worker to primary DB",
    params: { pin_id: "pin-d95a5b", reason: "Eliminate eventual consistency lag" },
    origin: "llm:gpt-4o",
    turn: "t0010",
    status: "rejected",
    decided_by: "human:lead",
    decided_at: "2026-10-26T08:45:00Z"
  },
  {
    id: "esc-loosen-workspace-billing",
    created_at: "2026-10-26T09:50:00Z",
    op: "modify_constraint",
    description: "Agent requested loosening constraint c-workspace-no-billing to allow instant checkout inside library",
    params: { constraint_id: "c-workspace-no-billing" },
    origin: "llm:claude-sonnet-4-5",
    turn: "t0011",
    status: "rejected",
    decided_by: "human:architect",
    decided_at: "2026-10-26T10:00:00Z"
  },
  {
    id: "esc-add-currency-rounding",
    created_at: "2026-10-25T14:45:00Z",
    op: "add_pin",
    description: "Approve zero-decimal Yen currency handling pin",
    params: { pin_statement: "JPY amounts are integer without multiplication" },
    origin: "llm:gpt-4o",
    turn: "t0008",
    status: "pending"
  }
]);

// 1.14 Missions (.afwe/missions/*.yaml) & Leases (.afwe/state/leases.json)
const demoMissions = [
  {
    id: "m-billing-v2",
    title: "Billing V2 Upgrade & Proration Hardening",
    prompt: "Refactor proration and invoice store with multi-currency support",
    orchestrator: "human:finops",
    status: "Active",
    created: "2026-10-25T10:00:00Z",
    updated: "2026-10-26T09:00:00Z",
    invariants: {
      locked_pins: ["pin-stripe-idempotency"],
      must_not_depend: ["workspace->billing"]
    },
    budget: { max_escalations: 2, max_partial_losses: 0 },
    agents: [
      {
        agent_id: "subagent-proration",
        role: "Proration Specialist",
        branch: "mission/m-billing-v2/proration",
        worktree_path: ".afwe/worktrees/m-billing-v2-proration",
        assigned_nodes: ["proration-calculator", "idempotency-key-hasher"],
        status: "active"
      }
    ]
  },
  {
    id: "m-realtime-scale",
    title: "Realtime WebSocket Scale & Heartbeat Hardening",
    prompt: "Scale websocket presence cluster to 50k concurrent nodes",
    orchestrator: "human:infra",
    status: "Paused",
    created: "2026-10-24T14:00:00Z",
    updated: "2026-10-25T18:00:00Z",
    invariants: {
      locked_pins: ["pin-d95a5b"]
    },
    agents: []
  },
  {
    id: "m-tagging-v1",
    title: "Flat Tagging Implementation",
    prompt: "Deliver flat tags with color wheel support",
    orchestrator: "human:pm",
    status: "Completed",
    created: "2026-10-23T09:00:00Z",
    updated: "2026-10-23T12:00:00Z",
    agents: []
  }
];

demoMissions.forEach(m => {
  write(path.join(demoAfwe, 'missions', `${m.id}.yaml`), m);
});

write(path.join(demoAfwe, 'state/leases.json'), {
  leases: [
    {
      node_id: "proration-calculator",
      mission_id: "m-billing-v2",
      agent_id: "subagent-proration",
      acquired_at: "2026-10-26T09:00:00Z",
      expires_at: Math.floor(Date.now() / 1000) + 7200,
      purpose: "Implementing sub-cent rounding guard"
    },
    {
      node_id: "idempotency-key-hasher",
      mission_id: "m-billing-v2",
      agent_id: "subagent-proration",
      acquired_at: "2026-10-26T09:00:00Z",
      expires_at: Math.floor(Date.now() / 1000) + 7200,
      purpose: "Hardening SHA256 key generator"
    },
    {
      node_id: "realtime-presence",
      mission_id: "m-realtime-scale",
      agent_id: "subagent-infra",
      acquired_at: "2026-10-26T08:00:00Z",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      purpose: "Auditing heartbeat timers"
    }
  ]
});

// 1.15 Materialized Tripwires Manifest (.afwe/guardrails/manifest.yaml)
write(path.join(demoAfwe, 'guardrails/manifest.yaml'), `version: 1
generated_at: "2026-10-26T10:00:00Z"
entries:
  .afwe/guardrails/generated_checks_test.sh: "b3_5f91a0c441b2"
  .afwe/guardrails/pre-commit: "b3_7e20b1c93a04"
  .github/workflows/afwe-gate.yml: "b3_8d44e12c40ff"
`);

write(path.join(demoAfwe, 'guardrails/generated_checks_test.sh'), `#!/usr/bin/env sh
# Generated by afwe materialize — deterministic architectural tripwire runner
set -e
afwe gate --ci
`);

// Ensure all dummy modules are reachable from their parent directory index.ts
function wireReExports(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      wireReExports(full);
    } else if (e.name === 'index.ts') {
      let content = fs.readFileSync(full, 'utf8');
      let modified = false;
      const mod2 = path.join(dir, 'mod_2.ts');
      const mod3 = path.join(dir, 'mod_3.ts');
      if (fs.existsSync(mod2) && !content.includes('mod_2')) {
        content += '\nexport * from "./mod_2";\n';
        modified = true;
      }
      if (fs.existsSync(mod3) && !content.includes('mod_3')) {
        content += '\nexport * from "./mod_3";\n';
        modified = true;
      }
      if (modified) {
        fs.writeFileSync(full, content, 'utf8');
      }
    }
  }
}
wireReExports(path.join(demoRoot, 'src'));

// Wire preview, search, and colorWheel into Core
const coreIndex = path.join(demoRoot, 'src/core/index.ts');
if (fs.existsSync(coreIndex)) {
  let cc = fs.readFileSync(coreIndex, 'utf8');
  if (!cc.includes('ColorWheel')) {
    cc += '\nexport * from "../workspace/tagging/ColorWheel";\n';
    cc += 'export * from "../workspace/search/Search";\n';
    cc += 'export * from "../workspace/preview/Preview";\n';
    fs.writeFileSync(coreIndex, cc, 'utf8');
  }
}

console.log("demo-project fully populated with 3-day history exercising all ReBorn features >= 3 times.");

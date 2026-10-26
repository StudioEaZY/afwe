const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function write(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
}

const funnelRoot = path.resolve('examples/multi-intent-funnel');
const funnelAfwe = path.join(funnelRoot, '.afwe');

// 2.1 Codebase Expansion: Stages 1..4, unmapped folders, and 3 constraint violations
// Stage 1 (acquisition)
write(path.join(funnelRoot, 'src/Slide1.tsx'), `import React from 'react';
import { trackUtmVisit } from './acquisition/utmTracker';

export const Slide1: React.FC = () => {
  React.useEffect(() => {
    trackUtmVisit('hero-header', 'direct');
  }, []);

  return (
    <div className="slide slide-hero">
      <h1>Accelerate Your Software Evolution</h1>
      <p>Deterministic architecture governance for autonomous engineering agents.</p>
      <button className="cta-btn">Calculate Your ROI</button>
    </div>
  );
};
`);

write(path.join(funnelRoot, 'src/Slide2.tsx'), `import React from 'react';
import { calculateRoiSavings } from './acquisition/roiCalculator';
// ARCHITECTURAL VIOLATION 1: Acquisition UI layer illegally importing conversion pricing engine!
import { calculateTierPrice } from './conversion/pricingEngine';

export const Slide2: React.FC = () => {
  const [engineers, setEngineers] = React.useState(25);
  const savings = calculateRoiSavings(engineers);
  const tierCost = calculateTierPrice('enterprise', engineers);

  return (
    <div className="slide slide-roi">
      <h2>Interactive Engineering ROI Benchmark</h2>
      <input type="range" min={5} max={200} value={engineers} onChange={e => setEngineers(Number(e.target.value))} />
      <p>Estimated annual developer hours saved: {savings.hours}h (\${savings.dollars})</p>
      <p>Projected plan cost: \${tierCost}</p>
    </div>
  );
};
`);

write(path.join(funnelRoot, 'src/acquisition/utmTracker.ts'), `// acquisition stage: utm tracking
export function trackUtmVisit(campaign: string, source: string): { tracked: boolean; timestamp: number } {
  return { tracked: true, timestamp: Date.now() };
}
`);

write(path.join(funnelRoot, 'src/acquisition/roiCalculator.ts'), `// acquisition stage: roi calculation
export function calculateRoiSavings(engineerCount: number): { hours: number; dollars: number } {
  const hours = engineerCount * 180;
  const dollars = hours * 95;
  return { hours, dollars };
}
`);

// Stage 2 (activation)
write(path.join(funnelRoot, 'src/Slide3.tsx'), `import React from 'react';
import { getFunnelState, updateFunnelSeatCount } from './activation/funnelState';

export const Slide3: React.FC = () => {
  const [seats, setSeats] = React.useState(10);

  const handleUpdate = (val: number) => {
    setSeats(val);
    updateFunnelSeatCount(val);
  };

  return (
    <div className="slide slide-seats">
      <h2>Configure Team Workspace Seats</h2>
      <button onClick={() => handleUpdate(seats + 5)}>Add 5 Seats</button>
      <p>Current active seats selected: {seats}</p>
    </div>
  );
};
`);

write(path.join(funnelRoot, 'src/Slide4.tsx'), `import React from 'react';
// ARCHITECTURAL VIOLATION 2: Activation security slide bypassing telemetry buffer and directly reading raw event sink!
import { RawEventSink } from './telemetry/eventSink';

export const Slide4: React.FC = () => {
  const sink = new RawEventSink();
  sink.record('soc2_checklist_viewed');

  return (
    <div className="slide slide-security">
      <h2>Enterprise SOC2 & Security Compliance</h2>
      <ul>
        <li>Deterministic tree-sitter AST invariants</li>
        <li>No external API keys in engine core</li>
        <li>Tamper-proof BLAKE3 manifest enforcement</li>
      </ul>
    </div>
  );
};
`);

write(path.join(funnelRoot, 'src/activation/funnelState.ts'), `// activation stage: state management
export interface FunnelState {
  step: number;
  seats: number;
  tier: string;
}

let globalState: FunnelState = { step: 1, seats: 5, tier: 'pro' };

export function getFunnelState(): FunnelState {
  return globalState;
}

export function updateFunnelSeatCount(seats: number): void {
  globalState.seats = seats;
}
`);

// Stage 3 (conversion)
write(path.join(funnelRoot, 'src/Slide5.tsx'), `import React from 'react';
import { calculateTierPrice } from './conversion/pricingEngine';

export const Slide5: React.FC = () => {
  const [tier, setTier] = React.useState<'starter' | 'pro' | 'enterprise'>('pro');

  return (
    <div className="slide slide-pricing">
      <h2>Select Your Architecture Governance Tier</h2>
      <button onClick={() => setTier('starter')}>Starter (\$49)</button>
      <button onClick={() => setTier('pro')}>Pro (\$199)</button>
      <button onClick={() => setTier('enterprise')}>Enterprise (Custom)</button>
      <p>Selected tier monthly cost: \${calculateTierPrice(tier, 10)}</p>
    </div>
  );
};
`);

write(path.join(funnelRoot, 'src/Slide6.tsx'), `import React from 'react';
import { mountStripeElements } from './conversion/stripeElements';
// ARCHITECTURAL VIOLATION 3: Checkout slide importing acquisition UTM tracker internals!
import { trackUtmVisit } from './acquisition/utmTracker';

export const Slide6: React.FC = () => {
  React.useEffect(() => {
    mountStripeElements('card-element-container');
    trackUtmVisit('checkout-direct', 'funnel');
  }, []);

  return (
    <div className="slide slide-checkout">
      <h2>Instant Cloud Provisioning & Checkout</h2>
      <div id="card-element-container"></div>
      <button className="provision-btn">Start 14-Day Free Evaluation</button>
    </div>
  );
};
`);

write(path.join(funnelRoot, 'src/conversion/pricingEngine.ts'), `// conversion stage: pricing engine
export function calculateTierPrice(tier: string, seats: number): number {
  switch (tier) {
    case 'starter': return 49 + (seats * 10);
    case 'pro': return 199 + (seats * 15);
    case 'enterprise': return 999 + (seats * 25);
    default: return 99;
  }
}
`);

write(path.join(funnelRoot, 'src/conversion/stripeElements.ts'), `// conversion stage: stripe elements mounting
export function mountStripeElements(containerId: string): { mounted: boolean } {
  return { mounted: true };
}
`);

// Stage 4 (telemetry)
write(path.join(funnelRoot, 'src/telemetry/eventSink.ts'), `// telemetry stage: event sink
export class RawEventSink {
  private events: string[] = [];

  record(event: string): void {
    this.events.push(event);
  }

  getEvents(): string[] {
    return this.events;
  }
}
`);

write(path.join(funnelRoot, 'src/telemetry/abCohort.ts'), `// telemetry stage: ab cohort allocation
export function assignFunnelCohort(visitorId: string): 'variant-A' | 'variant-B' {
  let hash = 0;
  for (let i = 0; i < visitorId.length; i++) hash = visitorId.charCodeAt(i) + ((hash << 5) - hash);
  return (Math.abs(hash) % 2 === 0) ? 'variant-A' : 'variant-B';
}
`);

// 4 Unmapped folders (with real code)
write(path.join(funnelRoot, 'src/unmapped-experiments/exitIntentModal.tsx'), `// UNCHARTED: unmapped-experiments
import React from 'react';

export const ExitIntentModal: React.FC = () => {
  return <div>Wait! Claim your free architecture audit before leaving.</div>;
};
`);

write(path.join(funnelRoot, 'src/legacy-pixel/fbPixel.ts'), `// UNCHARTED: legacy-pixel
export function trackLegacyFacebookPixel(event: string): void {
  console.log("Legacy pixel event dispatched:", event);
}
`);

write(path.join(funnelRoot, 'src/affiliate-webhook/partnerPostback.ts'), `// UNCHARTED: affiliate-webhook
export function sendPartnerPostback(clickId: string, payout: number): { sent: boolean } {
  return { sent: true };
}
`);

write(path.join(funnelRoot, 'src/seo-scraper/metaHydrator.ts'), `// UNCHARTED: seo-scraper
export function hydrateMetaTags(title: string, description: string): void {
  // SEO tags
}
`);

// 2.2 AFWE Configuration (.afwe/afwe.yaml)
write(path.join(funnelAfwe, 'afwe.yaml'), `version: 1
project:
  name: Multi-Intent Funnel
  description: Growth & Conversion Funnel Engine for AFWE
  root: .
analyzer:
  include: []
  ignore:
  - .afwe/**
  - node_modules/**
  - dist/**
  - build/**
  max_file_size_kb: 512
  languages: []
policy:
  auto_reconcile: 0.85
  propose_review: 0.5
  ignore_below: 0.3
pin_policy:
  slider: 3
vcs:
  provider: git
  auto_commit: true
provenance:
  retain_prompts: true
`);

// 2.3 Blueprint: 5 nested levels (L0 'funnel' -> L1 'stage' -> L2 'module' -> L3 'variation' -> L4 'widget')
write(path.join(funnelAfwe, 'blueprint/blueprint.yaml'), `nodes:
- id: growth-funnel
  name: Growth Funnel
  kind: funnel
  purpose: Multi-intent prospective developer acquisition, activation, and checkout funnel.
  status: active
  origin: human
  children:
  - id: acquisition-stage
    name: Acquisition Stage
    kind: stage
    purpose: Top-of-funnel traffic attribution, hero landing, and interactive ROI benchmarking.
    status: active
    origin: human
    implements:
      files:
      - src/Slide1.tsx
      - src/acquisition/**
    children:
    - id: hero-experience
      name: Hero Experience
      kind: module
      purpose: Main headline, elevator pitch, and value proposition delivery.
      status: active
      implements:
        files:
        - src/Slide1.tsx
      children:
      - id: hero-variant-a
        name: Hero Variant A
        kind: variation
        purpose: Technical developer-first copy emphasis.
        status: active
      - id: hero-variant-b
        name: Hero Variant B
        kind: variation
        purpose: Executive ROI and velocity focus.
        status: active
        children:
        - id: hero-badge-animator
          name: Hero Badge Animator
          kind: widget
          purpose: Interactive SVG animated metric ticker.
          status: active
    - id: roi-benchmark
      name: ROI Benchmark
      kind: module
      purpose: Dynamic developer salary and hours-saved calculation calculator.
      status: active
      implements:
        files:
        - src/acquisition/roiCalculator.ts
    - id: traffic-attribution
      name: Traffic Attribution
      kind: module
      purpose: Ingestion and sanitization of UTM campaign query parameters.
      status: active
      implements:
        files:
        - src/acquisition/utmTracker.ts
    - id: slide-2-social-proof
      name: Slide 2 Social Proof
      kind: module
      purpose: Customer logo marquee and developer quote carousel.
      status: active

  - id: activation-stage
    name: Activation Stage
    kind: stage
    purpose: Interactive seat configuration and compliance qualification.
    status: active
    origin: human
    implements:
      files:
      - src/Slide3.tsx
      - src/Slide4.tsx
      - src/activation/**
    children:
    - id: seat-configurator
      name: Seat Configurator
      kind: module
      purpose: Slider controls for engineering team sizing and license volume.
      status: active
      implements:
        files:
        - src/Slide3.tsx
        - src/activation/funnelState.ts
      children:
      - id: seat-volume-matrix
        name: Seat Volume Matrix
        kind: variation
        purpose: Discount curve applied based on active seat volume.
        status: active
      - id: seat-slider-stepper
        name: Seat Slider Stepper
        kind: variation
        purpose: Step increments with visual tooltip guidance.
        status: active
        children:
        - id: seat-tooltip-badge
          name: Seat Tooltip Badge
          kind: widget
          purpose: Displays per-seat discount percentage pill.
          status: active
    - id: security-qualification
      name: Security Qualification
      kind: module
      purpose: SOC2 and air-gapped deterministic engine verification checklist.
      status: active
      implements:
        files:
        - src/Slide4.tsx
    - id: slide-3-roi-calculator
      name: Slide 3 ROI Calculator
      kind: module
      purpose: Historical embedded calculator widget prior to slide consolidation.
      status: active

  - id: conversion-stage
    name: Conversion Stage
    kind: stage
    purpose: Pricing tier matrix, Stripe payment elements, and instant provisioning.
    status: active
    origin: human
    implements:
      files:
      - src/Slide5.tsx
      - src/Slide6.tsx
      - src/conversion/**
    children:
    - id: pricing-tiers
      name: Pricing Tiers
      kind: module
      purpose: Dynamic plan tier cards (Starter, Pro, Enterprise).
      status: active
      implements:
        files:
        - src/Slide5.tsx
        - src/conversion/pricingEngine.ts
      children:
      - id: tier-card-toggle
        name: Tier Card Toggle
        kind: variation
        purpose: Monthly versus annual billing toggle switch.
        status: active
      - id: enterprise-quote-modal
        name: Enterprise Quote Modal
        kind: variation
        purpose: Contact sales form for custom cluster volume.
        status: active
        children:
        - id: currency-symbol-pill
          name: Currency Symbol Pill
          kind: widget
          purpose: Multi-currency currency prefix formatter ($ / € / £).
          status: active
    - id: stripe-checkout
      name: Stripe Checkout
      kind: module
      purpose: Secure credit card input and checkout tokenization.
      status: active
      implements:
        files:
        - src/Slide6.tsx
        - src/conversion/stripeElements.ts

  - id: telemetry-stage
    name: Telemetry Stage
    kind: stage
    purpose: Behavioral event sink and A/B test cohort distribution.
    status: active
    origin: human
    implements:
      files:
      - src/telemetry/**
    children:
    - id: behavioral-event-sink
      name: Behavioral Event Sink
      kind: module
      purpose: In-memory and beacon dispatch for user step progressions.
      status: active
      implements:
        files:
        - src/telemetry/eventSink.ts
    - id: ab-cohort-router
      name: A/B Cohort Router
      kind: module
      purpose: Consistent hash assignment to Funnel Variant A or B.
      status: active
      implements:
        files:
        - src/telemetry/abCohort.ts
    - id: ab-cohort-sticky-cookie
      name: A/B Cohort Sticky Cookie
      kind: module
      purpose: Historical client cookie persistence for 30-day cohort stickiness.
      status: active
`);

// 2.4 Relations: 12 declared + 4 inferred
write(path.join(funnelAfwe, 'blueprint/relations.yaml'), `relations:
- id: rel-hero-utm
  from: hero-experience
  to: traffic-attribution
  kind: calls
- id: rel-hero-roi
  from: hero-experience
  to: roi-benchmark
  kind: calls
- id: rel-badge-animator
  from: hero-variant-b
  to: hero-badge-animator
  kind: calls
- id: rel-seat-state
  from: seat-configurator
  to: seat-volume-matrix
  kind: calls
- id: rel-seat-tooltip
  from: seat-slider-stepper
  to: seat-tooltip-badge
  kind: calls
- id: rel-pricing-tiers
  from: pricing-tiers
  to: tier-card-toggle
  kind: calls
- id: rel-currency-pill
  from: enterprise-quote-modal
  to: currency-symbol-pill
  kind: calls
- id: rel-checkout-stripe
  from: stripe-checkout
  to: pricing-tiers
  kind: reads
- id: rel-slide1-telemetry
  from: hero-experience
  to: behavioral-event-sink
  kind: publishes
- id: rel-slide3-telemetry
  from: seat-configurator
  to: behavioral-event-sink
  kind: publishes
- id: rel-slide5-telemetry
  from: pricing-tiers
  to: behavioral-event-sink
  kind: publishes
- id: rel-slide6-telemetry
  from: stripe-checkout
  to: behavioral-event-sink
  kind: publishes
- id: inf-ab-hero
  from: ab-cohort-router
  to: hero-experience
  kind: reads
  inferred: true
- id: inf-pricing-ab
  from: pricing-tiers
  to: ab-cohort-router
  kind: reads
  inferred: true
- id: inf-checkout-utm
  from: stripe-checkout
  to: traffic-attribution
  kind: reads
  inferred: true
- id: inf-security-sink
  from: security-qualification
  to: behavioral-event-sink
  kind: publishes
  inferred: true
`);

// 2.5 Constraints: 4 constraints
write(path.join(funnelAfwe, 'blueprint/constraints.yaml'), `constraints:
- id: c-acquisition-no-conversion
  rule: must_not_depend
  from: acquisition-stage
  to:
  - conversion-stage
  rationale: Acquisition slides must not directly import checkout or payment processing engines.
  severity: error
- id: c-activation-no-raw-sink
  rule: must_not_depend
  from: activation-stage
  to:
  - telemetry-stage
  rationale: Activation slides must dispatch events through event bus, never instantiate RawEventSink directly.
  severity: error
- id: c-checkout-no-acquisition-internals
  rule: must_not_depend
  from: stripe-checkout
  to:
  - traffic-attribution
  rationale: Stripe checkout elements must remain isolated from raw UTM query parsing logic.
  severity: error
- id: c-telemetry-pure-headless
  rule: must_not_depend
  from: telemetry-stage
  to:
  - conversion-stage
  rationale: Telemetry sink must remain headless and never depend on checkout or UI presentation state.
  severity: error
`);

// 2.6 Pins: 10 pins (4 active block, 3 confirm/proposed, 3 retired)
const funnelPins = [
  {
    id: "pin-ab-cohort-sticky",
    statement: "Visitors must remain in their initial A/B cohort for 30 days without re-randomization.",
    kind: "intentional",
    attaches: { nodes: ["ab-cohort-router"] },
    severity: "block",
    status: "active",
    origin: "human:growth-lead",
    created: "2026-10-23T08:00:00Z",
    reason: "prevent-split-test-contamination",
    intentional: true
  },
  {
    id: "pin-pricing-transparency",
    statement: "Pricing tier prices must be computed dynamically with zero hardcoded secret discounts in client DOM.",
    kind: "constraint",
    attaches: { nodes: ["pricing-tiers"] },
    severity: "block",
    status: "active",
    origin: "human:founder",
    created: "2026-10-23T08:30:00Z",
    reason: "brand-trust-invariant"
  },
  {
    id: "pin-stripe-pci-isolation",
    statement: "Credit card digits must only be collected inside Stripe-hosted iframes; plain input fields forbidden.",
    kind: "constraint",
    attaches: { nodes: ["stripe-checkout"] },
    severity: "block",
    status: "active",
    origin: "human:secops",
    created: "2026-10-23T09:00:00Z",
    reason: "pci-dss-compliance"
  },
  {
    id: "pin-single-page-smooth-scroll",
    statement: "Funnel slide navigation must use CSS smooth scrolling with no full-page reloads.",
    kind: "preference",
    attaches: { nodes: ["growth-funnel"] },
    severity: "confirm",
    status: "active",
    origin: "human:designer",
    created: "2026-10-24T10:00:00Z",
    reason: "seamless-conversion-ux"
  },
  {
    id: "pin-utm-storage-policy",
    statement: "UTM campaign tags must be stored in sessionStorage rather than persistent cookies.",
    kind: "decision",
    attaches: { nodes: ["traffic-attribution"] },
    severity: "confirm",
    status: "active",
    origin: "human:legal",
    created: "2026-10-24T11:00:00Z",
    reason: "gdpr-e-privacy-compliance"
  },
  {
    id: "pin-exit-intent-cooldown",
    statement: "Exit intent popup must not trigger more than once per user session with minimum 10s delay.",
    kind: "decision",
    attaches: { nodes: ["growth-funnel"] },
    severity: "confirm",
    status: "proposed",
    origin: "human:cro-consultant",
    created: "2026-10-25T14:00:00Z",
    reason: "prevent-annoying-modal-fatigue"
  },
  {
    id: "pin-legacy-tracking-pixel",
    statement: "Facebook legacy pixel must fire on every slide view.",
    kind: "preference",
    attaches: { nodes: ["telemetry-stage"] },
    severity: "warn",
    status: "retired",
    origin: "human:legacy-marketer",
    created: "2026-10-23T07:00:00Z",
    retired: "2026-10-24T08:00:00Z",
    reason: "migrated-to-server-side-capi"
  },
  {
    id: "pin-hardcoded-starter-price",
    statement: "Starter plan fixed at $29/mo with max 3 seats.",
    kind: "decision",
    attaches: { nodes: ["pricing-tiers"] },
    severity: "confirm",
    status: "retired",
    origin: "human:pm",
    created: "2026-10-23T07:30:00Z",
    retired: "2026-10-24T12:00:00Z",
    reason: "repositioned-to-usage-pricing"
  },
  {
    id: "pin-auto-advance-slides",
    statement: "Slide automatically advances after 8 seconds of user inactivity.",
    kind: "preference",
    attaches: { nodes: ["growth-funnel"] },
    severity: "block",
    status: "retired",
    origin: "human:design-agency",
    created: "2026-10-23T06:30:00Z",
    retired: "2026-10-25T09:00:00Z",
    reason: "caused-high-bounce-rate"
  },
  {
    id: "pin-currency-rounding-usd-only",
    statement: "Funnel checkout only supports US Dollar pricing.",
    kind: "decision",
    attaches: { nodes: ["pricing-tiers", "stripe-checkout"] },
    severity: "block",
    status: "retired",
    origin: "human:founder",
    created: "2026-10-23T06:00:00Z",
    retired: "2026-10-25T15:00:00Z",
    reason: "expanded-to-eur-gbp-jpy"
  }
];

funnelPins.forEach(p => {
  write(path.join(funnelAfwe, 'pins', `${p.id}.yaml`), p);
});

// 2.7 Standing Checks: 15 checks
const funnelChecks = [
  // 3 forbid_import
  {
    id: "chk-no-conversion-in-acquisition",
    title: "acquisition does not import conversion-stage",
    trust: "deterministic",
    authored_by: "checkgen",
    attaches: { nodes: ["acquisition-stage", "conversion-stage"] },
    claim: {
      type: "forbid_import",
      files: ["src/acquisition/**", "src/Slide1.tsx", "src/Slide2.tsx"],
      to_nodes: ["conversion-stage"]
    },
    status: "active",
    origin: "afwe:checkgen",
    created: "2026-10-23T10:00:00Z",
    created_from: "t0002",
    provenance: "confirmed"
  },
  {
    id: "chk-no-raw-sink-in-activation",
    title: "activation does not import eventSink raw class",
    trust: "deterministic",
    authored_by: "checkgen",
    attaches: { nodes: ["activation-stage", "telemetry-stage"] },
    claim: {
      type: "forbid_import",
      files: ["src/activation/**", "src/Slide3.tsx", "src/Slide4.tsx"],
      to_nodes: ["telemetry-stage"]
    },
    status: "active",
    origin: "afwe:checkgen",
    created: "2026-10-23T11:00:00Z",
    created_from: "t0002",
    provenance: "confirmed"
  },
  {
    id: "chk-no-utm-in-checkout",
    title: "stripe checkout does not import utmTracker",
    trust: "deterministic",
    authored_by: "checkgen",
    attaches: { nodes: ["stripe-checkout", "traffic-attribution"] },
    claim: {
      type: "forbid_import",
      files: ["src/conversion/stripeElements.ts", "src/Slide6.tsx"],
      to_nodes: ["traffic-attribution"]
    },
    status: "active",
    origin: "afwe:checkgen",
    created: "2026-10-23T12:00:00Z",
    created_from: "t0003",
    provenance: "confirmed"
  },
  // 3 forbid_symbol
  {
    id: "chk-forbid-alert-prompt",
    title: "forbid window.alert or prompt in interactive funnel slides",
    trust: "deterministic",
    authored_by: "checkgen",
    attaches: { nodes: ["growth-funnel"] },
    claim: {
      type: "forbid_pattern",
      pattern: "\\bwindow\\.(alert|prompt|confirm)\\s*\\(",
      files: ["src/**/*.tsx"]
    },
    status: "active",
    origin: "afwe:checkgen",
    created: "2026-10-24T09:00:00Z",
    created_from: "t0004",
    provenance: "confirmed"
  },
  {
    id: "chk-forbid-document-cookie-utm",
    title: "forbid direct document.cookie assignment in utm tracker",
    trust: "deterministic",
    authored_by: "checkgen",
    attaches: { nodes: ["traffic-attribution"] },
    claim: {
      type: "forbid_pattern",
      pattern: "document\\.cookie\\s*=",
      files: ["src/acquisition/utmTracker.ts"]
    },
    status: "active",
    origin: "afwe:checkgen",
    created: "2026-10-24T10:00:00Z",
    created_from: "t0004",
    provenance: "confirmed"
  },
  {
    id: "chk-forbid-card-input-element",
    title: "forbid raw credit card input elements outside stripe container",
    trust: "deterministic",
    authored_by: "checkgen",
    attaches: { nodes: ["stripe-checkout"] },
    claim: {
      type: "forbid_pattern",
      pattern: '<input[^>]*name=["\'](cardnumber|cc-num|cvv)["\']',
      files: ["src/**/*.tsx"]
    },
    status: "active",
    origin: "afwe:checkgen",
    created: "2026-10-24T14:00:00Z",
    created_from: "t0005",
    provenance: "confirmed"
  },
  // 3 export_exists
  {
    id: "chk-export-calculate-tier-price",
    title: "calculateTierPrice export exists in pricingEngine.ts",
    trust: "deterministic",
    authored_by: "checkgen",
    attaches: { nodes: ["pricing-tiers"] },
    claim: {
      type: "export_exists",
      symbol: "src/conversion/pricingEngine.ts::calculateTierPrice"
    },
    status: "active",
    origin: "afwe:checkgen",
    created: "2026-10-23T10:30:00Z",
    created_from: "t0002",
    provenance: "graduated"
  },
  {
    id: "chk-export-assign-cohort",
    title: "assignFunnelCohort export exists in abCohort.ts",
    trust: "deterministic",
    authored_by: "checkgen",
    attaches: { nodes: ["ab-cohort-router"] },
    claim: {
      type: "export_exists",
      symbol: "src/telemetry/abCohort.ts::assignFunnelCohort"
    },
    status: "active",
    origin: "afwe:checkgen",
    created: "2026-10-24T11:00:00Z",
    created_from: "t0004",
    provenance: "graduated"
  },
  {
    id: "chk-export-calculate-roi",
    title: "calculateRoiSavings export exists in roiCalculator.ts",
    trust: "deterministic",
    authored_by: "checkgen",
    attaches: { nodes: ["roi-benchmark"] },
    claim: {
      type: "export_exists",
      symbol: "src/acquisition/roiCalculator.ts::calculateRoiSavings"
    },
    status: "active",
    origin: "afwe:checkgen",
    created: "2026-10-24T15:00:00Z",
    created_from: "t0005",
    provenance: "graduated"
  },
  // 3 symbol_signature
  {
    id: "chk-sig-calculate-tier",
    title: "calculateTierPrice takes string and number returning number",
    trust: "deterministic",
    authored_by: "checkgen",
    attaches: { nodes: ["pricing-tiers"] },
    claim: {
      type: "symbol_signature",
      symbol: "src/conversion/pricingEngine.ts::calculateTierPrice",
      pattern: "\\(tier:\\s*string,\\s*seats:\\s*number\\):\\s*number"
    },
    status: "active",
    origin: "afwe:checkgen",
    created: "2026-10-24T16:00:00Z",
    created_from: "t0005",
    provenance: "confirmed"
  },
  {
    id: "chk-sig-track-utm",
    title: "trackUtmVisit signature takes campaign and source",
    trust: "deterministic",
    authored_by: "checkgen",
    attaches: { nodes: ["traffic-attribution"] },
    claim: {
      type: "symbol_signature",
      symbol: "src/acquisition/utmTracker.ts::trackUtmVisit",
      pattern: "\\(campaign:\\s*string,\\s*source:\\s*string\\)"
    },
    status: "active",
    origin: "afwe:checkgen",
    created: "2026-10-25T10:00:00Z",
    created_from: "t0006",
    provenance: "confirmed"
  },
  {
    id: "chk-sig-assign-cohort",
    title: "assignFunnelCohort signature takes visitorId string",
    trust: "deterministic",
    authored_by: "checkgen",
    attaches: { nodes: ["ab-cohort-router"] },
    claim: {
      type: "symbol_signature",
      symbol: "src/telemetry/abCohort.ts::assignFunnelCohort",
      pattern: "\\(visitorId:\\s*string\\)"
    },
    status: "active",
    origin: "afwe:checkgen",
    created: "2026-10-25T11:00:00Z",
    created_from: "t0006",
    provenance: "confirmed"
  },
  // 3 superseded checks
  {
    id: "chk-superseded-cookie-stickiness",
    title: "A/B cohort stickiness verified through document.cookie writes",
    trust: "deterministic",
    authored_by: "checkgen",
    attaches: { nodes: ["ab-cohort-sticky-cookie"] },
    claim: {
      type: "require_file",
      files: ["src/telemetry/cookieStorage.ts"]
    },
    status: "superseded",
    superseded_by: "chk-export-assign-cohort",
    origin: "afwe:checkgen",
    created: "2026-10-23T08:00:00Z",
    created_from: "t0001",
    provenance: "confirmed"
  },
  {
    id: "chk-superseded-social-proof-marquee",
    title: "social proof marquee renders 8 partner SVG assets",
    trust: "deterministic",
    authored_by: "checkgen",
    attaches: { nodes: ["slide-2-social-proof"] },
    claim: {
      type: "require_file",
      files: ["src/acquisition/logos.svg"]
    },
    status: "superseded",
    superseded_by: "t0003",
    origin: "afwe:checkgen",
    created: "2026-10-23T08:30:00Z",
    created_from: "t0001",
    provenance: "confirmed"
  },
  {
    id: "chk-superseded-embedded-roi-calc",
    title: "slide 3 embedded calculator mounts web worker thread",
    trust: "deterministic",
    authored_by: "checkgen",
    attaches: { nodes: ["slide-3-roi-calculator"] },
    claim: {
      type: "require_file",
      files: ["src/activation/calculatorWorker.ts"]
    },
    status: "superseded",
    superseded_by: "t0004",
    origin: "afwe:checkgen",
    created: "2026-10-23T09:00:00Z",
    created_from: "t0001",
    provenance: "confirmed"
  }
];

funnelChecks.forEach(c => {
  write(path.join(funnelAfwe, 'checks', `${c.id}.yaml`), c);
});

// 2.8 Calibration State: state/calibration.json
write(path.join(funnelAfwe, 'state/calibration.json'), {
  models: {
    "claude-sonnet-4-5": {
      model_id: "claude-sonnet-4-5",
      human_accepted: 21,
      human_rejected: 1,
      trust_factor: 1.08,
      updated_at: "2026-10-26T09:00:00Z"
    },
    "gpt-4o": {
      model_id: "gpt-4o",
      human_accepted: 15,
      human_rejected: 4,
      trust_factor: 0.95,
      updated_at: "2026-10-26T09:15:00Z"
    },
    "gemini-2-5-pro": {
      model_id: "gemini-2-5-pro",
      human_accepted: 19,
      human_rejected: 2,
      trust_factor: 1.04,
      updated_at: "2026-10-26T09:30:00Z"
    }
  },
  guides: [
    // 3 probing guides (85%-90%)
    {
      id: "guide-ab-hash-modulo",
      title: "cohort hash uses modulo 2 division for balanced 50/50 split",
      status: "probing",
      score: 0.89,
      claim: {
        type: "require_pattern",
        pattern: "Math\\.abs\\(hash\\)\\s*%\\s*2",
        files: ["src/telemetry/abCohort.ts"]
      },
      attaches: { nodes: ["ab-cohort-router"] },
      probes: [
        { turn: "t0006", session_id: "sess-funnel-1", symbol: "src/telemetry/abCohort.ts::assignFunnelCohort", held_out: true },
        { turn: "t0007", session_id: "sess-funnel-2", symbol: "src/telemetry/abCohort.ts::assignFunnelCohort", held_out: false }
      ],
      contradictions: 0,
      provenance: "inferred",
      origin: "llm:claude-sonnet-4-5",
      created: "2026-10-24T10:00:00Z",
      created_from: "t0004"
    },
    {
      id: "guide-session-storage-utm",
      title: "attribution parameters stored strictly in sessionStorage",
      status: "probing",
      score: 0.86,
      claim: {
        type: "forbid_pattern",
        pattern: "localStorage\\.setItem\\(['\"]utm_",
        files: ["src/acquisition/**"]
      },
      attaches: { nodes: ["traffic-attribution"] },
      probes: [
        { turn: "t0005", session_id: "sess-utm-1", symbol: "src/acquisition/utmTracker.ts::trackUtmVisit", held_out: false },
        { turn: "t0006", session_id: "sess-utm-2", symbol: "src/acquisition/utmTracker.ts::trackUtmVisit", held_out: true }
      ],
      contradictions: 0,
      provenance: "inferred",
      origin: "llm:gpt-4o",
      created: "2026-10-24T12:00:00Z",
      created_from: "t0004"
    },
    {
      id: "guide-tier-pricing-floor",
      title: "seat pricing calculation never yields negative values",
      status: "probing",
      score: 0.87,
      claim: {
        type: "forbid_pattern",
        pattern: "seats\\s*<\\s*0",
        files: ["src/conversion/pricingEngine.ts"]
      },
      attaches: { nodes: ["pricing-tiers"] },
      probes: [
        { turn: "t0006", session_id: "sess-price-1", symbol: "src/conversion/pricingEngine.ts::calculateTierPrice", held_out: true }
      ],
      contradictions: 0,
      provenance: "inferred",
      origin: "llm:gemini-2-5-pro",
      created: "2026-10-25T09:00:00Z",
      created_from: "t0005"
    },
    // 3 ready_to_graduate guides
    {
      id: "guide-roi-rate-constant",
      title: "developer hourly billing benchmark standard set at $95",
      status: "ready_to_graduate",
      score: 0.96,
      claim: {
        type: "require_pattern",
        pattern: "hours\\s*\\*\\s*95",
        files: ["src/acquisition/roiCalculator.ts"]
      },
      attaches: { nodes: ["roi-benchmark"] },
      probes: [
        { turn: "t0004", session_id: "sess-roi-a", symbol: "src/acquisition/roiCalculator.ts::calculateRoiSavings", held_out: true },
        { turn: "t0005", session_id: "sess-roi-b", symbol: "src/acquisition/roiCalculator.ts::calculateRoiSavings", held_out: false },
        { turn: "t0006", session_id: "sess-roi-c", symbol: "src/acquisition/roiCalculator.ts::calculateRoiSavings", held_out: true }
      ],
      contradictions: 0,
      provenance: "inferred",
      origin: "llm:claude-sonnet-4-5",
      created: "2026-10-24T11:00:00Z",
      created_from: "t0004"
    },
    {
      id: "guide-state-seat-increment",
      title: "seat selection update sets seats property on state object",
      status: "ready_to_graduate",
      score: 0.94,
      claim: {
        type: "require_pattern",
        pattern: "globalState\\.seats\\s*=\\s*seats",
        files: ["src/activation/funnelState.ts"]
      },
      attaches: { nodes: ["seat-configurator"] },
      probes: [
        { turn: "t0004", session_id: "sess-state-1", symbol: "src/activation/funnelState.ts::updateFunnelSeatCount", held_out: false },
        { turn: "t0005", session_id: "sess-state-2", symbol: "src/activation/funnelState.ts::updateFunnelSeatCount", held_out: true },
        { turn: "t0006", session_id: "sess-state-3", symbol: "src/activation/funnelState.ts::updateFunnelSeatCount", held_out: true }
      ],
      contradictions: 0,
      provenance: "inferred",
      origin: "llm:claude-sonnet-4-5",
      created: "2026-10-24T11:30:00Z",
      created_from: "t0004"
    },
    {
      id: "guide-stripe-container-id",
      title: "stripe mounting element targets card-element-container",
      status: "ready_to_graduate",
      score: 0.93,
      claim: {
        type: "require_pattern",
        pattern: "card-element-container",
        files: ["src/Slide6.tsx"]
      },
      attaches: { nodes: ["stripe-checkout"] },
      probes: [
        { turn: "t0005", session_id: "sess-chk-1", symbol: "src/Slide6.tsx::Slide6", held_out: true },
        { turn: "t0006", session_id: "sess-chk-2", symbol: "src/Slide6.tsx::Slide6", held_out: false },
        { turn: "t0007", session_id: "sess-chk-3", symbol: "src/Slide6.tsx::Slide6", held_out: true }
      ],
      contradictions: 0,
      provenance: "inferred",
      origin: "llm:gemini-2-5-pro",
      created: "2026-10-25T08:00:00Z",
      created_from: "t0005"
    },
    // 3 graduated guides
    {
      id: "guide-pricing-engine-graduated",
      title: "calculateTierPrice export exists in pricingEngine.ts",
      status: "graduated",
      score: 0.99,
      claim: {
        type: "export_exists",
        symbol: "src/conversion/pricingEngine.ts::calculateTierPrice"
      },
      attaches: { nodes: ["pricing-tiers"] },
      probes: [
        { turn: "t0002", session_id: "sess-p1", symbol: "src/conversion/pricingEngine.ts::calculateTierPrice", held_out: true },
        { turn: "t0003", session_id: "sess-p2", symbol: "src/conversion/pricingEngine.ts::calculateTierPrice", held_out: true }
      ],
      contradictions: 0,
      provenance: "graduated",
      origin: "afwe:graduation",
      created: "2026-10-23T10:00:00Z",
      created_from: "t0002",
      graduated_check_id: "chk-export-calculate-tier-price",
      confirmed_by: "human:founder",
      confirmed_at: "2026-10-23T10:30:00Z"
    },
    {
      id: "guide-cohort-router-graduated",
      title: "assignFunnelCohort export exists in abCohort.ts",
      status: "graduated",
      score: 0.98,
      claim: {
        type: "export_exists",
        symbol: "src/telemetry/abCohort.ts::assignFunnelCohort"
      },
      attaches: { nodes: ["ab-cohort-router"] },
      probes: [
        { turn: "t0004", session_id: "sess-c1", symbol: "src/telemetry/abCohort.ts::assignFunnelCohort", held_out: true }
      ],
      contradictions: 0,
      provenance: "graduated",
      origin: "afwe:graduation",
      created: "2026-10-24T10:30:00Z",
      created_from: "t0004",
      graduated_check_id: "chk-export-assign-cohort",
      confirmed_by: "human:growth-lead",
      confirmed_at: "2026-10-24T11:00:00Z"
    },
    {
      id: "guide-roi-calc-graduated",
      title: "calculateRoiSavings export exists in roiCalculator.ts",
      status: "graduated",
      score: 0.97,
      claim: {
        type: "export_exists",
        symbol: "src/acquisition/roiCalculator.ts::calculateRoiSavings"
      },
      attaches: { nodes: ["roi-benchmark"] },
      probes: [
        { turn: "t0005", session_id: "sess-r1", symbol: "src/acquisition/roiCalculator.ts::calculateRoiSavings", held_out: true }
      ],
      contradictions: 0,
      provenance: "graduated",
      origin: "afwe:graduation",
      created: "2026-10-24T14:30:00Z",
      created_from: "t0005",
      graduated_check_id: "chk-export-calculate-roi",
      confirmed_by: "human:marketing",
      confirmed_at: "2026-10-24T15:00:00Z"
    }
  ],
  questions: [
    // 3 open <85% questions
    {
      id: "q-annual-discount-rate",
      turn: "t0008",
      session_id: "sess-annual-plan",
      question: "Should the annual pricing plan discount be 15% or 20% compared to monthly billing?",
      why_asking: "cross_subsystem: conversion pricing engine calculation directly affects stripe billing subscription invoice item schedule.",
      blast_reasons: ["cross_subsystem", "exported_symbol"],
      blast_score: 8,
      proposed_claim: {
        type: "require_pattern",
        pattern: "annualMultiplier\\s*=\\s*0\\.80",
        files: ["src/conversion/pricingEngine.ts"]
      },
      attaches: { nodes: ["pricing-tiers", "stripe-checkout"] },
      status: "open",
      created: "2026-10-25T14:00:00Z"
    },
    {
      id: "q-seat-stepper-granularity",
      turn: "t0007",
      session_id: "sess-seat-stepper",
      question: "Above 50 seats, should the slider step by 5 seats or 10 seats?",
      why_asking: "exported_symbol: seat slider step increment impacts DOM rendering and qualification event tracking.",
      blast_reasons: ["exported_symbol"],
      blast_score: 5,
      proposed_claim: {
        type: "require_pattern",
        pattern: "step\\s*=\\s*10",
        files: ["src/Slide3.tsx"]
      },
      attaches: { nodes: ["seat-configurator"] },
      status: "open",
      created: "2026-10-25T11:00:00Z"
    },
    {
      id: "q-exit-modal-trigger-velocity",
      turn: "t0009",
      session_id: "sess-exit-modal",
      question: "Should mouseout exit intent detect upward Y velocity exceeding 150px/sec or any mouse leave of viewport?",
      why_asking: "contradicts_history: prior turn t0006 prioritized low nuisance thresholds.",
      blast_reasons: ["contradicts_history"],
      blast_score: 6,
      attaches: { nodes: ["growth-funnel"] },
      status: "open",
      created: "2026-10-25T16:00:00Z"
    },
    // 3 answered questions
    {
      id: "q-ab-cohort-persistence",
      turn: "t0002",
      session_id: "sess-ab-choice",
      question: "Should A/B cohort allocation be deterministic based on visitorId hash or stored in cookie?",
      why_asking: "Architecture contract decision for split-test attribution.",
      blast_reasons: ["cross_subsystem"],
      blast_score: 9,
      attaches: { nodes: ["ab-cohort-router"] },
      status: "answered",
      answer: "Use deterministic hash of visitorId with sticky fallback. Zero split contamination.",
      created: "2026-10-23T09:45:00Z",
      resolved: "2026-10-23T10:00:00Z"
    },
    {
      id: "q-pci-token-flow",
      turn: "t0004",
      session_id: "sess-pci-flow",
      question: "Does checkout directly transmit card numbers to custom backend API?",
      why_asking: "PCI-DSS compliance qualification.",
      blast_reasons: ["cross_subsystem", "exported_symbol"],
      blast_score: 10,
      attaches: { nodes: ["stripe-checkout"] },
      status: "answered",
      answer: "Strictly forbidden. Card data stays inside Stripe Elements iframe.",
      created: "2026-10-24T09:30:00Z",
      resolved: "2026-10-24T10:00:00Z"
    },
    {
      id: "q-roi-hours-baseline",
      turn: "t0005",
      session_id: "sess-roi-hours",
      question: "What is the assumed developer annual wasted hours on architectural regressions?",
      why_asking: "Formula baseline calibration.",
      blast_reasons: ["exported_symbol"],
      blast_score: 6,
      attaches: { nodes: ["roi-benchmark"] },
      status: "answered",
      answer: "180 hours per developer per year across debugging, regressions, and manual reviews.",
      created: "2026-10-24T14:00:00Z",
      resolved: "2026-10-24T14:15:00Z"
    }
  ]
});

// 2.9 12 Turns in .afwe/turns/t0001..t0012.yaml
// Collateral losses:
// t0001: implements includes slide-2-social-proof, slide-3-roi-calculator, ab-cohort-sticky-cookie
// t0003: drops slide-2-social-proof (Loss #1)
// t0004: drops slide-3-roi-calculator (Loss #2)
// t0005: drops ab-cohort-sticky-cookie (Loss #3)
const funnelTurns = [
  // Day 1 (Oct 23)
  {
    id: "t0001",
    ts: "2026-10-23T08:00:00Z",
    origin: "human",
    agent: "claude-sonnet-4-5",
    prompt: "Scaffold interactive multi-intent growth and conversion funnel",
    prompt_hash: "f1a2b3c4d5e60001",
    task: "funnel-init",
    scope: { nodes: ["growth-funnel"], files: ["src/**"] },
    status: "committed",
    touched: {
      nodes: ["growth-funnel", "acquisition-stage", "activation-stage", "conversion-stage", "telemetry-stage"],
      files: ["src/Slide1.tsx", "src/Slide3.tsx", "src/Slide5.tsx", "src/Slide6.tsx"]
    },
    implements: {
      "growth-funnel": ["src/Slide1.tsx"],
      "acquisition-stage": ["src/Slide1.tsx"],
      "activation-stage": ["src/Slide3.tsx"],
      "conversion-stage": ["src/Slide5.tsx", "src/Slide6.tsx"],
      "telemetry-stage": ["src/telemetry/eventSink.ts"],
      "slide-2-social-proof": ["src/acquisition/logos.svg"],
      "slide-3-roi-calculator": ["src/activation/calculatorWorker.ts"],
      "ab-cohort-sticky-cookie": ["src/telemetry/cookieStorage.ts"]
    },
    checks: [
      { id: "ts-check", title: "typescript check", trust: "deterministic", authored_by: "human", passed: true, blocking: true }
    ],
    strength: "deterministic",
    confidence: 1.0,
    gate: { decision: "commit", reasons: ["Initial 4-stage funnel architecture scaffolded"] },
    summary: "Scaffold interactive multi-intent growth and conversion funnel",
    session_id: "sess-funnel-01",
    checkgen: ["chk-superseded-cookie-stickiness", "chk-superseded-social-proof-marquee", "chk-superseded-embedded-roi-calc"]
  },
  {
    id: "t0002",
    ts: "2026-10-23T11:00:00Z",
    origin: "human",
    agent: "claude-sonnet-4-5",
    prompt: "Implement dynamic pricing tier engine and UTM visit tracking",
    prompt_hash: "f1a2b3c4d5e60002",
    task: "funnel-pricing-utm",
    targets: ["pricing-tiers", "traffic-attribution"],
    status: "committed",
    touched: {
      nodes: ["pricing-tiers", "traffic-attribution"],
      files: ["src/conversion/pricingEngine.ts", "src/acquisition/utmTracker.ts"]
    },
    implements: {
      "growth-funnel": ["src/Slide1.tsx"],
      "acquisition-stage": ["src/Slide1.tsx"],
      "traffic-attribution": ["src/acquisition/utmTracker.ts"],
      "pricing-tiers": ["src/conversion/pricingEngine.ts"],
      "conversion-stage": ["src/Slide5.tsx", "src/Slide6.tsx"],
      "telemetry-stage": ["src/telemetry/eventSink.ts"],
      "slide-2-social-proof": ["src/acquisition/logos.svg"],
      "slide-3-roi-calculator": ["src/activation/calculatorWorker.ts"],
      "ab-cohort-sticky-cookie": ["src/telemetry/cookieStorage.ts"]
    },
    checks: [
      { id: "chk-no-conversion-in-acquisition", title: "acquisition does not import conversion-stage", trust: "deterministic", authored_by: "checkgen", passed: true, blocking: true },
      { id: "chk-export-calculate-tier-price", title: "calculateTierPrice export exists", trust: "deterministic", authored_by: "checkgen", passed: true, blocking: true }
    ],
    strength: "deterministic",
    confidence: 0.98,
    gate: { decision: "commit", reasons: ["Pricing calculation and UTM attribution confirmed"] },
    summary: "Implement dynamic pricing tier engine and UTM visit tracking",
    session_id: "sess-funnel-02",
    checkgen: ["chk-no-conversion-in-acquisition", "chk-no-raw-sink-in-activation", "chk-export-calculate-tier-price"]
  },
  {
    id: "t0003",
    ts: "2026-10-23T16:30:00Z",
    origin: "human",
    agent: "claude-sonnet-4-5",
    prompt: "Mount Stripe Elements container and seat state management",
    prompt_hash: "f1a2b3c4d5e60003",
    task: "funnel-stripe-seats",
    targets: ["stripe-checkout", "seat-configurator"],
    status: "committed",
    touched: {
      nodes: ["stripe-checkout", "seat-configurator"],
      files: ["src/conversion/stripeElements.ts", "src/activation/funnelState.ts"]
    },
    // COLLATERAL LOSS #1: slide-2-social-proof dropped from implements!
    implements: {
      "growth-funnel": ["src/Slide1.tsx"],
      "acquisition-stage": ["src/Slide1.tsx"],
      "seat-configurator": ["src/activation/funnelState.ts"],
      "pricing-tiers": ["src/conversion/pricingEngine.ts"],
      "stripe-checkout": ["src/conversion/stripeElements.ts"],
      "telemetry-stage": ["src/telemetry/eventSink.ts"],
      "slide-3-roi-calculator": ["src/activation/calculatorWorker.ts"],
      "ab-cohort-sticky-cookie": ["src/telemetry/cookieStorage.ts"]
    },
    checks: [
      { id: "chk-no-utm-in-checkout", title: "stripe checkout does not import utmTracker", trust: "deterministic", authored_by: "checkgen", passed: true, blocking: true }
    ],
    strength: "deterministic",
    confidence: 0.95,
    gate: { decision: "commit", reasons: ["Stripe elements integration mounted"] },
    summary: "Mount Stripe Elements container and seat state management",
    session_id: "sess-funnel-03",
    checkgen: ["chk-no-utm-in-checkout"]
  },

  // Day 2 (Oct 24)
  {
    id: "t0004",
    ts: "2026-10-24T10:15:00Z",
    origin: "human",
    agent: "gpt-4o",
    prompt: "Integrate A/B cohort router and ROI benchmark calculator",
    prompt_hash: "f1a2b3c4d5e60004",
    task: "funnel-ab-roi",
    targets: ["ab-cohort-router", "roi-benchmark"],
    status: "committed",
    overrides: [
      { pin: "pin-hardcoded-starter-price", reason: "Dynamic formula replaces hardcoded $29 starter plan price" }
    ],
    touched: {
      nodes: ["ab-cohort-router", "roi-benchmark"],
      files: ["src/telemetry/abCohort.ts", "src/acquisition/roiCalculator.ts"]
    },
    // COLLATERAL LOSS #2: slide-3-roi-calculator dropped from implements!
    implements: {
      "growth-funnel": ["src/Slide1.tsx"],
      "roi-benchmark": ["src/acquisition/roiCalculator.ts"],
      "traffic-attribution": ["src/acquisition/utmTracker.ts"],
      "seat-configurator": ["src/activation/funnelState.ts"],
      "pricing-tiers": ["src/conversion/pricingEngine.ts"],
      "stripe-checkout": ["src/conversion/stripeElements.ts"],
      "ab-cohort-router": ["src/telemetry/abCohort.ts"],
      "ab-cohort-sticky-cookie": ["src/telemetry/cookieStorage.ts"]
    },
    checks: [
      { id: "chk-export-assign-cohort", title: "assignFunnelCohort export exists", trust: "deterministic", authored_by: "checkgen", passed: true, blocking: true },
      { id: "chk-forbid-alert-prompt", title: "forbid alert in funnel slides", trust: "deterministic", authored_by: "checkgen", passed: true, blocking: true }
    ],
    strength: "deterministic",
    confidence: 0.94,
    gate: { decision: "commit", reasons: ["OVERRIDDEN pin pin-hardcoded-starter-price: Dynamic pricing", "A/B router verified"] },
    summary: "Integrate A/B cohort router and ROI benchmark calculator",
    session_id: "sess-funnel-04",
    checkgen: ["chk-export-assign-cohort", "chk-forbid-alert-prompt"]
  },
  {
    id: "t0005",
    ts: "2026-10-24T15:00:00Z",
    origin: "human",
    agent: "claude-sonnet-4-5",
    prompt: "Upgrade hero experience and SOC2 qualification checklist",
    prompt_hash: "f1a2b3c4d5e60005",
    task: "funnel-hero-soc2",
    targets: ["hero-experience", "security-qualification"],
    status: "committed",
    restore: {
      feature: "slide-2-social-proof",
      from_turn: "t0001",
      lost_turn: "t0003",
      conflicts: 0
    },
    touched: {
      nodes: ["hero-experience", "security-qualification"],
      files: ["src/Slide1.tsx", "src/Slide4.tsx"]
    },
    // COLLATERAL LOSS #3: ab-cohort-sticky-cookie dropped from implements!
    implements: {
      "growth-funnel": ["src/Slide1.tsx"],
      "hero-experience": ["src/Slide1.tsx"],
      "roi-benchmark": ["src/acquisition/roiCalculator.ts"],
      "seat-configurator": ["src/activation/funnelState.ts"],
      "security-qualification": ["src/Slide4.tsx"],
      "pricing-tiers": ["src/conversion/pricingEngine.ts"],
      "stripe-checkout": ["src/conversion/stripeElements.ts"],
      "ab-cohort-router": ["src/telemetry/abCohort.ts"]
    },
    checks: [
      { id: "chk-export-calculate-roi", title: "calculateRoiSavings export exists", trust: "deterministic", authored_by: "checkgen", passed: true, blocking: true },
      { id: "chk-sig-calculate-tier", title: "calculateTierPrice signature verified", trust: "deterministic", authored_by: "checkgen", passed: true, blocking: true }
    ],
    strength: "deterministic",
    confidence: 0.93,
    gate: { decision: "commit", reasons: ["Hero copy updated and SOC2 checklist verified"] },
    summary: "Upgrade hero experience and SOC2 qualification checklist",
    session_id: "sess-funnel-05",
    checkgen: ["chk-export-calculate-roi", "chk-sig-calculate-tier"]
  },
  {
    id: "t0006",
    ts: "2026-10-24T19:30:00Z",
    origin: "human",
    agent: "gemini-2-5-pro",
    prompt: "Harden sticky cohort assignment with multi-session holdout verification",
    prompt_hash: "f1a2b3c4d5e60006",
    task: "funnel-sticky-holdout",
    targets: ["ab-cohort-router"],
    status: "committed",
    restore: {
      feature: "slide-3-roi-calculator",
      from_turn: "t0001",
      lost_turn: "t0004",
      conflicts: 0
    },
    touched: {
      nodes: ["ab-cohort-router"],
      files: ["src/telemetry/abCohort.ts"]
    },
    implements: {
      "growth-funnel": ["src/Slide1.tsx"],
      "hero-experience": ["src/Slide1.tsx"],
      "roi-benchmark": ["src/acquisition/roiCalculator.ts"],
      "seat-configurator": ["src/activation/funnelState.ts"],
      "pricing-tiers": ["src/conversion/pricingEngine.ts"],
      "stripe-checkout": ["src/conversion/stripeElements.ts"],
      "ab-cohort-router": ["src/telemetry/abCohort.ts"]
    },
    checks: [
      { id: "chk-sig-track-utm", title: "trackUtmVisit signature verified", trust: "deterministic", authored_by: "checkgen", passed: true, blocking: true },
      { id: "chk-sig-assign-cohort", title: "assignFunnelCohort signature verified", trust: "deterministic", authored_by: "checkgen", passed: true, blocking: true }
    ],
    strength: "deterministic",
    confidence: 0.92,
    gate: { decision: "commit", reasons: ["Sticky cohort allocation verified across 10,000 mock visitor IDs"] },
    summary: "Harden sticky cohort assignment with holdout verification",
    session_id: "sess-funnel-06",
    checkgen: ["chk-sig-track-utm", "chk-sig-assign-cohort"],
    held_out_guides: ["guide-ab-hash-modulo"]
  },

  // Day 3 (Oct 25) - 3 Staged Turns
  {
    id: "t0007",
    ts: "2026-10-25T11:00:00Z",
    origin: "human",
    agent: "claude-sonnet-4-5",
    prompt: "Propose exit intent modal experiment in unmapped-experiments folder",
    prompt_hash: "f1a2b3c4d5e60007",
    task: "funnel-exit-intent",
    targets: ["growth-funnel"],
    status: "staged",
    touched: {
      nodes: ["growth-funnel"],
      files: ["src/unmapped-experiments/exitIntentModal.tsx"]
    },
    implements: {
      "growth-funnel": ["src/Slide1.tsx", "src/unmapped-experiments/exitIntentModal.tsx"]
    },
    pin_proposals: ["pin-exit-intent-cooldown"],
    checks: [
      { id: "chk-modal-delay", title: "modal delay exceeds 10s", trust: "generated", authored_by: "agent", passed: true, blocking: false }
    ],
    strength: "generated",
    confidence: 0.77,
    gate: {
      decision: "stage",
      reasons: ["Proposed pin pin-exit-intent-cooldown awaiting confirmation", "Unmapped files in src/unmapped-experiments/"]
    },
    summary: "Propose exit intent modal experiment in unmapped-experiments folder",
    session_id: "sess-exit-07",
    agent_zone_rationales: ["Leaf rationale: Exit intent triggers on mouseout Y < 50"]
  },
  {
    id: "t0008",
    ts: "2026-10-25T14:30:00Z",
    origin: "human",
    agent: "gpt-4o",
    prompt: "Introduce annual subscription tier toggle with 20% discount",
    prompt_hash: "f1a2b3c4d5e60008",
    task: "funnel-annual-tier",
    targets: ["pricing-tiers"],
    status: "staged",
    restore: {
      feature: "ab-cohort-sticky-cookie",
      from_turn: "t0001",
      lost_turn: "t0005",
      conflicts: 0
    },
    touched: {
      nodes: ["pricing-tiers"],
      files: ["src/conversion/pricingEngine.ts"]
    },
    implements: {
      "pricing-tiers": ["src/conversion/pricingEngine.ts"]
    },
    checks: [
      { id: "chk-tier-annual-calc", title: "annual pricing discount formula check", trust: "deterministic", authored_by: "agent", passed: true, blocking: true }
    ],
    strength: "deterministic",
    confidence: 0.76,
    gate: {
      decision: "stage",
      reasons: ["AmbiguityQuestion q-annual-discount-rate open with blast score 8"]
    },
    summary: "Introduce annual subscription tier toggle pending ambiguity answer",
    session_id: "sess-annual-08"
  },
  {
    id: "t0009",
    ts: "2026-10-25T17:00:00Z",
    origin: "human",
    agent: "claude-sonnet-4-5",
    prompt: "Integrate affiliate partner webhook postback dispatcher in uncharted folder",
    prompt_hash: "f1a2b3c4d5e60009",
    task: "funnel-affiliate",
    targets: ["telemetry-stage"],
    status: "staged",
    touched: {
      nodes: ["telemetry-stage"],
      files: ["src/affiliate-webhook/partnerPostback.ts"]
    },
    implements: {
      "telemetry-stage": ["src/affiliate-webhook/partnerPostback.ts"]
    },
    checks: [
      { id: "chk-affiliate-ts", title: "affiliate webhook TypeScript compilation", trust: "deterministic", authored_by: "afwe", passed: true, blocking: true }
    ],
    strength: "deterministic",
    confidence: 0.8,
    gate: {
      decision: "stage",
      reasons: ["Unmapped file src/affiliate-webhook/partnerPostback.ts has pending drift proposal"]
    },
    summary: "Integrate affiliate partner webhook postback dispatcher staged",
    session_id: "sess-affil-09"
  },

  // Day 4 (Oct 26) - 3 Redo Turns
  {
    id: "t0010",
    ts: "2026-10-26T08:30:00Z",
    origin: "human",
    agent: "gpt-4o",
    prompt: "Re-randomize A/B cohort on every page reload to test traffic distribution",
    prompt_hash: "f1a2b3c4d5e60010",
    task: "funnel-hack-cohort",
    targets: ["ab-cohort-router"],
    status: "abandoned",
    touched: {
      nodes: ["ab-cohort-router"],
      files: ["src/telemetry/abCohort.ts"]
    },
    implements: {
      "ab-cohort-router": ["src/telemetry/abCohort.ts"]
    },
    checks: [
      { id: "chk-pin-ab-sticky", title: "pin-ab-cohort-sticky compliance check", trust: "deterministic", authored_by: "afwe", passed: false, blocking: true, message: "Intentional pin pin-ab-cohort-sticky forbids re-randomizing cohorts" }
    ],
    strength: "deterministic",
    confidence: 0.2,
    gate: {
      decision: "redo",
      reasons: [
        "BLOCKED by pin pin-ab-cohort-sticky: Visitors must remain in their initial A/B cohort for 30 days",
        "TurnJudgment action: block"
      ]
    },
    summary: "Re-randomize A/B cohort on reload (BLOCKED by intentional pin)",
    session_id: "sess-redo-10"
  },
  {
    id: "t0011",
    ts: "2026-10-26T09:45:00Z",
    origin: "human",
    agent: "claude-sonnet-4-5",
    prompt: "Directly import conversion pricingEngine into Slide 2 ROI Benchmark slide",
    prompt_hash: "f1a2b3c4d5e60011",
    task: "funnel-hack-cross-dep",
    targets: ["roi-benchmark"],
    status: "abandoned",
    touched: {
      nodes: ["roi-benchmark", "pricing-tiers"],
      files: ["src/Slide2.tsx"]
    },
    implements: {
      "roi-benchmark": ["src/Slide2.tsx"]
    },
    checks: [
      { id: "chk-no-conversion-in-acquisition", title: "acquisition does not import conversion-stage", trust: "deterministic", authored_by: "checkgen", passed: false, blocking: true, message: "Constraint c-acquisition-no-conversion violated: Slide2.tsx imports conversion/pricingEngine" }
    ],
    strength: "deterministic",
    confidence: 0.15,
    gate: {
      decision: "redo",
      reasons: [
        "CONSTRAINT_VIOLATION: acquisition-stage must_not_depend on conversion-stage",
        "TurnJudgment leaf-to-root validator failed at module level: roi-benchmark"
      ]
    },
    summary: "Import pricing engine into Slide 2 (BLOCKED by boundary constraint)",
    session_id: "sess-redo-11"
  },
  {
    id: "t0012",
    ts: "2026-10-26T10:30:00Z",
    origin: "human",
    agent: "gemini-2-5-pro",
    prompt: "Directly instantiate RawEventSink inside Slide 4 Security slide",
    prompt_hash: "f1a2b3c4d5e60012",
    task: "funnel-hack-raw-sink",
    targets: ["security-qualification"],
    status: "abandoned",
    touched: {
      nodes: ["security-qualification"],
      files: ["src/Slide4.tsx"]
    },
    implements: {
      "security-qualification": ["src/Slide4.tsx"]
    },
    checks: [
      { id: "chk-no-raw-sink-in-activation", title: "activation does not import eventSink raw class", trust: "deterministic", authored_by: "checkgen", passed: false, blocking: true, message: "Constraint c-activation-no-raw-sink violated: Slide4.tsx instantiates RawEventSink" }
    ],
    strength: "deterministic",
    confidence: 0.1,
    gate: {
      decision: "redo",
      reasons: [
        "CONSTRAINT_VIOLATION: activation-stage must_not_depend on telemetry-stage",
        "Agent reask required: route through event bus dispatcher"
      ]
    },
    summary: "Instantiate RawEventSink in Slide 4 (BLOCKED by boundary constraint)",
    session_id: "sess-redo-12"
  }
];

funnelTurns.forEach(t => {
  write(path.join(funnelAfwe, 'turns', `${t.id}.yaml`), t);
});

// 2.10 Living Intents (.afwe/intents/*.yaml)
const funnelIntents = [
  {
    id: "dynamic-pricing-matrix",
    title: "Dynamic per-seat tier pricing matrix",
    statement: "Pricing scales with active team seats based on tier rate card with zero client-side manipulation.",
    status: "implemented",
    origin: "human:founder",
    attaches: { nodes: ["pricing-tiers"] },
    history: [
      { turn: "t0002", ts: "2026-10-23T11:00:00Z", statement: "Initial dynamic pricing engine" },
      { turn: "t0004", ts: "2026-10-24T10:15:00Z", statement: "Added volume discount tiers" }
    ],
    pins: ["pin-pricing-transparency"]
  },
  {
    id: "pci-compliant-checkout",
    title: "Isolated PCI-DSS compliant checkout tokenization",
    statement: "Stripe Elements mounted inside isolated container. Zero credit card numbers touch application heap.",
    status: "active",
    origin: "human:secops",
    attaches: { nodes: ["stripe-checkout"] },
    history: [
      { turn: "t0003", ts: "2026-10-23T16:30:00Z", statement: "Mount Stripe Elements container" }
    ],
    pins: ["pin-stripe-pci-isolation"]
  },
  {
    id: "deterministic-cohort-allocation",
    title: "Deterministic 30-day split-test cohort stickiness",
    statement: "Visitor ID hash assigns user to Variant A or B with 30-day stickiness to protect test validity.",
    status: "active",
    origin: "human:growth-lead",
    attaches: { nodes: ["ab-cohort-router"] },
    history: [
      { turn: "t0006", ts: "2026-10-24T19:30:00Z", statement: "Lock cohort stickiness pin" }
    ],
    pins: ["pin-ab-cohort-sticky"]
  },
  {
    id: "annual-discount-incentive",
    title: "Annual billing discount incentive toggle",
    statement: "Offer 20% savings on annual upfront billing to increase customer lifetime value.",
    status: "draft",
    origin: "human:cro-consultant",
    attaches: { nodes: ["pricing-tiers"] },
    history: [
      { turn: "t0008", ts: "2026-10-25T14:30:00Z", statement: "Draft annual pricing toggle" }
    ]
  }
];

funnelIntents.forEach(i => {
  write(path.join(funnelAfwe, 'intents', `${i.id}.yaml`), i);
});

// 2.11 Guardrails: 3 active, 3 passive
const funnelGuardrailsActive = [
  {
    id: "forbid-eval-in-slides",
    mode: "active",
    statement: "Funnel slides must never execute eval or dynamic Function constructor.",
    scope: { files: ["src/**/*.tsx"] },
    checks: [
      { type: "forbid_pattern", pattern: "\\beval\\s*\\(", files: ["src/**/*.tsx"] }
    ]
  },
  {
    id: "require-pci-iframe-container",
    mode: "active",
    statement: "Slide 6 checkout must maintain card-element-container mount node.",
    scope: { files: ["src/Slide6.tsx"] },
    checks: [
      { type: "require_pattern", pattern: 'id="card-element-container"', files: ["src/Slide6.tsx"] }
    ]
  },
  {
    id: "forbid-raw-card-inputs",
    mode: "active",
    statement: "Raw credit card input elements forbidden in client codebase.",
    scope: { files: ["src/**/*.tsx"] },
    checks: [
      { type: "forbid_pattern", pattern: 'type=["\']password["\'][^>]*name=["\']cvv', files: ["src/**/*.tsx"] }
    ]
  }
];

funnelGuardrailsActive.forEach(g => {
  write(path.join(funnelAfwe, 'guardrails/active', `${g.id}.yaml`), g);
});

const funnelGuardrailsPassive = [
  {
    id: "slide-component-convention",
    mode: "passive",
    statement: "Slide components should be named SlideN and export a React Functional Component.",
    scope: { files: ["src/Slide*.tsx"] }
  },
  {
    id: "utm-sanitization",
    mode: "passive",
    statement: "UTM campaign query parameters should be lowercase trimmed strings.",
    scope: { files: ["src/acquisition/utmTracker.ts"] }
  },
  {
    id: "cta-button-class",
    mode: "passive",
    statement: "Conversion call-to-action buttons should use the .cta-btn CSS class.",
    scope: { files: ["src/**/*.tsx"] }
  }
];

funnelGuardrailsPassive.forEach(g => {
  write(path.join(funnelAfwe, 'guardrails/passive', `${g.id}.yaml`), g);
});

// 2.12 Memory: 15 entries (3 per kind)
const funnelMemories = [
  // decisions
  { kind: "decisions", id: "dec-deterministic-cohorts", title: "Deterministic A/B cohort assignment", body: "We use Murmur3 / polynomial string hashing over random Math.random() so cohort allocation survives across server and client boundaries.", applies_to: ["ab-cohort-router"] },
  { kind: "decisions", id: "dec-stripe-elements-only", title: "Zero raw credit card field handling", body: "To maintain PCI SAQ A eligibility, card fields never touch our application bundle; Stripe Elements iframe handles input.", applies_to: ["stripe-checkout"] },
  { kind: "decisions", id: "dec-session-storage-attribution", title: "Session-scoped UTM attribution", body: "Attribution tags live in sessionStorage to prevent cross-session tracking concerns while preserving referral provenance.", applies_to: ["traffic-attribution"] },
  // constraints
  { kind: "constraints", id: "con-acquisition-conversion-isolation", title: "Decouple acquisition slides from checkout", body: "Acquisition slides (Slide1, Slide2) must never import payment gateways or charge functions to preserve sub-second initial bundle load.", applies_to: ["acquisition-stage", "conversion-stage"] },
  { kind: "constraints", id: "con-activation-headless-events", title: "Activation slide telemetry abstraction", body: "Activation step widgets must emit events via domain dispatchers and never access low-level sink instances directly.", applies_to: ["activation-stage", "telemetry-stage"] },
  { kind: "constraints", id: "con-pricing-formula-immutability", title: "Dynamic pricing formula transparency", body: "Plan amounts must be derived via calculateTierPrice() function to guarantee parity between visual quote and charge.", applies_to: ["pricing-tiers"] },
  // exceptions
  { kind: "exceptions", id: "exc-preview-demo-mode", title: "Exception: Instant mock card fill in demo preview harness", body: "When running inside demo sandbox (CI=true), a test card quick-fill button is permitted for automated E2E recording.", applies_to: ["stripe-checkout"] },
  { kind: "exceptions", id: "exc-direct-roi-quote", title: "Exception: Direct pricing estimate read permitted in ROI benchmark slide", body: "Slide2 ROI benchmark displays projected tier cost side-by-side with savings estimate.", applies_to: ["roi-benchmark"] },
  { kind: "exceptions", id: "exc-local-dev-event-log", title: "Exception: Console event logging permitted in development mode", body: "Event sink logs dispatched telemetry payloads to browser console if NODE_ENV !== 'production'.", applies_to: ["behavioral-event-sink"] },
  // problems
  { kind: "problems", id: "prob-ad-blocker-telemetry", title: "Brave and uBlock Origin blocking beacon telemetry", body: "Client-side ad blockers reject POSTs to /telemetry; future revision should route through first-party reverse proxy.", applies_to: ["behavioral-event-sink"] },
  { kind: "problems", id: "prob-split-test-sample-ratio-mismatch", title: "Sample ratio mismatch on mobile WebKit", body: "Safari ITP cookie partitioning previously skewed cohort ratios by discarding cookies after 7 days.", applies_to: ["ab-cohort-router"] },
  { kind: "problems", id: "prob-stripe-iframe-load-latency", title: "Stripe Elements iframe mounting delay on 3G connections", body: "On slow mobile connections, the payment card container takes up to 1.8 seconds to initialize; added skeleton loader.", applies_to: ["stripe-checkout"] },
  // terminology
  { kind: "terminology", id: "term-funnel-stage", title: "Stage vs Slide", body: "A Stage is an architectural domain grouping (acquisition, activation, conversion); a Slide is a specific UI presentation view.", applies_to: ["growth-funnel"] },
  { kind: "terminology", id: "term-utm-parameters", title: "UTM Campaign Query Parameters", body: "Standard query parameters (utm_source, utm_medium, utm_campaign) used for marketing traffic attribution.", applies_to: ["traffic-attribution"] },
  { kind: "terminology", id: "term-ab-cohort", title: "A/B Cohort Allocation", body: "The partition of incoming prospective users into test treatment groups (Variant A control vs Variant B candidate).", applies_to: ["ab-cohort-router"] }
];

funnelMemories.forEach(m => {
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
  write(path.join(funnelAfwe, 'memory', m.kind, `${m.id}.md`), content);
});

// 2.13 Drift Proposals (.afwe/state/proposals.json)
write(path.join(funnelAfwe, 'state/proposals.json'), {
  proposals: [
    {
      id: "unmapped:exit-intent",
      created: "2026-10-25T16:50:00Z",
      finding: {
        id: "unmapped:exit-intent",
        kind: "unmapped_file",
        severity: "warn",
        confidence: 0.35,
        summary: "\`src/unmapped-experiments/exitIntentModal.tsx\` has no blueprint home; propose new module \`experiments\`",
        evidence: ["modal component in unmapped directory"],
        change: {
          op: "create_node",
          parent: "growth-funnel",
          name: "experiments",
          files: ["src/unmapped-experiments/**"]
        },
        files: ["src/unmapped-experiments/exitIntentModal.tsx"]
      },
      status: "pending"
    },
    {
      id: "unmapped:fb-pixel",
      created: "2026-10-25T17:00:00Z",
      finding: {
        id: "unmapped:fb-pixel",
        kind: "unmapped_file",
        severity: "info",
        confidence: 0.4,
        summary: "\`src/legacy-pixel/fbPixel.ts\` found in unmapped folder; map to telemetry-stage",
        evidence: ["pixel event tracking symbol"],
        change: {
          op: "map_file",
          node: "telemetry-stage",
          file: "src/legacy-pixel/fbPixel.ts"
        },
        files: ["src/legacy-pixel/fbPixel.ts"]
      },
      status: "pending"
    },
    {
      id: "unmapped:partner-postback",
      created: "2026-10-25T17:15:00Z",
      finding: {
        id: "unmapped:partner-postback",
        kind: "unmapped_file",
        severity: "warn",
        confidence: 0.3,
        summary: "\`src/affiliate-webhook/partnerPostback.ts\` belongs to unmapped affiliate webhook module",
        evidence: ["standalone affiliate conversion postback dispatcher"],
        change: {
          op: "create_node",
          parent: "telemetry-stage",
          name: "affiliate-webhook",
          files: ["src/affiliate-webhook/**"]
        },
        files: ["src/affiliate-webhook/partnerPostback.ts"]
      },
      status: "pending"
    },
    {
      id: "drift:rel-security-sink",
      created: "2026-10-25T18:00:00Z",
      finding: {
        id: "drift:rel-security-sink",
        kind: "undeclared_relation",
        severity: "info",
        confidence: 0.75,
        summary: "Inferred dependency: security-qualification publishes behavioral-event-sink",
        evidence: ["Slide4.tsx records soc2_checklist_viewed event"],
        change: {
          op: "add_relation",
          from: "security-qualification",
          to: "behavioral-event-sink",
          kind: "publishes"
        },
        nodes: ["security-qualification", "behavioral-event-sink"]
      },
      status: "pending"
    }
  ]
});

// 2.14 Escalations (.afwe/state/escalations.json)
write(path.join(funnelAfwe, 'state/escalations.json'), [
  {
    id: "esc-disable-cohort-sticky",
    created_at: "2026-10-26T08:35:00Z",
    op: "retire_pin",
    description: "Agent attempted to retire intentional pin pin-ab-cohort-sticky to re-randomize visitor cohorts on refresh",
    params: { pin_id: "pin-ab-cohort-sticky", reason: "Testing traffic volume" },
    origin: "llm:gpt-4o",
    turn: "t0010",
    status: "rejected",
    decided_by: "human:growth-lead",
    decided_at: "2026-10-26T08:45:00Z"
  },
  {
    id: "esc-loosen-acquisition-conversion",
    created_at: "2026-10-26T09:50:00Z",
    op: "modify_constraint",
    description: "Agent requested loosening constraint c-acquisition-no-conversion to import pricing engine into Slide 2",
    params: { constraint_id: "c-acquisition-no-conversion" },
    origin: "llm:claude-sonnet-4-5",
    turn: "t0011",
    status: "rejected",
    decided_by: "human:founder",
    decided_at: "2026-10-26T10:00:00Z"
  },
  {
    id: "esc-approve-annual-discount",
    created_at: "2026-10-25T14:45:00Z",
    op: "add_pin",
    description: "Approve 20% annual discount pricing calculation pin",
    params: { pin_statement: "Annual plans discounted by 20% compared to monthly rate" },
    origin: "llm:gpt-4o",
    turn: "t0008",
    status: "pending"
  }
]);

// 2.15 Missions (.afwe/missions/*.yaml) & Leases (.afwe/state/leases.json)
const funnelMissions = [
  {
    id: "m-conversion-opt",
    title: "Conversion Funnel Slide 6 Stripe Elements Upgrade",
    prompt: "Harden credit card tokenization and multi-currency formatting",
    orchestrator: "human:growth-lead",
    status: "Active",
    created: "2026-10-25T10:00:00Z",
    updated: "2026-10-26T09:00:00Z",
    invariants: {
      locked_pins: ["pin-stripe-pci-isolation"],
      must_not_depend: ["acquisition-stage->conversion-stage"]
    },
    budget: { max_escalations: 2, max_partial_losses: 0 },
    agents: [
      {
        agent_id: "subagent-stripe-checkout",
        role: "Stripe Tokenization Specialist",
        branch: "mission/m-conversion-opt/stripe",
        worktree_path: ".afwe/worktrees/m-conversion-opt-stripe",
        assigned_nodes: ["stripe-checkout", "enterprise-quote-modal"],
        status: "active"
      }
    ]
  },
  {
    id: "m-ab-testing-framework",
    title: "A/B Cohort Router & Split Attribution",
    prompt: "Scale split test hash router to 100k visitors",
    orchestrator: "human:founder",
    status: "Paused",
    created: "2026-10-24T14:00:00Z",
    updated: "2026-10-25T18:00:00Z",
    invariants: {
      locked_pins: ["pin-ab-cohort-sticky"]
    },
    agents: []
  },
  {
    id: "m-funnel-scaffold",
    title: "Funnel Scaffolding & UTM Tracking",
    prompt: "Deliver 4-stage funnel with UTM parameter capture",
    orchestrator: "human:marketing",
    status: "Completed",
    created: "2026-10-23T09:00:00Z",
    updated: "2026-10-23T12:00:00Z",
    agents: []
  }
];

funnelMissions.forEach(m => {
  write(path.join(funnelAfwe, 'missions', `${m.id}.yaml`), m);
});

write(path.join(funnelAfwe, 'state/leases.json'), {
  leases: [
    {
      node_id: "stripe-checkout",
      mission_id: "m-conversion-opt",
      agent_id: "subagent-stripe-checkout",
      acquired_at: "2026-10-26T09:00:00Z",
      expires_at: Math.floor(Date.now() / 1000) + 7200,
      purpose: "Implementing 3D Secure 2.0 challenge flow"
    },
    {
      node_id: "enterprise-quote-modal",
      mission_id: "m-conversion-opt",
      agent_id: "subagent-stripe-checkout",
      acquired_at: "2026-10-26T09:00:00Z",
      expires_at: Math.floor(Date.now() / 1000) + 7200,
      purpose: "Adding currency pill formatter"
    },
    {
      node_id: "ab-cohort-router",
      mission_id: "m-ab-testing-framework",
      agent_id: "subagent-ab-router",
      acquired_at: "2026-10-26T08:00:00Z",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      purpose: "Auditing hash distribution consistency"
    }
  ]
});

// 2.16 Materialized Tripwire Manifest (.afwe/guardrails/manifest.yaml)
write(path.join(funnelAfwe, 'guardrails/manifest.yaml'), `version: 1
generated_at: "2026-10-26T10:00:00Z"
entries:
  .afwe/guardrails/generated_checks_test.sh: "b3_4a91b2c551e3"
  .afwe/guardrails/pre-commit: "b3_6e10a2d82b01"
  .github/workflows/afwe-gate.yml: "b3_9d33f11c30ee"
`);

write(path.join(funnelAfwe, 'guardrails/generated_checks_test.sh'), `#!/usr/bin/env sh
# Generated by afwe materialize — deterministic architectural tripwire runner
set -e
afwe gate --ci
`);

console.log("multi-intent-funnel fully populated with 3-day history exercising all ReBorn features >= 3 times.");

import React from 'react';
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

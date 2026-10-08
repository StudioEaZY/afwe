import React from "react";

export interface FunnelSlideProps {
  clientName?: string;
  onNext?: () => void;
}

export function Slide1({ clientName = "Acme", onNext }: FunnelSlideProps) {
  return (
    <div className="slide slide-1">
      <h2>Thank You</h2>
      <p>Prepared for {clientName} · 2026</p>
      <p className="subtitle">You helped us get here. This is our honest gratitude.</p>
      {onNext && <button onClick={onNext}>Next →</button>}
    </div>
  );
}

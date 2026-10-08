import React from "react";
import { FunnelSlideProps } from "./Slide1";

export function Slide6({ clientName = "Acme" }: FunnelSlideProps) {
  return (
    <div className="slide slide-6 invitation">
      <h2>Whenever you're ready, we're ready.</h2>
      <p className="caption">Prepared for {clientName} · 2026</p>
      <div className="cta-box">
        <button className="primary-cta">CLAIM MY VIP RATE →</button>
      </div>
      <div className="signature">
        <p>Studio EaZY</p>
      </div>
    </div>
  );
}

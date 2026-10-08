import React from "react";
import { FunnelSlideProps } from "./Slide1";

export function Slide5({ onNext }: FunnelSlideProps) {
  return (
    <div className="slide slide-5">
      <h2>The Offer</h2>
      <div className="pricing-card">
        <h3>50% Off — Your Private Rate</h3>
        <p>Your 50% VIP rate — kept for you.</p>
        <ul>
          <li>Up to 6 months pause</li>
          <li>12-hour turnaround guarantee</li>
          <li>Unlimited design requests</li>
          <li>Protected via platform checkout</li>
        </ul>
      </div>
      {onNext && <button onClick={onNext}>Continue to Invitation →</button>}
    </div>
  );
}

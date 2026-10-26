import React from 'react';
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
      <p>Estimated annual developer hours saved: {savings.hours}h (${savings.dollars})</p>
      <p>Projected plan cost: ${tierCost}</p>
    </div>
  );
};

import React from 'react';
import { calculateTierPrice } from './conversion/pricingEngine';

export const Slide5: React.FC = () => {
  const [tier, setTier] = React.useState<'starter' | 'pro' | 'enterprise'>('pro');

  return (
    <div className="slide slide-pricing">
      <h2>Select Your Architecture Governance Tier</h2>
      <button onClick={() => setTier('starter')}>Starter ($49)</button>
      <button onClick={() => setTier('pro')}>Pro ($199)</button>
      <button onClick={() => setTier('enterprise')}>Enterprise (Custom)</button>
      <p>Selected tier monthly cost: ${calculateTierPrice(tier, 10)}</p>
    </div>
  );
};

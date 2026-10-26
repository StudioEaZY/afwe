import React from 'react';
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

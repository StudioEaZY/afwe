import React from 'react';
import { trackUtmVisit } from './acquisition/utmTracker';
import { hydrateSeoMeta } from './seo-scraper/metaHydrator';
import { trackFbPixelEvent } from './legacy-pixel/fbPixel';
import { processPartnerPostback } from './affiliate-webhook/partnerPostback';

export const Slide1: React.FC<{ onNext?: () => void }> = ({ onNext }) => {
  React.useEffect(() => {
    trackUtmVisit('hero-header', 'direct');
    hydrateSeoMeta({ title: "AFWE Demo Funnel", description: "Multi-intent funnel" });
    trackFbPixelEvent('PageView');
    processPartnerPostback({ partnerId: 'aff_demo', subId: 'direct' });
  }, []);

  return (
    <div className="slide slide-hero">
      <h1>Accelerate Your Software Evolution</h1>
      <p>Deterministic architecture governance for autonomous engineering agents.</p>
      <button className="cta-btn">Calculate Your ROI</button>
    </div>
  );
};

import React from 'react';
import { mountStripeElements } from './conversion/stripeElements';
// ARCHITECTURAL VIOLATION 3: Checkout slide importing acquisition UTM tracker internals!
import { trackUtmVisit } from './acquisition/utmTracker';
import { ExitIntentModal } from './unmapped-experiments/exitIntentModal';

export const Slide6: React.FC = () => {
  const [showExit, setShowExit] = React.useState(false);
  React.useEffect(() => {
    mountStripeElements('card-element-container');
    trackUtmVisit('checkout-direct', 'funnel');
  }, []);

  return (
    <div className="slide slide-checkout">
      <h2>Instant Cloud Provisioning & Checkout</h2>
      <div id="card-element-container"></div>
      <button className="provision-btn">Start 14-Day Free Evaluation</button>
      <ExitIntentModal isOpen={showExit} onDismiss={() => setShowExit(false)} />
    </div>
  );
};

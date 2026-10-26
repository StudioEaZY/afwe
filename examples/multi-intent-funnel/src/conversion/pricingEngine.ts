// conversion stage: pricing engine
export function calculateTierPrice(tier: string, seats: number): number {
  switch (tier) {
    case 'starter': return 49 + (seats * 10);
    case 'pro': return 199 + (seats * 15);
    case 'enterprise': return 999 + (seats * 25);
    default: return 99;
  }
}

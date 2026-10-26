// activation stage: state management
export interface FunnelState {
  step: number;
  seats: number;
  tier: string;
}

let globalState: FunnelState = { step: 1, seats: 5, tier: 'pro' };

export function getFunnelState(): FunnelState {
  return globalState;
}

export function updateFunnelSeatCount(seats: number): void {
  globalState.seats = seats;
}

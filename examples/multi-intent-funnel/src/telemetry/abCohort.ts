// telemetry stage: ab cohort allocation
export function assignFunnelCohort(visitorId: string): 'variant-A' | 'variant-B' {
  let hash = 0;
  for (let i = 0; i < visitorId.length; i++) hash = visitorId.charCodeAt(i) + ((hash << 5) - hash);
  return (Math.abs(hash) % 2 === 0) ? 'variant-A' : 'variant-B';
}

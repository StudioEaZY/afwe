// acquisition stage: utm tracking
export function trackUtmVisit(campaign: string, source: string): { tracked: boolean; timestamp: number } {
  return { tracked: true, timestamp: Date.now() };
}

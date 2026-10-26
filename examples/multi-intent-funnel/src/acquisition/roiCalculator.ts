// acquisition stage: roi calculation
export function calculateRoiSavings(engineerCount: number): { hours: number; dollars: number } {
  const hours = engineerCount * 180;
  const dollars = hours * 95;
  return { hours, dollars };
}

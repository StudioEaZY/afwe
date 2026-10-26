// proration-calculator component & idempotency-key-hasher widget
export function calculateProration(daysRemaining: number, totalDays: number, planAmountCents: number): number {
  if (totalDays <= 0) return 0;
  return Math.round((daysRemaining / totalDays) * planAmountCents);
}

export function hashIdempotencyKey(key: string): string {
  return `idemp_${Buffer.from(key).toString("hex").slice(0, 16)}`;
}

export async function charge(customerId: string, cents: number): Promise<{ ok: boolean }> {
  return { ok: cents >= 0 && customerId.length > 0 };
}

// UNCHARTED: notifications/mailer.ts
export interface EmailPayload {
  to: string;
  subject: string;
  body: string;
}

export async function sendTransactionalEmail(payload: EmailPayload): Promise<{ sent: boolean }> {
  console.log("Dispatching email to", payload.to);
  return { sent: true };
}

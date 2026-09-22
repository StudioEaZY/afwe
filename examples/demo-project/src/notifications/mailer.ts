// A brand new area with no architectural home: AFWE cannot guess where this belongs
// with confidence, so it proposes a node instead of silently inventing one.
export async function sendMail(to: string, subject: string, body: string) {
  return { queued: true, to, subject, size: body.length };
}

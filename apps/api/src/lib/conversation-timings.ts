/**
 * "1ª resposta": from the current acceptance to the agent's first own reply. A reply from before that acceptance
 * belongs to someone who had the conversation earlier — never a negative time.
 */
export function firstResponseMs(c: { acceptedAt: Date | null; firstResponseAt: Date | null }): number | null {
  if (!c.acceptedAt || !c.firstResponseAt) return null;
  const ms = c.firstResponseAt.getTime() - c.acceptedAt.getTime();
  return ms >= 0 ? ms : null;
}

/** The first-response times of the conversations that have one. */
export function firstResponseDiffs(conversations: { acceptedAt: Date | null; firstResponseAt: Date | null }[]): number[] {
  return conversations.map(firstResponseMs).filter((ms): ms is number => ms !== null);
}

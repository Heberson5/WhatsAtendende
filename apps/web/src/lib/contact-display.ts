/**
 * `contact.phone` is null when WhatsApp hasn't revealed this contact's real
 * phone number yet — see conversations.mapper.ts's isUnresolvedLidPhone.
 * Falls back to a generic label instead of ever showing nothing at all.
 */
export function contactDisplayName(contact: { name: string | null; phone: string | null }): string {
  return contact.name || contact.phone || "Contato do WhatsApp";
}

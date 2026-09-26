import { renderWhatsAppFormatting } from "../../lib/whatsappFormatting";

/**
 * Shows exactly what the customer's WhatsApp will render — the sender's
 * name (bold) + a blank line + the message body — same as this app builds
 * for every real send (see withSenderPrefix in whatsapp.service.ts), so an
 * admin editing a template never has to ask "como vai ficar" again. Reuses
 * renderWhatsAppFormatting (MessageBubble's own bold/italic/link parser) so
 * *asterisco* in the template really shows bold here, exactly as WhatsApp
 * itself would render it.
 */
export function AutoMessagePreview({ senderName, text }: { senderName: string; text: string }) {
  const fullText = `*${senderName}:*\n\n${text}`;
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted">Prévia de como o cliente vai receber:</p>
      <div className="max-w-sm whitespace-pre-wrap break-words rounded-card bg-primary px-3 py-2 text-sm text-primary-fg shadow-soft">
        {renderWhatsAppFormatting(fullText)}
      </div>
    </div>
  );
}

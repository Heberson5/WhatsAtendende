import type { ReactNode } from "react";

/**
 * Renders WhatsApp's own inline text markup — bold, italic, strikethrough
 * and monospace markers, the same convention its official apps already
 * interpret — as React nodes. Applies uniformly to inbound and outbound
 * message bodies: WhatsApp carries the literal marker characters in the
 * message text itself, so a message typed with this markup on either end
 * needs the same rendering here. Single-pass, non-nested (WhatsApp's own
 * formatting doesn't nest either).
 */
export function renderWhatsAppFormatting(text: string): ReactNode[] {
  // Order matters: monospace (```...```) is checked first since its content
  // must never be reinterpreted for bold/italic/strike markers inside it.
  const pattern = /```([^`\n]+)```|(?<![*\w])\*([^*\n]+)\*(?![*\w])|(?<![_\w])_([^_\n]+)_(?![_\w])|(?<![~\w])~([^~\n]+)~(?![~\w])/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const [, mono, bold, italic, strike] = match;
    if (mono !== undefined) nodes.push(<code key={key++} className="rounded bg-black/10 px-1 py-0.5 font-mono text-[0.9em]">{mono}</code>);
    else if (bold !== undefined) nodes.push(<strong key={key++}>{bold}</strong>);
    else if (italic !== undefined) nodes.push(<em key={key++}>{italic}</em>);
    else if (strike !== undefined) nodes.push(<s key={key++}>{strike}</s>);
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

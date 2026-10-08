import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { MessageDTO, MessageReactionDTO } from "@whatsatendende/types";
import { MessageBubble } from "./MessageBubble";

function message(reactions: MessageReactionDTO[]): MessageDTO {
  return {
    id: "m1",
    conversationId: "c1",
    direction: "INBOUND",
    type: "TEXT",
    status: "DELIVERED",
    body: "Oi, preciso de ajuda",
    senderAgentDisplayName: null,
    createdAt: new Date(2026, 9, 8, 10, 0).toISOString(),
    deliveredAt: null,
    readAt: null,
    replyToMessageId: null,
    replyToStory: null,
    linkPreview: null,
    attachments: [],
    reactions,
  };
}

const reaction = (id: string, emoji: string, userDisplayName: string): MessageReactionDTO => ({ id, emoji, userId: id, userDisplayName });

function renderBubble(reactions: MessageReactionDTO[]) {
  return render(<MessageBubble message={message(reactions)} onReply={() => undefined} onReact={() => undefined} readOnly />);
}

describe("reactions on a message bubble", () => {
  it("shows the same emoji from two people once, with a 2 and their names", () => {
    renderBubble([reaction("a", "👍", "Ana"), reaction("b", "👍", "Cliente")]);
    const chips = screen.getAllByTestId("reaction-chip");
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveTextContent("👍2");
    expect(chips[0]).toHaveAttribute("title", "Ana, Cliente");
  });

  it("shows one emoji alone without a number", () => {
    renderBubble([reaction("a", "❤️", "Cliente")]);
    const chips = screen.getAllByTestId("reaction-chip");
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveTextContent(/^❤️$/);
  });

  it("shows nothing when nobody reacted", () => {
    renderBubble([]);
    expect(screen.queryByTestId("reaction-chip")).not.toBeInTheDocument();
  });
});

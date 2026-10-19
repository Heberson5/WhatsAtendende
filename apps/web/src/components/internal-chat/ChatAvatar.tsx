import clsx from "clsx";
import { Hash, Users } from "lucide-react";
import type { AgentPresence, ChatRoomKind } from "@whatsatendende/types";

const PRESENCE_DOT: Record<AgentPresence, string> = { ONLINE: "bg-green-500", AWAY: "bg-yellow-500", OFFLINE: "bg-gray-400" };

export function PresenceDot({ presence, className }: { presence: AgentPresence; className?: string }) {
  return <span className={clsx("block h-2.5 w-2.5 rounded-full border-2 border-surface", PRESENCE_DOT[presence], className)} />;
}

export function PersonAvatar({ name, photoUrl, presence, size = "md" }: { name: string; photoUrl: string | null; presence?: AgentPresence; size?: "sm" | "md" }) {
  const box = size === "sm" ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-xs";
  return (
    <span className="relative inline-block shrink-0">
      {photoUrl ? (
        <img src={photoUrl} alt="" className={clsx("rounded-full object-cover", box)} />
      ) : (
        <span className={clsx("flex items-center justify-center rounded-full bg-primary/10 font-semibold text-primary", box)}>{name.slice(0, 2).toUpperCase()}</span>
      )}
      {presence && <PresenceDot presence={presence} className="absolute -bottom-0.5 -right-0.5" />}
    </span>
  );
}

export function RoomIcon({ kind }: { kind: ChatRoomKind }) {
  const Icon = kind === "GENERAL" ? Hash : Users;
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary/15 text-secondary">
      <Icon className="h-4 w-4" />
    </span>
  );
}

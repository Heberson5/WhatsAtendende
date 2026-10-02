import type { PauseReason, User, WhatsAppConnection } from "@prisma/client";
import type { AccessSchedule, UserDTO } from "@whatsatendende/types";

type UserWithConnection = User & { whatsappConnection: WhatsAppConnection | null; pauseReason?: PauseReason | null };

export function toUserDTO(user: UserWithConnection): UserDTO {
  return {
    id: user.id,
    fullName: user.fullName,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    status: user.status,
    presence: user.presence,
    photoUrl: user.photoUrl,
    whatsappConnectionId: user.whatsappConnectionId,
    whatsappConnectionName: user.whatsappConnection?.name ?? null,
    whatsappConnectionStatus: user.whatsappConnection?.status ?? null,
    createdAt: user.createdAt.toISOString(),
    lastAccessAt: user.lastAccessAt ? user.lastAccessAt.toISOString() : null,
    workState: user.workState,
    workCity: user.workCity,
    accessSchedule: (user.accessSchedule as AccessSchedule | null) ?? null,
    pauseReasonId: user.pauseReasonId,
    pauseReasonName: user.pauseReason?.name ?? null,
    pausedAt: user.pausedAt ? user.pausedAt.toISOString() : null,
    presenceChartStartHour: user.presenceChartStartHour,
    presenceChartEndHour: user.presenceChartEndHour,
    releaseNotesSeenVersion: user.releaseNotesSeenVersion,
  };
}

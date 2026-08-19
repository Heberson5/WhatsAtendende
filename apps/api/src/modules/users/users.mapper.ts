import type { User } from "@prisma/client";
import type { UserDTO } from "@whatsatendende/types";

export function toUserDTO(user: User): UserDTO {
  return {
    id: user.id,
    fullName: user.fullName,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    status: user.status,
    presence: user.presence,
    createdAt: user.createdAt.toISOString(),
    lastAccessAt: user.lastAccessAt ? user.lastAccessAt.toISOString() : null,
  };
}

import { Prisma, UserRole, UserStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { created, ok } from "../lib/http.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { allowRoles } from "../middleware/rbac.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import { createAuditLog, requestIp } from "../services/audit-log.service.js";
import { enqueueInAppNotification } from "../services/notification.service.js";

export const chatRouter = Router();

const allowInternalChatRoles = allowRoles(
  "SUPER_ADMIN",
  "ADMIN",
  "DISTRICT_MANAGER",
  "FIELD_EXECUTIVE"
);

chatRouter.use(allowInternalChatRoles);

const listParticipantsQuerySchema = z.object({
  search: z.preprocess(
    (value) => {
      if (typeof value !== "string") return undefined;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    },
    z.string().min(1).max(120).optional()
  )
});

const createConversationSchema = z.object({
  participantUserId: z.string().uuid(),
  leadId: z.string().uuid().optional()
});

const conversationIdParamSchema = z.object({
  conversationId: z.string().uuid()
});

const listMessagesQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().datetime().optional()
});

const createMessageSchema = z.object({
  body: z.string().trim().min(1).max(2_000)
});

const listConversationsQuerySchema = z.object({
  leadId: z.string().uuid().optional()
});

type InternalRole = UserRole;
const ONLINE_ACTIVITY_WINDOW_MS = 5 * 60 * 1000;
const CHAT_SLOW_OPERATION_MS = 400;

function logSlowChatOperation(
  operation: string,
  meta: {
    actorUserId: string;
    actorRole: InternalRole;
    durationMs: number;
    conversationId?: string;
    rowCount?: number;
    messageCount?: number;
    take?: number;
  }
) {
  if (meta.durationMs < CHAT_SLOW_OPERATION_MS) {
    return;
  }
  console.warn("chat_operation_slow", {
    operation,
    ...meta
  });
}

function roleLabel(role: InternalRole) {
  if (role === "SUPER_ADMIN") return "Super Admin";
  if (role === "ADMIN") return "Admin";
  if (role === "MANAGER") return "District Manager";
  return "Field Executive";
}

function isElevatedRole(role: InternalRole) {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

function allowedPeerRolesFor(role: InternalRole): InternalRole[] {
  if (role === "SUPER_ADMIN") {
    return ["SUPER_ADMIN", "ADMIN", "MANAGER", "EXECUTIVE"];
  }
  if (role === "ADMIN") {
    return ["SUPER_ADMIN", "ADMIN", "MANAGER", "EXECUTIVE"];
  }
  if (role === "MANAGER") {
    return ["SUPER_ADMIN", "ADMIN", "EXECUTIVE"];
  }
  return ["SUPER_ADMIN", "ADMIN", "MANAGER"];
}

async function districtIdsForUser(userId: string) {
  const rows = await prisma.userDistrictAssignment.findMany({
    where: { userId },
    select: { districtId: true }
  });
  return [...new Set(rows.map((row) => row.districtId))];
}

async function districtScopeIdsForUser(input: { id: string; role: InternalRole }) {
  const assignmentDistrictIdsPromise = districtIdsForUser(input.id);
  const leadDistrictIdsPromise =
    input.role === "EXECUTIVE"
      ? prisma.lead.findMany({
          where: { assignedExecutiveId: input.id },
          select: { districtId: true }
        })
      : input.role === "MANAGER"
        ? prisma.lead.findMany({
            where: { assignedManagerId: input.id },
            select: { districtId: true }
          })
        : Promise.resolve([]);

  const [assignmentDistrictIds, leadDistrictRows] = await Promise.all([
    assignmentDistrictIdsPromise,
    leadDistrictIdsPromise
  ]);

  return [
    ...new Set([
      ...assignmentDistrictIds,
      ...leadDistrictRows.map((row) => row.districtId)
    ])
  ];
}

async function touchUserActivity(userId: string) {
  const now = new Date();
  const staleThreshold = new Date(now.getTime() - 60_000);
  await prisma.user.updateMany({
    where: {
      id: userId,
      OR: [
        { lastLoginAt: null },
        { lastLoginAt: { lt: staleThreshold } }
      ]
    },
    data: {
      lastLoginAt: now
    }
  });
}

function touchUserActivitySafe(userId: string) {
  void touchUserActivity(userId).catch((error) => {
    console.warn("chat_presence_touch_failed", {
      userId,
      error
    });
  });
}

async function userCanAccessLead(
  user: { id: string; role: InternalRole },
  lead: { id: string; districtId: string; assignedExecutiveId: string | null; assignedManagerId: string | null }
) {
  if (isElevatedRole(user.role)) return true;
  if (user.role === "EXECUTIVE") {
    return lead.assignedExecutiveId === user.id;
  }
  if (lead.assignedManagerId === user.id) {
    return true;
  }
  const assignment = await prisma.userDistrictAssignment.findFirst({
    where: {
      userId: user.id,
      districtId: lead.districtId
    },
    select: { id: true }
  });
  return Boolean(assignment);
}

async function assertRolePairAndScope(input: {
  actor: { id: string; role: InternalRole };
  peer: { id: string; role: InternalRole; status: UserStatus };
}) {
  const { actor, peer } = input;
  if (peer.status !== "ACTIVE") {
    throw new AppError(400, "CHAT_PEER_INACTIVE", "Selected user is not active");
  }
  if (actor.id === peer.id) {
    throw new AppError(400, "CHAT_SELF_NOT_ALLOWED", "Cannot start chat with yourself");
  }
  const allowed = allowedPeerRolesFor(actor.role);
  if (!allowed.includes(peer.role)) {
    throw new AppError(403, "CHAT_ROLE_PAIR_FORBIDDEN", "This role combination cannot chat");
  }
}

function buildConversationKey(input: { actorUserId: string; participantUserId: string; leadId?: string }) {
  const pair = [input.actorUserId, input.participantUserId].sort();
  if (input.leadId) {
    return `lead:${input.leadId}:${pair[0]}:${pair[1]}`;
  }
  return `direct:${pair[0]}:${pair[1]}`;
}

function dedupeParticipantsById<
  T extends {
    id: string;
  }
>(items: T[]) {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    output.push(item);
  }
  return output;
}

function computeLatestActivity(input: { lastSeenAt: Date | null; lastLoginAt: Date | null }) {
  if (input.lastSeenAt && input.lastLoginAt) {
    return input.lastSeenAt.getTime() >= input.lastLoginAt.getTime()
      ? input.lastSeenAt
      : input.lastLoginAt;
  }
  return input.lastSeenAt ?? input.lastLoginAt ?? null;
}

async function getUserActivityMap(userIds: string[]) {
  const uniqueUserIds = [...new Set(userIds)];
  if (uniqueUserIds.length === 0) {
    return new Map<string, { isOnline: boolean; lastActiveAt: Date | null }>();
  }

  const [users, deviceTokens] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: uniqueUserIds } },
      select: {
        id: true,
        lastLoginAt: true
      }
    }),
    prisma.userDeviceToken.groupBy({
      by: ["userId"],
      where: { userId: { in: uniqueUserIds } },
      _max: {
        lastSeenAt: true
      }
    })
  ]);

  const deviceLastSeenByUserId = new Map<string, Date | null>(
    deviceTokens.map((row) => [row.userId, row._max.lastSeenAt ?? null])
  );

  const now = Date.now();
  const activityMap = new Map<string, { isOnline: boolean; lastActiveAt: Date | null }>();
  for (const user of users) {
    const lastActiveAt = computeLatestActivity({
      lastSeenAt: deviceLastSeenByUserId.get(user.id) ?? null,
      lastLoginAt: user.lastLoginAt
    });
    const isOnline =
      lastActiveAt !== null && now - lastActiveAt.getTime() <= ONLINE_ACTIVITY_WINDOW_MS;
    activityMap.set(user.id, {
      isOnline,
      lastActiveAt
    });
  }

  return activityMap;
}

async function getConversationForUserOrFail(
  conversationId: string,
  user: { id: string; role: InternalRole }
) {
  const conversation = await prisma.chatConversation.findFirst({
    where: {
      id: conversationId,
      participants: {
        some: { userId: user.id }
      }
    },
    select: {
      id: true,
      key: true,
      type: true,
      leadId: true,
      districtId: true,
      lastMessageAt: true
    }
  });
  if (!conversation) {
    throw new AppError(404, "CHAT_NOT_FOUND", "Conversation not found");
  }

  if (conversation.leadId) {
    const lead = await prisma.lead.findUnique({
      where: { id: conversation.leadId },
      select: {
        id: true,
        districtId: true,
        assignedExecutiveId: true,
        assignedManagerId: true
      }
    });
    if (!lead) {
      throw new AppError(404, "LEAD_NOT_FOUND", "Lead not found");
    }
    const allowed = await userCanAccessLead(user, lead);
    if (!allowed) {
      throw new AppError(403, "CHAT_LEAD_SCOPE_FORBIDDEN", "You cannot access this lead chat");
    }
  }

  return conversation;
}

chatRouter.get("/participants", validateQuery(listParticipantsQuerySchema), async (req, res) => {
  const query = req.query as unknown as z.infer<typeof listParticipantsQuerySchema>;
  const actor = req.user!;
  touchUserActivitySafe(actor.id);

  try {
    const actorRole = actor.role;
    const searchFilter: Prisma.UserWhereInput | undefined = query.search
      ? {
          OR: [
            { fullName: { contains: query.search, mode: "insensitive" } },
            { email: { contains: query.search, mode: "insensitive" } }
          ]
        }
      : undefined;

    const baseSelect = {
      id: true,
      fullName: true,
      email: true,
      role: true,
      status: true,
      districts: {
        select: {
          district: {
            select: {
              id: true,
              name: true,
              state: true
            }
          }
        }
      }
    } satisfies Prisma.UserSelect;

    let participants: Array<
      Prisma.UserGetPayload<{
        select: typeof baseSelect;
      }>
    > = [];

    if (actorRole === "SUPER_ADMIN" || actorRole === "ADMIN") {
      participants = await prisma.user.findMany({
        where: {
          id: { not: actor.id },
          status: "ACTIVE",
          role: {
            in: allowedPeerRolesFor(actorRole)
          },
          ...(searchFilter ? { AND: [searchFilter] } : {})
        },
        select: baseSelect,
        orderBy: [{ role: "asc" }, { fullName: "asc" }],
        take: 100
      });
    } else if (actorRole === "MANAGER") {
      const actorDistrictIds = await districtScopeIdsForUser({
        id: actor.id,
        role: actorRole
      });
      const [adminsAndSuperAdmins, scopedExecutives, leadLinkedExecutives] =
        await Promise.all([
          prisma.user.findMany({
            where: {
              id: { not: actor.id },
              status: "ACTIVE",
              role: { in: ["SUPER_ADMIN", "ADMIN"] },
              ...(searchFilter ? { AND: [searchFilter] } : {})
            },
            select: baseSelect,
            orderBy: [{ role: "asc" }, { fullName: "asc" }],
            take: 100
          }),
          actorDistrictIds.length > 0
            ? prisma.user.findMany({
                where: {
                  id: { not: actor.id },
                  status: "ACTIVE",
                  role: "EXECUTIVE",
                  districts: {
                    some: {
                      districtId: { in: actorDistrictIds }
                    }
                  },
                  ...(searchFilter ? { AND: [searchFilter] } : {})
                },
                select: baseSelect,
                orderBy: [{ role: "asc" }, { fullName: "asc" }],
                take: 100
              })
            : Promise.resolve([]),
          prisma.user.findMany({
            where: {
              id: { not: actor.id },
              status: "ACTIVE",
              role: "EXECUTIVE",
              assignedAsExec: {
                some: {
                  assignedManagerId: actor.id
                }
              },
              ...(searchFilter ? { AND: [searchFilter] } : {})
            },
            select: baseSelect,
            orderBy: [{ role: "asc" }, { fullName: "asc" }],
            take: 100
          })
        ]);
      participants = dedupeParticipantsById([
        ...adminsAndSuperAdmins,
        ...scopedExecutives,
        ...leadLinkedExecutives
      ]);
    } else {
      const [adminsAndSuperAdmins, allDistrictManagers] = await Promise.all([
        prisma.user.findMany({
          where: {
            id: { not: actor.id },
            status: "ACTIVE",
            role: { in: ["SUPER_ADMIN", "ADMIN"] },
            ...(searchFilter ? { AND: [searchFilter] } : {})
          },
          select: baseSelect,
          orderBy: [{ role: "asc" }, { fullName: "asc" }],
          take: 100
        }),
        prisma.user.findMany({
          where: {
            id: { not: actor.id },
            status: "ACTIVE",
            role: "MANAGER",
            ...(searchFilter ? { AND: [searchFilter] } : {})
          },
          select: baseSelect,
          orderBy: [{ role: "asc" }, { fullName: "asc" }],
          take: 100
        })
      ]);
      participants = dedupeParticipantsById([
        ...adminsAndSuperAdmins,
        ...allDistrictManagers
      ]);
    }

    const userActivityByUserId = await getUserActivityMap(participants.map((participant) => participant.id));

    return ok(
      res,
      participants.map((participant) => {
        const activity = userActivityByUserId.get(participant.id);
        return {
        id: participant.id,
        fullName: participant.fullName,
        email: participant.email,
        role: participant.role,
        roleLabel: roleLabel(participant.role),
        status: participant.status,
        isOnline: activity?.isOnline ?? false,
        lastActiveAt: activity?.lastActiveAt ?? null,
        districts: participant.districts.map((entry) => entry.district)
        };
      }),
      "Chat participants fetched"
    );
  } catch (error) {
    console.error("chat_participants_fetch_failed", {
      actorUserId: actor.id,
      actorRole: actor.role,
      search: query.search ?? null,
      error
    });
    throw error;
  }
});

chatRouter.post("/conversations", validateBody(createConversationSchema), async (req, res) => {
  const body = req.body as z.infer<typeof createConversationSchema>;
  const actor = req.user!;
  touchUserActivitySafe(actor.id);

  const peer = await prisma.user.findUnique({
    where: { id: body.participantUserId },
    select: {
      id: true,
      role: true,
      status: true
    }
  });

  if (!peer) {
    throw new AppError(404, "CHAT_PEER_NOT_FOUND", "Selected user not found");
  }

  await assertRolePairAndScope({
    actor: { id: actor.id, role: actor.role },
    peer
  });

  let leadContext:
    | { id: string; districtId: string; assignedExecutiveId: string | null; assignedManagerId: string | null }
    | null = null;

  if (body.leadId) {
    leadContext = await prisma.lead.findUnique({
      where: { id: body.leadId },
      select: {
        id: true,
        districtId: true,
        assignedExecutiveId: true,
        assignedManagerId: true
      }
    });
    if (!leadContext) {
      throw new AppError(404, "LEAD_NOT_FOUND", "Lead not found");
    }

    const [actorAllowed, peerAllowed] = await Promise.all([
      userCanAccessLead({ id: actor.id, role: actor.role }, leadContext),
      userCanAccessLead({ id: peer.id, role: peer.role }, leadContext)
    ]);

    if (!actorAllowed || !peerAllowed) {
      throw new AppError(403, "CHAT_LEAD_SCOPE_FORBIDDEN", "One or more users cannot access this lead");
    }
  }

  const conversationKey = buildConversationKey({
    actorUserId: actor.id,
    participantUserId: peer.id,
    leadId: body.leadId
  });

  let conversation = await prisma.chatConversation.findUnique({
    where: { key: conversationKey },
    select: { id: true }
  });

  if (!conversation) {
    try {
      conversation = await prisma.chatConversation.create({
        data: {
          key: conversationKey,
          type: body.leadId ? "LEAD" : "DIRECT",
          leadId: body.leadId ?? null,
          districtId: leadContext?.districtId ?? null,
          createdByUserId: actor.id,
          lastMessageAt: new Date(),
          participants: {
            create: [{ userId: actor.id, lastReadAt: new Date() }, { userId: peer.id }]
          }
        },
        select: { id: true }
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        conversation = await prisma.chatConversation.findUnique({
          where: { key: conversationKey },
          select: { id: true }
        });
      } else {
        throw error;
      }
    }
  }

  if (!conversation) {
    throw new AppError(500, "CHAT_CREATE_FAILED", "Unable to create conversation");
  }

  await createAuditLog({
    actorUserId: actor.id,
    action: "CHAT_CONVERSATION_UPSERTED",
    entityType: "chat_conversation",
    entityId: conversation.id,
    detailsJson: {
      peerUserId: peer.id,
      leadId: body.leadId ?? null
    },
    ipAddress: requestIp(req)
  });

  return created(res, { conversationId: conversation.id }, "Conversation ready");
});

chatRouter.get("/conversations", validateQuery(listConversationsQuerySchema), async (req, res) => {
  const query = req.query as unknown as z.infer<typeof listConversationsQuerySchema>;
  const actor = req.user!;
  touchUserActivitySafe(actor.id);
  const queryStartedAt = Date.now();
  const actorDistrictIds =
    actor.role === "MANAGER"
      ? await districtScopeIdsForUser({
          id: actor.id,
          role: actor.role
        })
      : [];
  const actorDistrictIdSet = new Set(actorDistrictIds);

  const rows = await prisma.chatConversationParticipant.findMany({
    where: {
      userId: actor.id,
      conversation: query.leadId
        ? {
            leadId: query.leadId
          }
        : undefined
    },
    orderBy: [
      {
        conversation: {
          lastMessageAt: "desc"
        }
      },
      {
        joinedAt: "desc"
      }
    ],
    take: 100,
    include: {
      conversation: {
        include: {
          lead: {
            select: {
              id: true,
              externalId: true,
              name: true,
              districtId: true,
              assignedExecutiveId: true,
              assignedManagerId: true,
              district: {
                select: {
                  id: true,
                  name: true,
                  state: true
                }
              }
            }
          },
          participants: {
            select: {
              userId: true,
              lastReadAt: true,
              user: {
                select: {
                  id: true,
                  fullName: true,
                  role: true,
                  status: true
                }
              }
            }
          },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              body: true,
              createdAt: true,
              senderUserId: true
            }
          }
        }
      }
    }
  }).catch((error) => {
    console.error("chat_conversations_fetch_failed", {
      actorUserId: actor.id,
      actorRole: actor.role,
      leadId: query.leadId ?? null,
      error
    });
    throw error;
  });

  const scopedRows = (
    await Promise.all(
      rows.map(async (row) => {
        const lead = row.conversation.lead;
        if (!lead || isElevatedRole(actor.role)) {
          return row;
        }

        let canAccess = false;
        if (actor.role === "EXECUTIVE") {
          canAccess = lead.assignedExecutiveId === actor.id;
        } else {
          canAccess =
            lead.assignedManagerId === actor.id ||
            actorDistrictIdSet.has(lead.districtId);
        }
        return canAccess ? row : null;
      })
    )
  ).filter(
    (
      row
    ): row is (typeof rows)[number] => Boolean(row)
  );

  const participantUserIds = scopedRows.flatMap((row) =>
    row.conversation.participants.map((participant) => participant.user.id)
  );
  const userActivityByUserId = await getUserActivityMap(participantUserIds);

  const data = scopedRows.map((row) => {
    const participants = row.conversation.participants.map((participant) => ({
      id: participant.user.id,
      fullName: participant.user.fullName,
      role: participant.user.role,
      roleLabel: roleLabel(participant.user.role),
      status: participant.user.status,
      isOnline: userActivityByUserId.get(participant.user.id)?.isOnline ?? false,
      lastActiveAt: userActivityByUserId.get(participant.user.id)?.lastActiveAt ?? null
    }));
    const peerParticipants = participants.filter((participant) => participant.id !== actor.id);
    const lastMessage = row.conversation.messages[0] ?? null;
    const hasUnread =
      lastMessage !== null &&
      lastMessage.senderUserId !== actor.id &&
      (!row.lastReadAt ||
        new Date(lastMessage.createdAt).getTime() > new Date(row.lastReadAt).getTime());
    return {
      id: row.conversation.id,
      type: row.conversation.type,
      lead: row.conversation.lead
        ? {
            id: row.conversation.lead.id,
            externalId: row.conversation.lead.externalId,
            name: row.conversation.lead.name,
            district: row.conversation.lead.district
          }
        : null,
      participants,
      peers: peerParticipants,
      lastMessage: lastMessage
        ? {
            id: lastMessage.id,
            body: lastMessage.body,
            createdAt: lastMessage.createdAt,
            senderUserId: lastMessage.senderUserId
          }
        : null,
      unreadCount: hasUnread ? 1 : 0,
      lastReadAt: row.lastReadAt,
      lastMessageAt: row.conversation.lastMessageAt
    };
  });

  logSlowChatOperation("list_conversations", {
    actorUserId: actor.id,
    actorRole: actor.role,
    durationMs: Date.now() - queryStartedAt,
    rowCount: data.length
  });

  return ok(res, data, "Chat conversations fetched");
});

chatRouter.get(
  "/conversations/:conversationId/messages",
  validateParams(conversationIdParamSchema),
  validateQuery(listMessagesQuerySchema),
  async (req, res) => {
    const { conversationId } = req.params as z.infer<typeof conversationIdParamSchema>;
    const query = req.query as unknown as z.infer<typeof listMessagesQuerySchema>;
    const actor = req.user!;
    touchUserActivitySafe(req.user!.id);
    const queryStartedAt = Date.now();
    const conversation = await getConversationForUserOrFail(conversationId, {
      id: actor.id,
      role: actor.role
    });
    const before = query.before ? new Date(query.before) : null;

    const messages = await prisma.chatMessage.findMany({
      where: {
        conversationId: conversation.id,
        ...(before
          ? {
              createdAt: {
                lt: before
              }
            }
          : {})
      },
      orderBy: { createdAt: "desc" },
      take: query.take,
      include: {
        senderUser: {
          select: {
            id: true,
            fullName: true,
            role: true
          }
        }
      }
    });

    const ordered = [...messages].reverse();

    logSlowChatOperation("list_messages", {
      actorUserId: actor.id,
      actorRole: actor.role,
      conversationId: conversation.id,
      durationMs: Date.now() - queryStartedAt,
      messageCount: ordered.length,
      take: query.take
    });

    return ok(
      res,
      {
        conversation: {
          id: conversation.id,
          type: conversation.type,
          leadId: conversation.leadId
        },
        messages: ordered.map((message) => ({
          id: message.id,
          body: message.body,
          createdAt: message.createdAt,
          sender: {
            id: message.senderUser.id,
            fullName: message.senderUser.fullName,
            role: message.senderUser.role,
            roleLabel: roleLabel(message.senderUser.role)
          }
        }))
      },
      "Chat messages fetched"
    );
  }
);

chatRouter.post(
  "/conversations/:conversationId/messages",
  validateParams(conversationIdParamSchema),
  validateBody(createMessageSchema),
  async (req, res) => {
    const { conversationId } = req.params as z.infer<typeof conversationIdParamSchema>;
    const body = req.body as z.infer<typeof createMessageSchema>;
    const actor = req.user!;
    touchUserActivitySafe(actor.id);
    const sendStartedAt = Date.now();
    const conversation = await getConversationForUserOrFail(conversationId, {
      id: actor.id,
      role: actor.role
    });
    const now = new Date();

    try {
      const transactionStartedAt = Date.now();
      const message = await prisma.$transaction(async (tx) => {
        const createdMessage = await tx.chatMessage.create({
          data: {
            conversationId: conversation.id,
            senderUserId: actor.id,
            body: body.body
          },
          select: {
            id: true,
            body: true,
            createdAt: true,
            senderUserId: true
          }
        });

        await tx.chatConversation.update({
          where: { id: conversation.id },
          data: {
            lastMessageAt: createdMessage.createdAt
          }
        });

        await tx.chatConversationParticipant.updateMany({
          where: {
            conversationId: conversation.id,
            userId: actor.id
          },
          data: {
            lastReadAt: now
          }
        });

        return createdMessage;
      });

      logSlowChatOperation("send_message_transaction", {
        actorUserId: actor.id,
        actorRole: actor.role,
        conversationId: conversation.id,
        durationMs: Date.now() - transactionStartedAt
      });

      void (async () => {
        try {
          const activeParticipants = await prisma.chatConversationParticipant.findMany({
            where: {
              conversationId: conversation.id,
              user: {
                status: "ACTIVE"
              }
            },
            select: {
              userId: true,
              user: {
                select: {
                  role: true
                }
              }
            }
          });

          let recipientIds = activeParticipants
            .map((participant) => participant.userId)
            .filter((userId) => userId !== actor.id);

          if (conversation.leadId && recipientIds.length > 0) {
            const lead = await prisma.lead.findUnique({
              where: { id: conversation.leadId },
              select: {
                id: true,
                districtId: true,
                assignedExecutiveId: true,
                assignedManagerId: true
              }
            });

            if (lead) {
              const scopedRecipients = await Promise.all(
                activeParticipants
                  .filter((participant) => participant.userId !== actor.id)
                  .map(async (participant) => {
                    const allowed = await userCanAccessLead(
                      { id: participant.userId, role: participant.user.role },
                      lead
                    );
                    return allowed ? participant.userId : null;
                  })
              );
              recipientIds = scopedRecipients.filter(
                (userId): userId is string => Boolean(userId)
              );
            } else {
              recipientIds = [];
            }
          }

          await Promise.all(
            recipientIds.map((userId) =>
              enqueueInAppNotification({
                userId,
                title: "New chat message",
                body: `${actor.fullName}: ${body.body.slice(0, 120)}`,
                type: "CHAT_MESSAGE",
                leadId: conversation.leadId ?? undefined,
                entityType: "chat_conversation",
                entityId: conversation.id,
                metadata: {
                  conversationId: conversation.id,
                  senderUserId: actor.id
                }
              })
            )
          );

          await createAuditLog({
            actorUserId: actor.id,
            action: "CHAT_MESSAGE_SENT",
            entityType: "chat_message",
            entityId: message.id,
            detailsJson: {
              conversationId: conversation.id,
              leadId: conversation.leadId
            },
            ipAddress: requestIp(req)
          });
        } catch (sideEffectError) {
          console.error("chat_message_side_effects_failed", {
            actorUserId: actor.id,
            conversationId: conversation.id,
            messageId: message.id,
            error: sideEffectError
          });
        }
      })();

      logSlowChatOperation("send_message_total", {
        actorUserId: actor.id,
        actorRole: actor.role,
        conversationId: conversation.id,
        durationMs: Date.now() - sendStartedAt
      });

      return created(
        res,
        {
          id: message.id,
          body: message.body,
          createdAt: message.createdAt,
          sender: {
            id: actor.id,
            fullName: actor.fullName,
            role: actor.role,
            roleLabel: roleLabel(actor.role)
          }
        },
        "Chat message sent"
      );
    } catch (error) {
      console.error("chat_message_send_failed", {
        actorUserId: actor.id,
        conversationId: conversation.id,
        leadId: conversation.leadId,
        error
      });
      throw error;
    }
  }
);

chatRouter.post(
  "/conversations/:conversationId/read",
  validateParams(conversationIdParamSchema),
  async (req, res) => {
    const { conversationId } = req.params as z.infer<typeof conversationIdParamSchema>;
    touchUserActivitySafe(req.user!.id);
    const conversation = await getConversationForUserOrFail(conversationId, {
      id: req.user!.id,
      role: req.user!.role
    });
    const now = new Date();

    await prisma.chatConversationParticipant.updateMany({
      where: {
        conversationId: conversation.id,
        userId: req.user!.id
      },
      data: {
        lastReadAt: now
      }
    });

    return ok(
      res,
      {
        conversationId: conversation.id,
        readAt: now
      },
      "Conversation marked read"
    );
  }
);

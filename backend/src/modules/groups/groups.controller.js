import { groupsService } from './groups.service.js';

export const groupsController = (app, config) => {
  const service = groupsService(app, config);
  const broadcastMessage = (id, message) => app.broadcaster.conversation(id, 'message.created', message);
  return {
    create: async (request, reply) => {
      const result = await service.create(request.auth.userId, request.body);
      reply.code(201);
      await app.broadcaster.conversation(result.conversation.id, 'conversation.created', result.conversation);
      await broadcastMessage(result.conversation.id, result.message);
      return result.conversation;
    },
    details: (request) => service.details(request.params.id, request.auth.userId),
    list: (request) => service.list(request.auth.userId),
    members: (request) => service.members(request.params.id, request.auth.userId),
    update: async (request) => {
      const conversation = await service.update(request.params.id, request.auth.userId, request.body);
      await app.broadcaster.conversation(request.params.id, 'conversation.updated', conversation);
      return conversation;
    },
    add: async (request, reply) => {
      const result = await service.add(request.params.id, request.auth.userId, request.body.userId);
      await app.broadcaster.conversation(request.params.id, 'group.member_added', {
        conversationId: request.params.id,
        userId: result.userId,
      });
      await broadcastMessage(request.params.id, result.message);
      reply.code(201);
      return { userId: result.userId };
    },
    role: async (request) => {
      const result = await service.role(request.params.id, request.auth.userId, request.params.userId, request.body.role);
      await app.broadcaster.conversation(request.params.id, 'group.member_updated', {
        conversationId: request.params.id,
        userId: result.userId,
        role: result.role,
      });
      await broadcastMessage(request.params.id, result.message);
      return { success: true };
    },
    transfer: async (request) => {
      const result = await service.transfer(request.params.id, request.auth.userId, request.body.userId);
      await app.broadcaster.conversation(request.params.id, 'group.owner_transferred', {
        conversationId: request.params.id,
        userId: result.userId,
      });
      await broadcastMessage(request.params.id, result.message);
      return { success: true };
    },
    leave: async (request) => {
      const result = await service.leave(request.params.id, request.auth.userId);
      app.broadcaster.user(result.userId, 'group.member_left', { conversationId: request.params.id });
      await app.broadcaster.conversation(request.params.id, 'group.member_left', {
        conversationId: request.params.id,
        userId: result.userId,
      });
      await broadcastMessage(request.params.id, result.message);
      return { success: true };
    },
    remove: async (request) => {
      const result = await service.remove(request.params.id, request.auth.userId, request.params.userId);
      app.broadcaster.user(result.userId, 'group.member_removed', { conversationId: request.params.id });
      await app.broadcaster.conversation(request.params.id, 'group.member_removed', {
        conversationId: request.params.id,
        userId: result.userId,
      });
      await broadcastMessage(request.params.id, result.message);
      return { success: true };
    },
  };
};

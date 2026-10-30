import { receiptsService } from './receipts.service.js';
export const receiptsController = (app) => {
  const service = receiptsService(app);
  return {
    list: (request) => service.list(request.params.id, request.auth.userId),
    listConversation: (request) => service.listConversation(request.params.id, request.auth.userId),
    delivered: async (request) => {
      const message = await service.delivered(request.params.id, request.auth.userId);
      app.broadcaster.conversation(message.conversationId, 'receipt.updated', {
        conversationId: message.conversationId,
        userId: request.auth.userId,
        messageId: message.id,
        delivered: true,
      });
      return { success: true };
    },
  };
};

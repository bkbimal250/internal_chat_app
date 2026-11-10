import assert from 'node:assert/strict';
import test from 'node:test';
import { messageNotificationCopy, messagePreview, senderLabel } from '../services/notify-copy.js';

test('uses the employee full name when present', () => {
  assert.equal(senderLabel({ fullName: 'Sonam Sharma', displayName: 'Sonam' }), 'Sonam Sharma');
  assert.equal(senderLabel({ displayName: 'Sonam' }), 'Sonam');
  assert.equal(senderLabel({}), 'Colleague');
});

test('builds WhatsApp-style notification copy', () => {
  assert.deepEqual(
    messageNotificationCopy({
      isGroup: false,
      senderName: 'Sonam Sharma',
      preview: 'Hey, please check the latest project update.',
    }),
    { title: 'Sonam Sharma', body: 'Hey, please check the latest project update.' },
  );
  assert.deepEqual(
    messageNotificationCopy({
      isGroup: true,
      groupTitle: 'Marketing Team',
      senderName: 'Sonam Sharma',
      preview: "Please review today's campaign report.",
    }),
    { title: 'Marketing Team', body: "Sonam Sharma: Please review today's campaign report." },
  );
  assert.deepEqual(
    messageNotificationCopy({
      isGroup: true,
      groupTitle: 'Marketing Team',
      senderName: 'Sonam Sharma',
      preview: 'secret',
      showPreview: false,
    }),
    { title: 'Company Chat', body: 'New group message' },
  );
});

test('previews media without leaking deleted content', () => {
  assert.equal(messagePreview({ messageType: 'image', content: '' }), 'Photo');
  assert.equal(messagePreview({ messageType: 'text', content: 'hello', deletedAt: new Date() }), 'Message unavailable');
  assert.equal(
    messagePreview({
      messageType: 'file',
      content: '',
      attachment: { originalName: 'secret.pdf', displayName: 'MiChat Document 2026-11-10 at 5.42.17 PM.pdf' },
    }),
    'MiChat Document 2026-11-10 at 5.42.17 PM.pdf',
  );
});

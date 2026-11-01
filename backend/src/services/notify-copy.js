export function senderLabel(user) {
  const full = String(user?.fullName || '').trim();
  const display = String(user?.displayName || '').trim();
  return full || display || 'Colleague';
}

export function messagePreview(message) {
  if (!message || message.deletedAt || message.expiredAt) return 'Message unavailable';
  const type = message.messageType || 'text';
  const content = String(message.content || '').trim();
  if (type === 'image') return content || 'Photo';
  if (type === 'video') return content || 'Video';
  if (type === 'audio') return content || 'Audio';
  if (type === 'file') return content || message.attachment?.originalName || 'File';
  if (type === 'system') return content || 'Update';
  return content || 'New message';
}

export function messageNotificationCopy({
  isGroup,
  groupTitle,
  senderName,
  preview,
  showPreview = true,
}) {
  if (!showPreview) {
    return {
      title: 'Company Chat',
      body: isGroup ? 'New group message' : 'New message',
    };
  }
  if (isGroup) {
    return {
      title: groupTitle || 'Group',
      body: `${senderName}: ${preview}`,
    };
  }
  return {
    title: senderName || 'Colleague',
    body: preview,
  };
}

const DISPLAY_TIMEZONE = 'Asia/Kolkata';

const KIND_LABEL = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  file: 'Document',
};

const MIME_EXTENSION = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/3gpp': '3gp',
  'video/3gpp2': '3g2',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'm4a',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'weba',
  'audio/3gpp': '3gp',
  'audio/amr': 'amr',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
};

export function stampInZone(value = new Date(), timeZone = DISPLAY_TIMEZONE) {
  const date = value instanceof Date ? value : new Date(value);
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    })
      .formatToParts(safe)
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${Number(parts.hour)}.${parts.minute}.${parts.second} ${parts.dayPeriod}`,
  };
}

export function fileExtension(originalName, mimeType) {
  const fromName = String(originalName || '')
    .split('.')
    .pop();
  const candidate =
    fromName && fromName !== originalName
      ? fromName.toLowerCase().replace(/[^a-z0-9]/g, '')
      : '';
  if (candidate && candidate.length <= 8) return candidate;
  return MIME_EXTENSION[String(mimeType || '').toLowerCase()] || 'bin';
}

export function safeFileName(name, fallback = 'file') {
  const cleaned = [...String(name || fallback)]
    .map((char) => {
      const code = char.charCodeAt(0);
      if (code < 32 || '<>:"/\\|?*'.includes(char)) return '_';
      return char;
    })
    .join('')
    .replace(/^\.+/g, '_')
    .replace(/\.+$/g, '_')
    .trim()
    .slice(0, 180);
  return cleaned || fallback;
}

export function zipEntryName(name) {
  const base = String(name || 'file')
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('_');
  return safeFileName(base, 'file');
}

export function displayFileName(row, at = row?.finalizedAt || row?.createdAt) {
  const kind = KIND_LABEL[row?.kind] || 'Document';
  const stamp = stampInZone(at);
  const ext = fileExtension(row?.originalName, row?.mimeType);
  return safeFileName(`MiChat ${kind} ${stamp.date} at ${stamp.time}.${ext}`);
}

export function archiveFileName(at = new Date()) {
  const stamp = stampInZone(at);
  return safeFileName(`MiChat Files ${stamp.date} at ${stamp.time}.zip`);
}

export function uniqueDisplayNames(rows = []) {
  const used = new Map();
  return rows.map((row, index) => {
    const baseName = zipEntryName(displayFileName(row));
    const dot = baseName.lastIndexOf('.');
    const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
    const ext = dot > 0 ? baseName.slice(dot) : '';
    const seen = used.get(baseName) || 0;
    used.set(baseName, seen + 1);
    if (!seen) return baseName;
    const suffix = row?.id ? String(row.id).replace(/-/g, '').slice(-4) : String(index + 1);
    let next = `${stem} (${seen + 1})${ext}`;
    let extra = 2;
    while (used.has(next)) {
      next = `${stem} (${seen + extra}-${suffix})${ext}`;
      extra += 1;
    }
    used.set(next, 1);
    return next;
  });
}

export function contentDispositionAttachment(filename) {
  const ascii = safeFileName(filename).replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

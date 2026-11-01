import { putWithProgress } from '@/features/messages/attachment-upload'

const ACCEPT = ['image/jpeg', 'image/png', 'image/webp']

export const PHOTO_ACCEPT = ACCEPT.join(',')

export async function uploadProfilePhoto(file, initFn, completeFn) {
  if (!ACCEPT.includes(file.type)) {
    throw new Error('Use a JPEG, PNG, or WebP image')
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Photos must be 5 MB or smaller')
  }
  const init = await initFn({ mimeType: file.type })
  await putWithProgress(init.uploadUrl, file, init.headers)
  return completeFn({ key: init.key, mimeType: file.type })
}

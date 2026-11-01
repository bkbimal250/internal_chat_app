import { useEffect, useState } from 'react'
import { Download, FileText, Play, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { attachmentsApi } from '@/services/api'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { getErrorMessage } from '@/services/api-error'
import { formatEta, formatSize } from '@/features/messages/media-limits'
import { toast } from 'sonner'

function useSignedUrl(attachmentId, enabled) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!attachmentId || !enabled) return undefined
    let cancelled = false
    attachmentsApi
      .url(attachmentId)
      .then((result) => {
        if (!cancelled) setUrl(result.url)
      })
      .catch((error) => {
        if (!cancelled) toast.error(getErrorMessage(error))
      })
    return () => {
      cancelled = true
    }
  }, [attachmentId, enabled])
  return url
}

export function AttachmentThumb({ attachment, className, onClick }) {
  const preview = useSignedUrl(
    attachment?.id,
    Boolean(attachment) && (attachment.kind === 'image' || attachment.kind === 'video'),
  )
  const kind = attachment?.kind

  if (kind === 'image') {
    return (
      <button
        type="button"
        className={cn('relative block overflow-hidden bg-muted', className)}
        onClick={onClick}
        aria-label={attachment.originalName || 'Open image'}
      >
        {preview ? <img src={preview} alt="" className="size-full object-cover" /> : null}
      </button>
    )
  }

  if (kind === 'video') {
    return (
      <button
        type="button"
        className={cn('relative block overflow-hidden bg-muted', className)}
        onClick={onClick}
        aria-label={attachment.originalName || 'Open video'}
      >
        {preview ? <video src={preview} className="size-full object-cover" muted /> : null}
        <span className="absolute inset-0 flex items-center justify-center bg-black/25">
          <Play className="size-5 fill-white text-white" />
        </span>
      </button>
    )
  }

  return (
    <button
      type="button"
      className={cn('flex items-center justify-center bg-muted', className)}
      onClick={onClick}
      aria-label={attachment.originalName || 'Open file'}
    >
      <FileText className="size-5 text-muted-foreground" />
    </button>
  )
}

export async function downloadAttachment(attachment) {
  if (!attachment?.id) throw new Error('Missing attachment')
  const result = await attachmentsApi.url(attachment.id, { download: true })
  const fileName = result.fileName || attachment.originalName || 'download'
  try {
    const response = await fetch(result.url)
    if (!response.ok) throw new Error('Download failed')
    const href = URL.createObjectURL(await response.blob())
    const link = document.createElement('a')
    link.href = href
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(href), 1500)
  } catch {
    const link = document.createElement('a')
    link.href = result.url
    link.download = fileName
    link.rel = 'noopener'
    link.target = '_blank'
    document.body.appendChild(link)
    link.click()
    link.remove()
  }
}

function DownloadControl({ onClick, className, busy = false }) {
  return (
    <button
      type="button"
      data-testid="download-attachment"
      aria-label="Download"
      disabled={busy}
      className={cn(
        'flex size-8 items-center justify-center rounded-full bg-black/55 text-white shadow-sm hover:bg-black/70 disabled:opacity-60',
        className,
      )}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClick()
      }}
    >
      <Download className="size-4" />
    </button>
  )
}

export function AttachmentMedia({ attachment, caption }) {
  const [lightbox, setLightbox] = useState(false)
  const [saving, setSaving] = useState(false)
  const preview = useSignedUrl(attachment?.id, Boolean(attachment) && attachment.kind !== 'file')
  const kind = attachment?.kind

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      await downloadAttachment(attachment)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  if (!attachment || attachment.status !== 'available') return caption ? <p>{caption}</p> : null

  return (
    <div className="space-y-2" data-testid="attachment-card" data-kind={kind}>
      {kind === 'image' && preview ? (
        <div className="relative inline-block max-w-full">
          <button type="button" className="block max-w-full" onClick={() => setLightbox(true)} aria-label="Open image">
            <img
              src={preview}
              alt={attachment.originalName}
              className="max-h-72 max-w-full rounded-lg object-cover"
              data-testid="attachment-image"
            />
          </button>
          <DownloadControl className="absolute right-1.5 bottom-1.5" onClick={save} busy={saving} />
        </div>
      ) : null}
      {kind === 'video' && preview ? (
        <div className="relative inline-block max-w-full">
          <video src={preview} controls className="max-h-72 max-w-full rounded-lg" data-testid="attachment-video">
            <track kind="captions" />
          </video>
          <DownloadControl className="absolute top-1.5 right-1.5" onClick={save} busy={saving} />
        </div>
      ) : null}
      {kind === 'audio' && preview ? (
        <div className="flex items-center gap-2">
          <audio src={preview} controls className="min-w-0 flex-1" data-testid="attachment-audio" />
          <DownloadControl onClick={save} busy={saving} />
        </div>
      ) : null}
      {kind === 'file' ? (
        <div className="flex items-center gap-3 rounded-lg bg-black/5 px-3 py-2">
          <FileText className="size-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{attachment.originalName}</p>
            <p className="text-xs opacity-70">{formatSize(attachment.sizeBytes)}</p>
          </div>
          <Button type="button" size="icon" variant="ghost" aria-label="Download" onClick={save} disabled={saving}>
            <Download className="size-4" />
          </Button>
        </div>
      ) : null}
      {caption ? <p className="whitespace-pre-wrap break-words">{caption}</p> : null}
      <Dialog open={lightbox} onOpenChange={setLightbox}>
        <DialogContent className="max-w-4xl border-none bg-black p-2">
          <DialogTitle className="sr-only">{attachment.originalName}</DialogTitle>
          {preview ? <img src={preview} alt={attachment.originalName} className="max-h-[80vh] w-full object-contain" /> : null}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="absolute top-2 right-12 text-white"
            aria-label="Download"
            onClick={save}
            disabled={saving}
          >
            <Download />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="absolute top-2 right-2 text-white"
            aria-label="Close"
            onClick={() => setLightbox(false)}
          >
            <X />
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function UploadProgress({ item, onCancel, onRetry }) {
  const phase = item.phase === 'compressing' ? 'Compressing' : item.phase === 'finalizing' ? 'Finishing' : 'Uploading'
  const eta = formatEta(item.etaSeconds)
  return (
    <div className="mb-2 rounded-md bg-muted px-3 py-2 text-xs" data-testid="upload-progress">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate">{item.file.name}</span>
        <span>{item.error ? 'Failed' : `${item.progress ?? 0}%`}</span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {item.error
          ? 'Upload interrupted. Retry keeps the same file.'
          : `${phase}${item.sent != null ? ` · ${formatSize(item.sent)} of ${formatSize(item.total || item.file.size)}` : ''}${eta ? ` · ${eta}` : ''}`}
      </p>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-background">
        <div className="h-full bg-primary transition-all" style={{ width: `${item.progress ?? 0}%` }} />
      </div>
      <div className="mt-1 flex justify-end gap-2">
        {item.error ? (
          <button type="button" onClick={() => onRetry(item)}>
            Retry
          </button>
        ) : (
          <button type="button" onClick={() => onCancel(item)}>
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

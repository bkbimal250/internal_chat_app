import { useEffect, useState } from 'react'
import { Download, FileText, X } from 'lucide-react'
import { attachmentsApi } from '@/services/api'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { getErrorMessage } from '@/services/api-error'
import { toast } from 'sonner'

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

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

export function AttachmentMedia({ attachment, caption }) {
  const [lightbox, setLightbox] = useState(false)
  const preview = useSignedUrl(attachment?.id, Boolean(attachment) && attachment.kind !== 'file')
  const kind = attachment?.kind

  async function download() {
    try {
      const result = await attachmentsApi.url(attachment.id)
      const link = document.createElement('a')
      link.href = result.url
      link.download = attachment.originalName
      link.rel = 'noopener'
      link.click()
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  if (!attachment || attachment.status !== 'available') return caption ? <p>{caption}</p> : null

  return (
    <div className="space-y-2" data-testid="attachment-card" data-kind={kind}>
      {kind === 'image' && preview ? (
        <button type="button" className="block max-w-full" onClick={() => setLightbox(true)} aria-label="Open image">
          <img
            src={preview}
            alt={attachment.originalName}
            className="max-h-72 max-w-full rounded-lg object-cover"
            data-testid="attachment-image"
          />
        </button>
      ) : null}
      {kind === 'video' && preview ? (
        <video src={preview} controls className="max-h-72 max-w-full rounded-lg" data-testid="attachment-video">
          <track kind="captions" />
        </video>
      ) : null}
      {kind === 'audio' && preview ? (
        <audio src={preview} controls className="w-full" data-testid="attachment-audio" />
      ) : null}
      {kind === 'file' ? (
        <div className="flex items-center gap-3 rounded-lg bg-black/5 px-3 py-2">
          <FileText className="size-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{attachment.originalName}</p>
            <p className="text-xs opacity-70">{formatSize(attachment.sizeBytes)}</p>
          </div>
          <Button type="button" size="icon" variant="ghost" aria-label="Download file" onClick={download}>
            <Download className="size-4" />
          </Button>
        </div>
      ) : null}
      {caption ? <p className="whitespace-pre-wrap break-words">{caption}</p> : null}
      {kind !== 'file' ? (
        <button type="button" className="text-[11px] underline opacity-80" onClick={download}>
          Download
        </button>
      ) : null}
      <Dialog open={lightbox} onOpenChange={setLightbox}>
        <DialogContent className="max-w-4xl border-none bg-black p-2">
          <DialogTitle className="sr-only">{attachment.originalName}</DialogTitle>
          {preview ? <img src={preview} alt={attachment.originalName} className="max-h-[80vh] w-full object-contain" /> : null}
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
  return (
    <div className="mb-2 rounded-md bg-muted px-3 py-2 text-xs" data-testid="upload-progress">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate">{item.file.name}</span>
        <span>{item.error ? 'Failed' : `${item.progress}%`}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-background">
        <div className="h-full bg-primary transition-all" style={{ width: `${item.progress}%` }} />
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

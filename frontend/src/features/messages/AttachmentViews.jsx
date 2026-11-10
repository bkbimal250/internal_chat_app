import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, FileText, Play, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { attachmentsApi } from '@/services/api'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { getErrorMessage } from '@/services/api-error'
import { formatEta, formatSize } from '@/features/messages/media-limits'
import { messageAttachments } from '@/features/messages/attachment-batch'
import { attachmentDisplayName } from '@/lib/michat-filename'
import { downloadAttachmentsZip } from '@/features/messages/download-zip'
import { toast } from 'sonner'

function useSignedUrl(attachmentId, enabled) {
  const [url, setUrl] = useState('')
  const [failed, setFailed] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [seen, setSeen] = useState({ attachmentId, enabled, nonce })
  if (seen.attachmentId !== attachmentId || seen.enabled !== enabled || seen.nonce !== nonce) {
    setSeen({ attachmentId, enabled, nonce })
    setFailed(false)
    setUrl('')
  }
  useEffect(() => {
    if (!attachmentId || !enabled) return undefined
    let cancelled = false
    attachmentsApi
      .url(attachmentId)
      .then((result) => {
        if (!cancelled) {
          setFailed(false)
          setUrl(result.url)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setFailed(true)
          toast.error(getErrorMessage(error))
        }
      })
    return () => {
      cancelled = true
    }
  }, [attachmentId, enabled, nonce])
  return { url, failed, refresh: () => setNonce((value) => value + 1) }
}

export function AttachmentThumb({ attachment, className, onClick }) {
  const { url: preview } = useSignedUrl(
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
        aria-label={attachmentDisplayName(attachment)}
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
        aria-label={attachmentDisplayName(attachment)}
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
      aria-label={attachmentDisplayName(attachment)}
    >
      <FileText className="size-5 text-muted-foreground" />
    </button>
  )
}

export async function downloadAttachment(attachment) {
  if (!attachment?.id) throw new Error('Missing attachment')
  const result = await attachmentsApi.url(attachment.id, { download: true })
  const fileName = result.fileName || attachmentDisplayName(attachment)
  const size = Number(attachment.sizeBytes || 0)
  if (size > 32 * 1024 * 1024) {
    const link = document.createElement('a')
    link.href = result.url
    link.download = fileName
    link.rel = 'noopener'
    link.target = '_blank'
    document.body.appendChild(link)
    link.click()
    link.remove()
    return
  }
  try {
    const response = await fetch(result.url)
    if (!response.ok) throw new Error('Download failed')
    const buffer = await response.arrayBuffer()
    if (size && buffer.byteLength !== size) throw new Error('Download incomplete')
    const href = URL.createObjectURL(new Blob([buffer], { type: result.mimeType || attachment.mimeType }))
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

function FileRow({ attachment, onSave, saving }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-black/5 px-3 py-2" data-testid="attachment-file">
      <FileText className="size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{attachmentDisplayName(attachment)}</p>
        <p className="text-xs opacity-70">{formatSize(attachment.sizeBytes)}</p>
      </div>
      <Button type="button" size="icon" variant="ghost" aria-label="Download" onClick={() => onSave(attachment)} disabled={saving}>
        <Download className="size-4" />
      </Button>
    </div>
  )
}

function MediaTile({ attachment, onOpen, className, overlay, fill = false }) {
  const { url, refresh } = useSignedUrl(
    attachment?.id,
    Boolean(attachment) && (attachment.kind === 'image' || attachment.kind === 'video'),
  )
  const mediaClass = fill ? 'size-full object-cover' : 'max-h-72 max-w-full object-cover'
  return (
    <button
      type="button"
      className={cn('relative block overflow-hidden bg-muted', className)}
      onClick={() => onOpen(attachment)}
      aria-label={attachmentDisplayName(attachment)}
    >
      {attachment.kind === 'image' && url ? (
        <img
          src={url}
          alt=""
          className={mediaClass}
          data-testid="attachment-image"
          onError={refresh}
        />
      ) : null}
      {attachment.kind === 'video' && url ? (
        <video src={url} className={mediaClass} muted data-testid="attachment-video" onError={refresh} />
      ) : null}
      {attachment.kind === 'video' ? (
        <span className="absolute inset-0 flex items-center justify-center bg-black/25">
          <Play className="size-5 fill-white text-white" />
        </span>
      ) : null}
      {overlay ? (
        <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-lg font-semibold text-white">
          {overlay}
        </span>
      ) : null}
    </button>
  )
}

function Viewer({ files, index, onIndex, onClose, onSave, saving }) {
  const current = files[index]
  const { url, failed, refresh } = useSignedUrl(current?.id, Boolean(current) && current.kind !== 'file')
  if (!current) return null
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl border-none bg-black p-2">
        <DialogTitle className="sr-only">{attachmentDisplayName(current)}</DialogTitle>
        <div className="relative flex min-h-[40vh] items-center justify-center">
          {failed ? (
            <Button type="button" variant="secondary" onClick={refresh}>
              Retry
            </Button>
          ) : current.kind === 'image' && url ? (
            <img src={url} alt="" className="max-h-[80vh] w-full object-contain" onError={refresh} />
          ) : current.kind === 'video' && url ? (
            <video src={url} controls autoPlay className="max-h-[80vh] w-full" onError={refresh}>
              <track kind="captions" />
            </video>
          ) : current.kind === 'audio' && url ? (
            <audio src={url} controls className="w-full" onError={refresh} />
          ) : (
            <FileRow attachment={current} onSave={onSave} saving={saving} />
          )}
          {files.length > 1 ? (
            <>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="absolute top-1/2 left-1 -translate-y-1/2 text-white"
                aria-label="Previous"
                onClick={() => onIndex((index - 1 + files.length) % files.length)}
              >
                <ChevronLeft />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="absolute top-1/2 right-1 -translate-y-1/2 text-white"
                aria-label="Next"
                onClick={() => onIndex((index + 1) % files.length)}
              >
                <ChevronRight />
              </Button>
            </>
          ) : null}
        </div>
        <p className="px-2 text-center text-xs text-white/80">
          {attachmentDisplayName(current)} · {formatSize(current.sizeBytes)}
          {files.length > 1 ? ` · ${index + 1}/${files.length}` : ''}
        </p>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="absolute top-2 right-12 text-white"
          aria-label="Download"
          onClick={() => onSave(current)}
          disabled={saving}
        >
          <Download />
        </Button>
        <Button type="button" size="icon" variant="ghost" className="absolute top-2 right-2 text-white" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </DialogContent>
    </Dialog>
  )
}

function AudioCard({ attachment, onSave, saving }) {
  const { url, refresh } = useSignedUrl(attachment?.id, true)
  return (
    <div className="flex items-center gap-2">
      {url ? <audio src={url} controls className="min-w-0 flex-1" data-testid="attachment-audio" onError={refresh} /> : null}
      <DownloadControl onClick={() => onSave(attachment)} busy={saving} />
    </div>
  )
}

function VideoCard({ attachment, onSave, saving, onOpen }) {
  const { url, refresh } = useSignedUrl(attachment?.id, true)
  return (
    <div className="relative inline-block max-w-full">
      {url ? (
        <video src={url} controls className="max-h-72 max-w-full rounded-lg" data-testid="attachment-video" onError={refresh} onClick={() => onOpen?.(attachment)}>
          <track kind="captions" />
        </video>
      ) : null}
      <DownloadControl className="absolute top-1.5 right-1.5" onClick={() => onSave(attachment)} busy={saving} />
    </div>
  )
}

export function AttachmentMedia({ attachment, attachments, caption, conversationId }) {
  const [viewer, setViewer] = useState(null)
  const [saving, setSaving] = useState(false)
  const [zipping, setZipping] = useState(false)
  const [zipProgress, setZipProgress] = useState(null)
  const zipAbort = useRef(null)
  const files = (attachments?.length ? attachments : attachment ? [attachment] : []).filter(
    (file) => file && file.status === 'available',
  )

  async function save(file) {
    if (saving) return
    setSaving(true)
    try {
      await downloadAttachment(file)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function saveAll() {
    if (zipping || files.length < 2 || !conversationId) return
    const controller = new AbortController()
    zipAbort.current = controller
    setZipping(true)
    setZipProgress({ percent: 0, received: 0 })
    try {
      await downloadAttachmentsZip({
        conversationId,
        ids: files.map((file) => file.id),
        signal: controller.signal,
        onProgress: setZipProgress,
      })
    } catch (error) {
      if (error?.name !== 'AbortError') toast.error(getErrorMessage(error) || 'Unable to download ZIP')
    } finally {
      zipAbort.current = null
      setZipping(false)
      setZipProgress(null)
    }
  }

  if (!files.length) return caption ? <p>{caption}</p> : null

  const visuals = files.filter((file) => file.kind === 'image' || file.kind === 'video')
  const audios = files.filter((file) => file.kind === 'audio')
  const docs = files.filter((file) => file.kind === 'file')
  const grid = visuals.slice(0, 4)
  const extra = visuals.length - 4

  return (
    <div className="space-y-2" data-testid="attachment-card" data-kind={files.length > 1 ? 'album' : files[0].kind} data-count={files.length}>
      {visuals.length === 1 && visuals[0].kind === 'video' ? (
        <VideoCard attachment={visuals[0]} onSave={save} saving={saving} onOpen={(file) => setViewer(files.indexOf(file))} />
      ) : visuals.length === 1 ? (
        <div className="relative inline-block max-w-full">
          <MediaTile
            attachment={visuals[0]}
            onOpen={() => setViewer(files.indexOf(visuals[0]))}
            className="max-h-72 max-w-full rounded-lg"
          />
          <DownloadControl className="absolute right-1.5 bottom-1.5" onClick={() => save(visuals[0])} busy={saving} />
        </div>
      ) : visuals.length > 1 ? (
        <div
          className={cn(
            'grid max-w-[280px] gap-0.5 overflow-hidden rounded-lg',
            visuals.length === 2 ? 'grid-cols-2' : 'grid-cols-2',
          )}
          data-testid="attachment-album"
        >
          {grid.map((file, index) => (
            <MediaTile
              key={file.id || index}
              attachment={file}
              fill
              onOpen={() => setViewer(files.indexOf(file))}
              className={cn('aspect-square', visuals.length === 3 && index === 0 && 'row-span-2')}
              overlay={index === 3 && extra > 0 ? `+${extra}` : null}
            />
          ))}
        </div>
      ) : null}
      {audios.map((file) => (
        <AudioCard key={file.id} attachment={file} onSave={save} saving={saving} />
      ))}
      {docs.map((file) => (
        <FileRow key={file.id} attachment={file} onSave={save} saving={saving} />
      ))}
      {files.length > 1 && conversationId ? (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-testid="download-all-zip"
            disabled={zipping}
            onClick={saveAll}
          >
            {zipping ? 'Preparing ZIP…' : 'Download all'}
          </Button>
          {zipping ? (
            <button
              type="button"
              className="text-xs underline"
              onClick={() => zipAbort.current?.abort()}
            >
              Cancel
            </button>
          ) : null}
        </div>
      ) : null}
      {zipProgress ? (
        <p className="text-[11px] opacity-70" data-testid="zip-progress">
          {zipProgress.percent != null ? `${zipProgress.percent}%` : formatSize(zipProgress.received || 0)} prepared
        </p>
      ) : null}
      {caption ? <p className="whitespace-pre-wrap break-words">{caption}</p> : null}
      {viewer != null ? (
        <Viewer
          files={files}
          index={viewer}
          onIndex={setViewer}
          onClose={() => setViewer(null)}
          onSave={save}
          saving={saving}
        />
      ) : null}
    </div>
  )
}

export { messageAttachments }

export function UploadProgress({ item, onCancel, onRetry }) {
  const phase = item.phase === 'compressing' ? 'Compressing' : item.phase === 'finalizing' ? 'Finishing' : 'Uploading'
  const eta = formatEta(item.etaSeconds)
  return (
    <div className="mb-2 rounded-md bg-muted px-3 py-2 text-xs" data-testid="upload-progress">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate">{item.kind === 'image' ? 'Image' : item.kind === 'video' ? 'Video' : item.kind === 'audio' ? 'Audio' : 'Document'}</span>
        <span>{item.error ? 'Failed' : `${item.progress ?? 0}%`}</span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {item.error
          ? item.needsFile
            ? 'Reload dropped the file handle. Reselect the same file to resume.'
            : 'Upload interrupted. Retry resumes uploaded chunks when possible.'
          : `${phase}${item.sent != null ? ` · ${formatSize(item.sent)} of ${formatSize(item.total || item.file?.size || item.size)}` : ''}${eta ? ` · ${eta}` : ''}`}
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

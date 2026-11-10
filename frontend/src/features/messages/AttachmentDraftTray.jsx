import { FileAudio, FileText, Play, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatSize } from '@/features/messages/media-limits'
import { batchProgress, formatDuration, MAX_ATTACHMENT_BATCH } from '@/features/messages/attachment-batch'
import { cn } from '@/lib/utils'

function DraftThumb({ item, onRemove, onRetry, onCancel, sending }) {
  const failed = item.status === 'failed' || item.error
  return (
    <div className="relative w-20 shrink-0" data-testid="attachment-draft-item" data-status={item.status || 'queued'}>
      <div className="relative aspect-square overflow-hidden rounded-lg bg-muted">
        {item.kind === 'image' && item.previewUrl ? (
          <img src={item.previewUrl} alt="" className="size-full object-cover" />
        ) : item.kind === 'video' && item.previewUrl ? (
          <>
            <video src={item.previewUrl} className="size-full object-cover" muted />
            <span className="absolute inset-0 flex items-center justify-center bg-black/25">
              <Play className="size-4 fill-white text-white" />
            </span>
            {item.duration ? (
              <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 text-[10px] text-white">
                {formatDuration(item.duration)}
              </span>
            ) : null}
          </>
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1 px-1 text-center">
            {item.kind === 'audio' ? (
              <FileAudio className="size-5 text-muted-foreground" />
            ) : (
              <FileText className="size-5 text-muted-foreground" />
            )}
            <span className="line-clamp-2 text-[9px] leading-tight text-muted-foreground">
              {item.kind === 'image' ? 'Image' : item.kind === 'video' ? 'Video' : item.kind === 'audio' ? 'Audio' : 'Document'}
            </span>
          </div>
        )}
        {item.status === 'uploading' ? (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/30">
            <div className="h-full bg-primary" style={{ width: `${item.progress || 0}%` }} />
          </div>
        ) : null}
        {failed ? <div className="absolute inset-0 bg-destructive/30" /> : null}
      </div>
      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{formatSize(item.file?.size)}</p>
      {item.kind === 'audio' && item.duration ? (
        <p className="truncate text-[10px] text-muted-foreground">{formatDuration(item.duration)}</p>
      ) : null}
      <button
        type="button"
        className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background"
        aria-label="Remove file"
        onClick={() => onRemove(item)}
        disabled={sending && item.status === 'uploading'}
      >
        <X className="size-3" />
      </button>
      {failed ? (
        <button
          type="button"
          className="absolute top-1 left-1 flex size-6 items-center justify-center rounded-full bg-background/90"
          aria-label="Retry upload"
          onClick={() => onRetry(item)}
        >
          <RotateCcw className="size-3" />
        </button>
      ) : item.status === 'uploading' ? (
        <button
          type="button"
          className="absolute bottom-5 left-1 rounded bg-black/70 px-1 text-[10px] text-white"
          onClick={() => onCancel(item)}
        >
          Cancel
        </button>
      ) : null}
    </div>
  )
}

export function AttachmentDraftTray({
  items,
  sending,
  onRemove,
  onRetry,
  onCancel,
  onAddMore,
  onClear,
}) {
  if (!items?.length) return null
  const progress = batchProgress(items)
  return (
    <div className="mb-2 rounded-xl border bg-card p-2" data-testid="attachment-draft-tray">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <p className="text-xs font-medium">
          {items.length}/{MAX_ATTACHMENT_BATCH} selected
          {progress.failed ? ` · ${progress.failed} failed` : ''}
        </p>
        <div className="flex items-center gap-2">
          {items.length < MAX_ATTACHMENT_BATCH ? (
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onAddMore}>
              Add
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onClear} disabled={sending}>
            Clear
          </Button>
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {items.map((item) => (
          <DraftThumb
            key={item.id}
            item={item}
            sending={sending}
            onRemove={onRemove}
            onRetry={onRetry}
            onCancel={onCancel}
          />
        ))}
      </div>
      {sending || progress.percent > 0 ? (
        <div className="mt-2 px-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className={cn('h-full bg-primary transition-all', progress.failed && 'bg-destructive')} style={{ width: `${progress.percent}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {progress.failed
              ? 'Some files failed. Retry or remove them, then send.'
              : `${formatSize(progress.sent)} of ${formatSize(progress.total)}`}
          </p>
        </div>
      ) : null}
    </div>
  )
}

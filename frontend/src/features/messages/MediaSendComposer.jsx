import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Copy,
  Download,
  FileAudio,
  FileText,
  Play,
  Plus,
  Redo2,
  RotateCw,
  Smile,
  Sun,
  Undo2,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { MAX_ATTACHMENT_BATCH } from '@/features/messages/attachment-batch'
import { bakeComposerItems, hasImageEdits } from '@/features/messages/bake-image-edits'
import { formatSize } from '@/features/messages/media-limits'

const WA_GREEN = '#25D366'
const QUICK_EMOJI = ['😀', '😂', '❤️', '👍', '🔥', '🎉', '🙏', '😍']
const emptyEdit = { rotation: 0, brightness: 1, stack: [{ rotation: 0, brightness: 1 }], cursor: 0 }

function IconBtn({ label, disabled, active, onClick, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex size-10 items-center justify-center rounded-full text-[#54656f] transition-colors hover:bg-black/[0.04] disabled:opacity-30',
        active && 'bg-black/[0.06] text-[#111b21]',
      )}
    >
      {children}
    </button>
  )
}

function kindLabel(kind) {
  if (kind === 'image') return 'Image'
  if (kind === 'video') return 'Video'
  if (kind === 'audio') return 'Audio'
  return 'Document'
}

export function MediaSendComposer({
  items = [],
  caption,
  onCaptionChange,
  sending,
  quality,
  onQualityChange,
  onAddMore,
  onSend,
  onRetry,
  onCancelUpload,
  onRemove,
  onRequestClose,
  discardOpen,
  onConfirmDiscard,
  onCancelDiscard,
}) {
  const [selectedId, setSelectedId] = useState(items[0]?.id)
  const [history, setHistory] = useState({})
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [baking, setBaking] = useState(false)
  const [bakeError, setBakeError] = useState('')

  const selected = items.find((item) => item.id === selectedId) ?? items[0]
  const edit = history[selected?.id] || emptyEdit
  const imageSelected = selected?.kind === 'image'
  const hdOn = quality === 'high' || quality === 'original'
  const busy = sending || baking

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (discardOpen) onCancelDiscard?.()
        else onRequestClose?.()
        return
      }
      if (discardOpen) return
      if (event.target?.closest?.('input, textarea, [contenteditable="true"]')) return
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected && onRemove) {
        event.preventDefault()
        onRemove(selected)
        return
      }
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        const index = items.findIndex((item) => item.id === selected?.id)
        if (index < 0) return
        const next = event.key === 'ArrowRight' ? index + 1 : index - 1
        const item = items[(next + items.length) % items.length]
        if (item) setSelectedId(item.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [discardOpen, items, onCancelDiscard, onRemove, onRequestClose, selected])

  function pushEdit(next) {
    if (!selected || selected.kind !== 'image') return
    setHistory((current) => {
      const prev = current[selected.id] || emptyEdit
      const stack = prev.stack.slice(0, prev.cursor + 1).concat(next)
      return { ...current, [selected.id]: { ...next, stack, cursor: stack.length - 1 } }
    })
  }

  function undo() {
    if (!selected || edit.cursor <= 0) return
    setHistory((current) => {
      const prev = current[selected.id]
      const cursor = prev.cursor - 1
      return { ...current, [selected.id]: { ...prev, ...prev.stack[cursor], cursor } }
    })
  }

  function redo() {
    if (!selected || edit.cursor >= edit.stack.length - 1) return
    setHistory((current) => {
      const prev = current[selected.id]
      const cursor = prev.cursor + 1
      return { ...current, [selected.id]: { ...prev, ...prev.stack[cursor], cursor } }
    })
  }

  function downloadSelected() {
    if (!selected?.previewUrl && !selected?.file) return
    const href = selected.previewUrl || URL.createObjectURL(selected.file)
    const link = document.createElement('a')
    link.href = href
    link.download = selected.file?.name || 'file'
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  async function copySelected() {
    try {
      if (selected?.file && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ [selected.file.type]: selected.file })])
        return
      }
      if (selected?.previewUrl) await navigator.clipboard.writeText(selected.previewUrl)
    } catch {
      /* clipboard may be unavailable */
    }
  }

  async function handleSend() {
    if (busy || !items.length) return
    setBakeError('')
    setBaking(true)
    try {
      const prepared = await bakeComposerItems(items, history)
      onSend?.(prepared)
    } catch (error) {
      setBakeError(error?.message || 'Could not apply photo edits. Try again.')
    } finally {
      setBaking(false)
    }
  }

  if (!items.length || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-white text-[#111b21]"
      data-testid="attachment-draft-tray"
      role="dialog"
      aria-modal="true"
      aria-label="Send photos and files"
    >
      <header className="flex h-14 shrink-0 items-center justify-between px-2 sm:px-3">
        <div className="flex items-center">
          <IconBtn label="Close" onClick={onRequestClose}>
            <X className="size-[22px]" strokeWidth={1.75} />
          </IconBtn>
          <span className="hidden w-6 sm:block" />
          <IconBtn label="Undo" disabled={!imageSelected || edit.cursor <= 0} onClick={undo}>
            <Undo2 className="size-5" strokeWidth={1.75} />
          </IconBtn>
          <IconBtn label="Redo" disabled={!imageSelected || edit.cursor >= edit.stack.length - 1} onClick={redo}>
            <Redo2 className="size-5" strokeWidth={1.75} />
          </IconBtn>
        </div>
        <div className="flex items-center">
          <IconBtn
            label="Rotate"
            disabled={!imageSelected}
            active={imageSelected && edit.rotation !== 0}
            onClick={() => pushEdit({ rotation: (edit.rotation + 90) % 360, brightness: edit.brightness })}
          >
            <RotateCw className="size-5" strokeWidth={1.75} />
          </IconBtn>
          <IconBtn
            label="Brightness"
            disabled={!imageSelected}
            active={imageSelected && edit.brightness !== 1}
            onClick={() => {
              const next = edit.brightness === 1 ? 1.25 : edit.brightness === 1.25 ? 0.8 : 1
              pushEdit({ rotation: edit.rotation, brightness: next })
            }}
          >
            <Sun className="size-5" strokeWidth={1.75} />
          </IconBtn>
          <IconBtn
            label={hdOn ? 'HD on' : 'HD off'}
            active={hdOn}
            onClick={() => onQualityChange?.(hdOn ? 'auto' : 'high')}
          >
            <span className="rounded-[3px] border border-current px-[3px] py-px text-[9px] font-bold leading-none tracking-wide">
              HD
            </span>
          </IconBtn>
          <span className="hidden w-5 sm:block" />
          <IconBtn label="Copy" onClick={copySelected}>
            <Copy className="size-5" strokeWidth={1.75} />
          </IconBtn>
          <IconBtn label="Download" onClick={downloadSelected}>
            <Download className="size-5" strokeWidth={1.75} />
          </IconBtn>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-2">
        {selected?.kind === 'image' && selected.previewUrl ? (
          <img
            src={selected.previewUrl}
            alt=""
            className="max-h-full max-w-[min(100%,560px)] object-contain shadow-[0_2px_18px_rgba(0,0,0,0.12)]"
            style={{ transform: `rotate(${edit.rotation}deg)`, filter: `brightness(${edit.brightness})` }}
          />
        ) : selected?.kind === 'video' && selected.previewUrl ? (
          <video src={selected.previewUrl} className="max-h-[70vh] max-w-[min(100%,560px)] object-contain" controls />
        ) : (
          <div className="flex flex-col items-center gap-3 text-center">
            {selected?.kind === 'audio' ? (
              <FileAudio className="size-16 text-[#54656f]" />
            ) : (
              <FileText className="size-16 text-[#54656f]" />
            )}
            <p className="text-lg">{kindLabel(selected?.kind)}</p>
            <p className="text-sm text-[#667781]">{selected?.file?.name}</p>
            <p className="text-sm text-[#667781]">{formatSize(selected?.file?.size || 0)}</p>
          </div>
        )}
      </div>

      <div className="relative shrink-0 px-4 pb-4">
        <div className="mx-auto flex h-11 w-full max-w-[36rem] items-center rounded-full border border-[#e9edef] bg-white px-4">
          <input
            value={caption}
            onChange={(event) => onCaptionChange?.(event.target.value)}
            placeholder="Type a message"
            aria-label="Caption"
            data-testid="media-caption"
            autoFocus
            className="min-w-0 flex-1 bg-transparent text-[15px] text-[#111b21] outline-none placeholder:text-[#8696a0]"
          />
          <button
            type="button"
            aria-label="Insert emoji"
            className="ml-2 text-[#8696a0] hover:text-[#54656f]"
            onClick={() => setEmojiOpen((open) => !open)}
          >
            <Smile className="size-5" strokeWidth={1.75} />
          </button>
        </div>
        {emojiOpen ? (
          <div className="absolute bottom-16 left-1/2 z-20 flex -translate-x-1/2 flex-wrap gap-1 rounded-2xl border border-[#e9edef] bg-white p-2 shadow-md">
            {QUICK_EMOJI.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="size-9 rounded-lg text-lg hover:bg-black/5"
                onClick={() => {
                  onCaptionChange?.(`${caption || ''}${emoji}`)
                  setEmojiOpen(false)
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : null}
        {bakeError ? <p className="mt-2 text-center text-sm text-[#e75c5c]">{bakeError}</p> : null}
      </div>

      <div className="relative flex min-h-[88px] shrink-0 items-center border-t border-[#f0f2f5] px-4">
        <div className="flex w-full items-center justify-center gap-2 overflow-x-auto py-4">
          {items.map((item) => {
            const active = item.id === selected?.id
            return (
              <div key={item.id} className="relative shrink-0">
                <button
                  type="button"
                  data-testid="attachment-draft-item"
                  data-status={item.status || 'queued'}
                  aria-label={kindLabel(item.kind)}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => setSelectedId(item.id)}
                  className={cn(
                    'relative size-[52px] overflow-hidden rounded-[4px] bg-[#f0f2f5]',
                    active ? 'outline outline-[3px] outline-[#25D366] outline-offset-0' : 'outline outline-1 outline-[#e9edef]',
                  )}
                >
                  {item.kind === 'image' && item.previewUrl ? (
                    <img src={item.previewUrl} alt="" className="size-full object-cover" />
                  ) : item.kind === 'video' && item.previewUrl ? (
                    <>
                      <video src={item.previewUrl} className="size-full object-cover" muted />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/25">
                        <Play className="size-4 fill-white text-white" />
                      </span>
                    </>
                  ) : (
                    <span className="flex size-full items-center justify-center text-[#54656f]">
                      {item.kind === 'audio' ? <FileAudio className="size-5" /> : <FileText className="size-5" />}
                    </span>
                  )}
                  {hasImageEdits(history[item.id]) ? (
                    <span className="absolute right-0.5 bottom-0.5 size-1.5 rounded-full bg-[#25D366]" />
                  ) : null}
                  {item.status === 'uploading' ? (
                    <span className="absolute inset-x-0 bottom-0 h-1 bg-black/30">
                      <span className="block h-full bg-[#25D366]" style={{ width: `${item.progress || 0}%` }} />
                    </span>
                  ) : null}
                  {item.status === 'failed' || item.error ? <span className="absolute inset-0 bg-red-500/30" /> : null}
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${kindLabel(item.kind).toLowerCase()}`}
                  data-testid="attachment-draft-remove"
                  onClick={() => onRemove?.(item)}
                  className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-[#111b21] text-white shadow-sm"
                >
                  <X className="size-3" strokeWidth={2.5} />
                </button>
              </div>
            )
          })}
          {items.length < MAX_ATTACHMENT_BATCH ? (
            <button
              type="button"
              aria-label="Add files"
              data-testid="media-add-more"
              onClick={onAddMore}
              className="flex size-[52px] shrink-0 items-center justify-center rounded-[4px] border border-[#d1d7db] bg-white text-[#667781] hover:bg-[#f0f2f5]"
            >
              <Plus className="size-6" strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Send"
          data-testid="send-message"
          disabled={busy || !items.length}
          onClick={handleSend}
          className="absolute right-5 bottom-4 flex size-[52px] shrink-0 items-center justify-center rounded-full text-white shadow-[0_2px_8px_rgba(0,0,0,0.18)] disabled:opacity-60"
          style={{ backgroundColor: WA_GREEN }}
        >
          <svg viewBox="0 0 24 24" className="ml-0.5 size-6 fill-white" aria-hidden="true">
            <path d="M3.4 20.4 20.85 12.9c.8-.35.8-1.48 0-1.82L3.4 3.6c-.66-.28-1.35.32-1.22 1.02l1.6 8.03c.06.3.06.6 0 .9l-1.6 8.03c-.13.7.56 1.3 1.22 1.02Z" />
          </svg>
          <span className="absolute top-[6px] right-[9px] text-[11px] font-semibold leading-none">{items.length}</span>
        </button>
      </div>

      {selected?.status === 'failed' ? (
        <div className="flex justify-center gap-4 pb-3 text-sm">
          <button type="button" className="text-[#25D366]" onClick={() => onRetry?.(selected)}>
            Retry
          </button>
          <button type="button" className="text-[#e75c5c]" onClick={() => onCancelUpload?.(selected) || onRemove?.(selected)}>
            Remove
          </button>
        </div>
      ) : null}

      {discardOpen ? (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-black/40"
          data-testid="discard-selection"
          onClick={onCancelDiscard}
        >
          <div
            role="dialog"
            aria-labelledby="discard-selection-title"
            className="w-[min(100%-2.5rem,22.5rem)] rounded-[28px] bg-white px-8 pt-8 pb-5 text-center shadow-[0_12px_40px_rgba(0,0,0,0.18)]"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="discard-selection-title" className="mb-8 text-[22px] font-normal tracking-tight text-[#111b21]">
              Discard selection?
            </h2>
            <button
              type="button"
              className="mb-1 w-full rounded-full border border-[#e9edef] py-[11px] text-[17px] text-[#e75c5c]"
              onClick={onConfirmDiscard}
            >
              Discard
            </button>
            <button type="button" className="w-full py-3 text-[17px] text-[#21c063]" onClick={onCancelDiscard}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  )
}

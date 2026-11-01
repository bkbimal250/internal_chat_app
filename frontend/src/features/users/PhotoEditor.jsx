import { useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/components/common/UserAvatar'
import { PHOTO_ACCEPT, uploadProfilePhoto } from '@/features/users/upload-photo'
import { getErrorMessage } from '@/services/api-error'
import { toast } from 'sonner'

export function PhotoEditor({
  person,
  initFn,
  completeFn,
  removeFn,
  onChanged,
  sizeClassName = 'size-14',
}) {
  const fileRef = useRef(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const hasPhoto = Boolean(preview || person?.hasProfilePhoto || person?.profilePhotoUrl)

  async function onFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const objectUrl = URL.createObjectURL(file)
    setPreview(objectUrl)
    setBusy(true)
    try {
      const updated = await uploadProfilePhoto(file, initFn, completeFn)
      onChanged?.(updated)
      toast.success('Photo updated')
    } catch (error) {
      setPreview(null)
      toast.error(getErrorMessage(error) === 'Request could not be processed' ? error.message : getErrorMessage(error))
    } finally {
      setBusy(false)
      URL.revokeObjectURL(objectUrl)
      setPreview(null)
    }
  }

  async function onRemove() {
    if (!removeFn || busy) return
    setBusy(true)
    try {
      const updated = await removeFn()
      setPreview(null)
      onChanged?.(updated)
      toast.success('Photo removed')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-3 px-3 py-3">
      <UserAvatar
        person={person}
        src={preview || person?.profilePhotoUrl}
        name={person?.displayName}
        className={sizeClassName}
        tooltip={false}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">Profile photo</p>
        <p className="text-[11px] text-muted-foreground">JPEG, PNG, or WebP · 5 MB max</p>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={PHOTO_ACCEPT}
        className="hidden"
        data-testid="profile-photo-input"
        onChange={onFile}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        data-testid="browse-profile-photo"
      >
        <Camera className="size-3.5" />
        {hasPhoto ? 'Change' : 'Browse'}
      </Button>
      {hasPhoto && removeFn ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={onRemove}
          data-testid="remove-profile-photo"
        >
          Remove
        </Button>
      ) : null}
    </div>
  )
}

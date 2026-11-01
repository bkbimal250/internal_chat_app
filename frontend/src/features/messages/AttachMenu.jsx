import { Camera, FileText, Headphones, Images, Paperclip } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AUDIO_ACCEPT, CAMERA_ACCEPT, DOCUMENT_ACCEPT, MEDIA_ACCEPT } from '@/features/messages/media-limits'

const OPTIONS = [
  { id: 'document', label: 'Document', accept: DOCUMENT_ACCEPT, icon: FileText, capture: undefined },
  { id: 'media', label: 'Photos & videos', accept: MEDIA_ACCEPT, icon: Images, capture: undefined },
  { id: 'camera', label: 'Camera', accept: CAMERA_ACCEPT, icon: Camera, capture: 'environment' },
  { id: 'audio', label: 'Audio', accept: AUDIO_ACCEPT, icon: Headphones, capture: undefined },
]

export function AttachMenu({ disabled, onPick }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-9 shrink-0 rounded-full"
          aria-label="Attach"
          data-testid="attach-menu"
          disabled={disabled}
        >
          <Paperclip />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56 p-1">
        {OPTIONS.map((option) => {
          const Icon = option.icon
          return (
            <DropdownMenuItem
              key={option.id}
              className="gap-3 py-2.5"
              onSelect={(event) => {
                event.preventDefault()
                const input = document.createElement('input')
                input.type = 'file'
                input.accept = option.accept
                if (option.capture) input.setAttribute('capture', option.capture)
                input.onchange = () => {
                  const file = input.files?.[0]
                  if (file) onPick(file)
                }
                input.click()
              }}
            >
              <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Icon className="size-4" />
              </span>
              {option.label}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

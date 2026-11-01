import { useQuery } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn, initialsFromName } from '@/lib/utils'
import { queryKeys } from '@/lib/query-keys'
import { groupsApi, usersApi } from '@/services/api'

export function UserAvatar({
  person,
  userId,
  name,
  src,
  hasPhoto,
  photoVersion,
  online,
  variant = 'user',
  tooltip = true,
  className,
  fallbackClassName,
  inverted = false,
}) {
  const resolvedName = name || person?.displayName || person?.fullName || (variant === 'group' ? 'Group' : '')
  const resolvedId = userId || person?.id
  const resolvedSrc = src || person?.profilePhotoUrl || undefined
  const resolvedHasPhoto =
    hasPhoto ?? Boolean(person?.hasProfilePhoto || person?.hasAvatar || person?.profilePhotoUrl)
  const resolvedVersion = photoVersion || person?.photoVersion || person?.avatarVersion || person?.updatedAt
  const fetchPhoto = !resolvedSrc && Boolean(resolvedId && resolvedHasPhoto)
  const photo = useQuery({
    queryKey:
      variant === 'group'
        ? queryKeys.groupPhotoUrl(resolvedId, resolvedVersion)
        : queryKeys.photoUrl(resolvedId, resolvedVersion),
    queryFn: () =>
      (variant === 'group' ? groupsApi.photoUrl(resolvedId) : usersApi.photoUrl(resolvedId)).then((result) => result.url),
    enabled: fetchPhoto,
    staleTime: 45_000,
    retry: 1,
  })
  const imageSrc = resolvedSrc || photo.data || undefined
  const loading = fetchPhoto && photo.isPending
  const label = resolvedName || (variant === 'group' ? 'Group' : 'Employee')

  const avatar = (
    <span className="relative inline-flex shrink-0" data-testid={variant === 'group' ? 'group-avatar' : 'user-avatar'}>
      <Avatar
        className={cn(inverted && 'border border-sidebar-border', className)}
        aria-label={label}
      >
        {imageSrc ? (
          <AvatarImage src={imageSrc} alt="" loading="lazy" data-testid="avatar-image" />
        ) : null}
        <AvatarFallback
          className={cn(
            inverted ? 'bg-sidebar-accent text-sidebar-foreground' : '',
            fallbackClassName,
          )}
        >
          {loading ? (
            <span className="size-full animate-pulse bg-muted" aria-hidden />
          ) : variant === 'group' ? (
            <Users className="size-[55%] opacity-80" aria-hidden />
          ) : (
            initialsFromName(resolvedName)
          )}
        </AvatarFallback>
      </Avatar>
      {online ? (
        <span
          className="border-background absolute right-0 bottom-0 size-2.5 rounded-full border bg-emerald-500"
          aria-label="Online"
          data-testid="online-indicator"
        />
      ) : null}
    </span>
  )

  if (!tooltip || !resolvedName) return avatar

  return (
    <Tooltip>
      <TooltipTrigger asChild>{avatar}</TooltipTrigger>
      <TooltipContent>{resolvedName}</TooltipContent>
    </Tooltip>
  )
}

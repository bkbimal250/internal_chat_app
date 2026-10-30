import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/common/EmptyState'
import { BrandMark } from '@/components/common/BrandMark'

export function NotFoundPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6">
      <BrandMark />
      <EmptyState
        title="Page not found"
        description="That route is not part of the Company Chat workspace."
      />
      <Button asChild>
        <Link to="/">Back to messages</Link>
      </Button>
    </div>
  )
}

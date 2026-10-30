import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChangePasswordForm } from '@/features/auth/ChangePasswordForm'

export function ChangePasswordPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-2xl">Change password</CardTitle>
        <CardDescription>
          Your account requires a new password before you can use Company Chat.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChangePasswordForm />
      </CardContent>
    </Card>
  )
}

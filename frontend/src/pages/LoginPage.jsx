import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LoginForm } from '@/features/auth/LoginForm'

export function LoginPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-2xl">Sign in</CardTitle>
        <CardDescription>
          Sign in with a verified work phone or your username and password. This form talks to the live API.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm />
      </CardContent>
    </Card>
  )
}

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LoginForm } from '@/features/auth/LoginForm'

export function LoginPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-2xl">Sign in</CardTitle>
        <CardDescription>Use your employee username. This form talks to the live API, not a mock session.</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm />
      </CardContent>
    </Card>
  )
}

import { LoginForm } from '@/features/auth/LoginForm'

export function LoginPage() {
  return (
    <section
      className="rounded-2xl border border-[#E6E0D6] bg-white p-6 shadow-[0_18px_50px_-28px_rgba(23,30,37,0.35)] sm:p-8"
      data-testid="login-card"
    >
      <LoginForm />
    </section>
  )
}

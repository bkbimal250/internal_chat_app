import { Outlet } from 'react-router-dom'
import { BrandMark } from '@/components/common/BrandMark'

export function AuthLayout({ children }) {
  return (
    <div className="grid min-h-dvh bg-[#FAF6EF] md:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      <aside
        className="relative hidden overflow-hidden bg-[#171E25] text-[#FAF6EF] md:flex md:flex-col md:justify-between md:px-10 md:py-10 lg:px-14 lg:py-12"
        data-testid="login-branding"
      >
        <BrandMark inverted />
        <div className="relative z-10 max-w-lg">
          <p className="text-xs font-semibold tracking-[0.22em] text-[#C6A04B] uppercase">Internal workspace</p>
          <h1 className="font-display mt-5 text-3xl leading-tight lg:text-4xl xl:text-5xl">
            Your team. One connected workspace.
          </h1>
          <div className="mt-5 h-px w-16 bg-[#C6A04B]/80" aria-hidden="true" />
          <p className="mt-5 max-w-md text-sm leading-relaxed text-[#FAF6EF]/72 lg:text-base">
            Stay connected with your team through simple, secure and reliable conversations.
          </p>
        </div>
        <p className="relative z-10 text-sm text-[#FAF6EF]/45">Company Chat</p>
        <div className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full border border-[#C6A04B]/20" />
        <div className="pointer-events-none absolute right-16 bottom-24 size-40 rounded-full border border-[#FAF6EF]/10" />
        <div className="pointer-events-none absolute bottom-[-4rem] left-[-3rem] size-56 rotate-12 rounded-3xl border border-[#C6A04B]/12" />
      </aside>
      <main className="flex items-center justify-center px-4 py-8 sm:px-8 lg:px-12">
        <div className="w-full max-w-md">
          <div className="mb-8 md:hidden">
            <BrandMark />
          </div>
          {children ?? <Outlet />}
        </div>
      </main>
    </div>
  )
}

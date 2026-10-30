import { Outlet } from 'react-router-dom'
import { motion } from 'motion/react'
import { BrandMark } from '@/components/common/BrandMark'

export function AuthLayout() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_0.9fr]">
      <aside className="relative hidden overflow-hidden bg-sidebar text-sidebar-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
        <BrandMark inverted />
        <div className="max-w-md">
          <p className="text-xs font-semibold tracking-[0.22em] text-gold uppercase">Private workspace</p>
          <h1 className="font-display mt-4 text-4xl leading-tight">
            A quiet, reliable place for company conversations.
          </h1>
          <p className="mt-4 text-sm text-sidebar-foreground/70">
            Sign in with your employee account. Sessions stay on this device, refresh cookies stay
            HTTP-only, and access tokens never land in local storage.
          </p>
        </div>
        <p className="text-xs text-sidebar-foreground/50">Company Chat · ivory, slate, gold</p>
        <div className="pointer-events-none absolute -right-16 -bottom-20 size-72 rounded-full border border-gold/20" />
      </aside>
      <main className="flex items-center justify-center px-6 py-12">
        <motion.div
          className="w-full max-w-md"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          <div className="mb-8 lg:hidden">
            <BrandMark />
          </div>
          <Outlet />
        </motion.div>
      </main>
    </div>
  )
}

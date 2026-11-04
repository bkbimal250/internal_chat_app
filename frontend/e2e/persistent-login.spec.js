import { test, expect, chromium } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadAccounts, login } from './helpers.js'

const appOrigin = 'http://127.0.0.1:5173'
const apiOrigin = 'http://127.0.0.1:3001'

async function expectPersistentCookies(context) {
  const cookies = await context.cookies()
  const refresh = cookies.find((cookie) => cookie.name === 'chat_refresh')
  const csrf = cookies.find((cookie) => cookie.name === 'chat_csrf')
  expect(refresh, 'refresh cookie').toBeTruthy()
  expect(csrf, 'csrf cookie').toBeTruthy()
  expect(refresh.httpOnly).toBe(true)
  expect(refresh.secure).toBe(false)
  expect(refresh.sameSite).toBe('Strict')
  expect(refresh.path).toBe('/api/v1/auth')
  expect(refresh.expires).toBeGreaterThan(Date.now() / 1000 + 7 * 86400)
  expect(csrf.httpOnly).toBe(false)
  expect(csrf.path).toBe('/')
  expect(csrf.expires).toBeGreaterThan(Date.now() / 1000 + 7 * 86400)
}

test.describe('Persistent login', () => {
  test('keeps cookies for the refresh lifetime and restores after reload', async ({ page, context }) => {
    const accounts = loadAccounts()
    await login(page, accounts.alpha)
    await expectPersistentCookies(context)
    await expect(page.getByTestId('realtime-status')).toHaveText(/Realtime connected|Connecting/)
    await page.reload()
    await expect(page.getByTestId('session-restoring').or(page.getByTestId('chats-heading'))).toBeVisible()
    await expect(page.getByTestId('chats-heading')).toBeVisible()
    await expect(page).toHaveURL(`${appOrigin}/`)
    await expect(page.getByTestId('realtime-status')).toHaveText('Realtime connected', { timeout: 20_000 })
  })

  test('retries an expired access token through one refresh', async ({ page }) => {
    const accounts = loadAccounts()
    await login(page, accounts.bravo)
    let refreshCalls = 0
    let firstConversations = true
    await page.route(`${apiOrigin}/api/v1/**`, async (route) => {
      const url = route.request().url()
      if (url.includes('/auth/refresh')) {
        refreshCalls += 1
        await route.continue()
        return
      }
      if (url.includes('/conversations') && route.request().method() === 'GET' && firstConversations) {
        firstConversations = false
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'INVALID_SESSION', message: 'Invalid session', requestId: 'e2e' },
          }),
        })
        return
      }
      await route.continue()
    })
    await page.reload()
    await expect(page.getByTestId('chats-heading')).toBeVisible()
    expect(refreshCalls).toBeGreaterThanOrEqual(1)
  })

  test('keeps two devices independently authenticated', async ({ browser }) => {
    const accounts = loadAccounts()
    const first = await browser.newContext()
    const second = await browser.newContext()
    const pageA = await first.newPage()
    const pageB = await second.newPage()
    await login(pageA, accounts.charlie)
    await login(pageB, accounts.charlie)
    await expectPersistentCookies(first)
    await expectPersistentCookies(second)
    await pageA.reload()
    await pageB.reload()
    await expect(pageA.getByTestId('chats-heading')).toBeVisible()
    await expect(pageB.getByTestId('chats-heading')).toBeVisible()
    await pageA.getByTestId('sign-out').click()
    await expect(pageA).toHaveURL(`${appOrigin}/`)
    await expect(pageA.getByTestId('login-phone')).toBeVisible()
    await pageB.reload()
    await expect(pageB.getByTestId('chats-heading')).toBeVisible()
    await first.close()
    await second.close()
  })

  test('stays on the app when the API is unreachable instead of logging out', async ({ page }) => {
    const accounts = loadAccounts()
    await login(page, accounts.alpha)
    await page.route(`${apiOrigin}/api/v1/**`, (route) => route.abort('failed'))
    await page.reload()
    await expect(page.getByTestId('session-unavailable')).toBeVisible()
    await expect(page).toHaveURL(`${appOrigin}/`)
    await page.unroute(`${apiOrigin}/api/v1/**`)
    await page.getByTestId('session-retry').click()
    await expect(page.getByTestId('chats-heading')).toBeVisible()
  })

  test('clears credentials on logout and rejects a revoked refresh cookie', async ({ page, context }) => {
    const accounts = loadAccounts()
    await login(page, accounts.alpha)
    await page.getByTestId('sign-out').click()
    await expect(page).toHaveURL(`${appOrigin}/`)
    await expect(page.getByTestId('login-phone')).toBeVisible()
    const cookies = await context.cookies()
    const refresh = cookies.find((cookie) => cookie.name === 'chat_refresh')
    expect(!refresh || refresh.expires * 1000 <= Date.now()).toBeTruthy()
    await page.goto('/')
    await expect(page).toHaveURL(`${appOrigin}/`)
    await expect(page.getByTestId('login-phone')).toBeVisible()
  })

  test('restores the session from a restarted browser profile', async () => {
    const accounts = loadAccounts()
    const userDataDir = mkdtempSync(path.join(tmpdir(), 'cc-persist-'))
    const launch = () =>
      chromium.launchPersistentContext(userDataDir, {
        viewport: { width: 1440, height: 900 },
        baseURL: appOrigin,
      })

    const first = await launch()
    try {
      const page = first.pages()[0] || (await first.newPage())
      await page.goto(`${appOrigin}/`)
      await login(page, accounts.alpha)
      await expectPersistentCookies(first)
    } finally {
      await first.close()
    }

    const second = await launch()
    try {
      const page = second.pages()[0] || (await second.newPage())
      await page.goto(`${appOrigin}/`)
      await expect(page.getByTestId('chats-heading')).toBeVisible({ timeout: 20_000 })
      await expect(page).toHaveURL(`${appOrigin}/`)
      await expect(page.getByTestId('realtime-status')).toHaveText('Realtime connected', { timeout: 20_000 })
    } finally {
      await second.close()
      rmSync(userDataDir, { recursive: true, force: true })
    }
  })
})

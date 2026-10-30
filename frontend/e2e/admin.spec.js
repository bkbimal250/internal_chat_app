import { test, expect } from '@playwright/test'
import { loadAccounts, login } from './helpers.js'

test.describe('Admin dashboard', () => {
  test('creates, searches, suspends, reactivates, resets, revokes, and shows audit history', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000)
    const accounts = loadAccounts()
    const hireUsername = `e2e.${accounts.runId}.hire`
    const hireName = `E2E Hire ${accounts.runId}`

    await login(page, accounts.admin)
    await page.getByRole('link', { name: 'Admin' }).click()
    await expect(page.getByRole('heading', { name: 'Admin dashboard' })).toBeVisible()

    await page.getByRole('button', { name: 'New employee' }).click()
    await page.getByPlaceholder('Username').fill(hireUsername)
    await page.getByPlaceholder('Display name').fill(hireName)
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByTestId('temporary-password')).toBeVisible()
    const temporaryPassword = (await page.getByTestId('temporary-password').textContent()).trim()
    expect(temporaryPassword.length).toBeGreaterThanOrEqual(12)
    await page.keyboard.press('Escape')

    await page.getByPlaceholder('Search employees').fill(hireUsername)
    const row = page.getByTestId('admin-employee-row').filter({ hasText: hireUsername })
    await expect(row).toBeVisible()

    const hireContext = await browser.newContext()
    const hirePage = await hireContext.newPage()
    await login(hirePage, { username: hireUsername, password: temporaryPassword }, 'change-password')
    await hirePage.close()
    await hireContext.close()

    await row.getByRole('button', { name: 'Suspend' }).click()
    await expect(row.getByText('suspended')).toBeVisible()
    const blocked = await browser.newContext()
    const blockedPage = await blocked.newPage()
    await blockedPage.goto('/login')
    await blockedPage.getByTestId('login-username').fill(hireUsername)
    await blockedPage.getByTestId('login-password').fill(temporaryPassword)
    await blockedPage.getByTestId('login-submit').click()
    await expect(blockedPage.getByText('Invalid credentials')).toBeVisible()
    await blockedPage.close()
    await blocked.close()

    await row.getByRole('button', { name: 'Reactivate' }).click()
    await expect(row.getByText('active')).toBeVisible()
    await row.getByRole('button', { name: 'Reset password' }).click()
    await expect(page.getByText('Password reset')).toBeVisible()
    await expect(page.getByTestId('temporary-password')).toBeVisible()
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'DELETE' &&
          response.url().includes('/sessions') &&
          response.ok(),
        { timeout: 15_000 },
      ),
      row.getByTestId('admin-revoke').click(),
    ])
    await expect(page.getByText('Sessions revoked')).toBeVisible()
    await page.getByRole('tab', { name: 'Audit' }).click()
    await expect(page.getByText('admin.user_created').first()).toBeVisible()
    await expect(page.getByText('admin.user_suspended').first()).toBeVisible()
    await expect(page.getByText('admin.password_reset').first()).toBeVisible()
    await expect(page.getByText('admin.sessions_revoked').first()).toBeVisible()
  })
})

import { test, expect } from '@playwright/test'
import { loadAccounts, login, workspaceNav } from './helpers.js'

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
    await workspaceNav(page, 'Admin').click()
    await expect(page.getByRole('heading', { name: 'Admin dashboard' })).toBeVisible()
    await page.getByRole('tab', { name: 'Retention' }).click()
    await expect(page.getByTestId('admin-retention')).toBeVisible()
    await expect(page.getByText('Preview / dry-run mode')).toBeVisible()
    await page.getByRole('tab', { name: 'Employees' }).click()

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
    await blockedPage.goto('/')
    await blockedPage.getByTestId('login-try-another-way').click()
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

  test('deletes a USER account after confirmation and blocks later login', async ({ page, browser }) => {
    test.setTimeout(120_000)
    const accounts = loadAccounts()
    const hireUsername = `e2e.${accounts.runId}.remove`
    const hireName = `E2E Remove ${accounts.runId}`

    await login(page, accounts.admin)
    await workspaceNav(page, 'Admin').click()
    await expect(page.getByRole('heading', { name: 'Admin dashboard' })).toBeVisible()

    await page.getByRole('button', { name: 'New employee' }).click()
    await page.getByPlaceholder('Username').fill(hireUsername)
    await page.getByPlaceholder('Display name').fill(hireName)
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByTestId('temporary-password')).toBeVisible()
    const temporaryPassword = (await page.getByTestId('temporary-password').textContent()).trim()
    await page.keyboard.press('Escape')

    await page.getByPlaceholder('Search employees').fill(hireUsername)
    const row = page.getByTestId('admin-employee-row').filter({ hasText: hireUsername })
    await expect(row).toBeVisible()
    await expect(row.getByTestId('admin-delete')).toBeVisible()

    await page.getByPlaceholder('Search employees').fill(accounts.admin.username)
    const adminRow = page.getByTestId('admin-employee-row').filter({ hasText: accounts.admin.username })
    await expect(adminRow).toBeVisible()
    await expect(adminRow.getByTestId('admin-delete')).toHaveCount(0)

    await page.getByPlaceholder('Search employees').fill(hireUsername)
    await expect(row).toBeVisible()
    await row.getByTestId('admin-delete').click()
    await expect(page.getByRole('heading', { name: 'Delete employee?' })).toBeVisible()
    await page.getByTestId('confirm-delete-employee').click()
    await expect(page.getByText('Employee deleted')).toBeVisible()
    await expect(row).toHaveCount(0)

    await page.getByRole('tab', { name: 'Audit' }).click()
    await expect(page.getByText('admin.user_deleted').first()).toBeVisible()

    const blocked = await browser.newContext()
    const blockedPage = await blocked.newPage()
    await blockedPage.goto('/')
    await blockedPage.getByTestId('login-try-another-way').click()
    await blockedPage.getByTestId('login-username').fill(hireUsername)
    await blockedPage.getByTestId('login-password').fill(temporaryPassword)
    await blockedPage.getByTestId('login-submit').click()
    await expect(blockedPage.getByText('Invalid credentials')).toBeVisible()
    await blockedPage.close()
    await blocked.close()
  })
})

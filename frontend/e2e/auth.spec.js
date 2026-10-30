import { test, expect } from '@playwright/test'
import { loadAccounts, login } from './helpers.js'

test.describe('Authentication', () => {
  test('rejects invalid credentials against the live API', async ({ page }) => {
    await page.goto('/login')
    await page.getByTestId('login-username').fill('e2e.unknown.user')
    await page.getByTestId('login-password').fill('definitely-wrong-password')
    await page.getByTestId('login-submit').click()
    await expect(page.getByText('Invalid credentials')).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })

  test('logs in, restores the session after reload, and logs out', async ({ page }) => {
    const accounts = loadAccounts()
    await login(page, accounts.alpha)
    await expect(page.getByTestId('workspace-rail')).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('chats-heading')).toBeVisible()
    await expect(page).not.toHaveURL(/\/login/)
    await page.getByTestId('sign-out').click()
    await expect(page.getByTestId('login-submit')).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })

  test('forces a first-login password change before chat', async ({ page }) => {
    const accounts = loadAccounts()
    await login(page, accounts.first, 'change-password')
    await page.getByTestId('current-password').fill(accounts.password)
    await page.getByTestId('new-password').fill(accounts.changedPassword)
    await page.getByTestId('confirm-password').fill(accounts.changedPassword)
    await page.getByTestId('update-password').click()
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await login(page, { ...accounts.first, password: accounts.changedPassword })
    await expect(page.getByTestId('chats-heading')).toBeVisible()
  })

  test('blocks a regular employee from the admin dashboard', async ({ page }) => {
    const accounts = loadAccounts()
    await login(page, accounts.alpha)
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Admin dashboard' })).toHaveCount(0)
    await expect(page.getByTestId('chats-heading')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0)
  })
})

import { test, expect } from '@playwright/test'
import { loadAccounts, login } from './helpers.js'

const HOME = 'http://127.0.0.1:5173/'

test.describe('Authentication', () => {
  test('defaults to phone OTP at / and still exposes username login', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(HOME)
    await expect(page.getByTestId('login-phone')).toBeVisible()
    await expect(page.getByTestId('login-heading')).toHaveText('Welcome to Company Chat')
    await expect(page.getByTestId('login-username')).toHaveCount(0)
    await page.getByTestId('login-try-another-way').click()
    await expect(page).toHaveURL(HOME)
    await expect(page.getByTestId('login-username')).toBeVisible()
    await expect(page.getByTestId('login-password-toggle')).toBeVisible()
    await page.getByTestId('login-back-to-otp').click()
    await expect(page.getByTestId('login-phone')).toBeVisible()
  })

  test('replaces /login with the root login experience', async ({ page }) => {
    await page.goto('/login')
    await expect(page).toHaveURL(HOME)
    await expect(page.getByTestId('login-phone')).toBeVisible()
    await expect(page).not.toHaveURL(/\/login/)
  })

  test('rejects invalid credentials against the live API', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('login-try-another-way').click()
    await page.getByTestId('login-username').fill('e2e.unknown.user')
    await page.getByTestId('login-password').fill('definitely-wrong-password')
    await page.getByTestId('login-submit').click()
    await expect(page.getByText('Invalid credentials')).toBeVisible()
    await expect(page).toHaveURL(HOME)
  })

  test('logs in, restores the session after reload, and logs out', async ({ page }) => {
    const accounts = loadAccounts()
    await login(page, accounts.alpha)
    await expect(page.getByTestId('workspace-rail')).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('chats-heading')).toBeVisible()
    await expect(page).toHaveURL(HOME)
    await page.getByTestId('sign-out').click()
    await expect(page.getByTestId('login-phone')).toBeVisible()
    await expect(page).toHaveURL(HOME)
  })

  test('forces a first-login password change before chat', async ({ page }) => {
    const accounts = loadAccounts()
    await login(page, accounts.first, 'change-password')
    await page.getByTestId('current-password').fill(accounts.password)
    await page.getByTestId('new-password').fill(accounts.changedPassword)
    await page.getByTestId('confirm-password').fill(accounts.changedPassword)
    await page.getByTestId('update-password').click()
    await expect(page.getByRole('heading', { name: 'Welcome to Company Chat' })).toBeVisible()
    await login(page, { ...accounts.first, password: accounts.changedPassword })
    await expect(page.getByTestId('chats-heading')).toBeVisible()
  })

  test('blocks a regular employee from the admin dashboard', async ({ page }) => {
    const accounts = loadAccounts()
    await login(page, accounts.alpha)
    await page.goto('/admin')
    await expect(page).toHaveURL(HOME)
    await expect(page.getByRole('heading', { name: 'Admin dashboard' })).toHaveCount(0)
    await expect(page.getByTestId('chats-heading')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Admin', exact: true })).toHaveCount(0)
  })
})

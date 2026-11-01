import { test, expect } from '@playwright/test'
import { loadAccounts, login, openNewChat, workspaceNav } from './helpers.js'

const HOME = 'http://127.0.0.1:5173/'

test.describe('Single-URL workspace', () => {
  test('switches chats and views without changing the browser URL', async ({ page }) => {
    const accounts = loadAccounts()
    await login(page, accounts.alpha)
    await expect(page).toHaveURL(HOME)

    await openNewChat(page, accounts.charlie.displayName)
    await expect(page.getByTestId('message-pane')).toBeVisible()
    await expect(page).toHaveURL(HOME)

    const conversationId = await page
      .getByTestId('conversation-item')
      .filter({ hasText: accounts.charlie.displayName })
      .getAttribute('data-conversation-id')
    expect(conversationId).toMatch(/^[0-9a-f-]{36}$/i)

    await workspaceNav(page, 'People').click()
    await expect(page.getByRole('heading', { name: 'Employee directory' })).toBeVisible()
    await expect(page).toHaveURL(HOME)

    await workspaceNav(page, 'Groups').click()
    await expect(page.getByRole('heading', { name: 'Your groups' })).toBeVisible()
    await expect(page).toHaveURL(HOME)

    await workspaceNav(page, 'Settings').click()
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
    await expect(page).toHaveURL(HOME)

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
    await expect(page).toHaveURL(HOME)

    await workspaceNav(page, 'Chats').click()
    await expect(page.getByTestId('message-pane')).toBeVisible()
    await expect(page).toHaveURL(HOME)

    await page.goBack()
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
    await expect(page).toHaveURL(HOME)

    await page.goForward()
    await expect(page.getByTestId('message-pane')).toBeVisible()
    await expect(page).toHaveURL(HOME)

    await page.goto(`/c/${conversationId}`)
    await expect(page).toHaveURL(HOME)
    await expect(page.getByTestId('message-pane')).toBeVisible()

    await page.goto('/directory')
    await expect(page).toHaveURL(HOME)
    await expect(page.getByRole('heading', { name: 'Employee directory' })).toBeVisible()

    await page.getByTestId('sign-out').click()
    await expect(page).toHaveURL(/\/login/)
    const stored = await page.evaluate(() => sessionStorage.getItem('company-chat.workspace'))
    expect(stored).toBeNull()
  })
})

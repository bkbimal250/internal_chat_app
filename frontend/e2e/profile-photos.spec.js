import { test, expect } from '@playwright/test'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadAccounts, login, openNewChat, workspaceNav } from './helpers.js'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64',
)

test('employees can upload, display, sync, and remove profile photos', async ({ browser, request }) => {
  test.setTimeout(180_000)
  const accounts = loadAccounts()
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.auth')
  mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, 'avatar.png')
  writeFileSync(filePath, png)

  const loginRes = await request.post('http://127.0.0.1:3001/api/v1/auth/login', {
    data: {
      username: accounts.alpha.username,
      password: accounts.alpha.password,
      clientType: 'native',
      platform: 'android',
      deviceName: 'e2e-photo-unauthorized',
    },
  })
  expect(loginRes.ok()).toBeTruthy()
  const session = await loginRes.json()
  const denied = await request.post(`http://127.0.0.1:3001/api/v1/admin/users/${accounts.bravo.id}/photo`, {
    headers: { authorization: `Bearer ${session.accessToken}` },
    data: { mimeType: 'image/png' },
  })
  expect(denied.status()).toBe(403)

  const alpha = await browser.newPage()
  const bravo = await browser.newPage()
  await login(alpha, accounts.alpha)
  await login(bravo, accounts.bravo)
  await openNewChat(alpha, accounts.bravo.displayName)

  await workspaceNav(alpha, 'Settings').click()
  await expect(alpha.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  await alpha.getByTestId('settings-open-profile').click()
  await expect(alpha.getByText('Profile photo')).toBeVisible()
  await alpha.getByTestId('profile-photo-input').setInputFiles(filePath)
  await expect(alpha.getByTestId('avatar-image')).toBeVisible({ timeout: 30_000 })

  await workspaceNav(alpha, 'Chats').click()
  await expect(alpha.getByTestId('chats-heading')).toBeVisible()
  await expect(alpha.locator('[data-testid="workspace-rail"] [data-testid="avatar-image"]')).toBeVisible()

  const conversation = bravo.getByTestId('conversation-item').filter({ hasText: accounts.alpha.displayName })
  await expect(conversation).toBeVisible({ timeout: 20_000 })
  await expect(conversation.getByTestId('avatar-image')).toBeVisible({ timeout: 30_000 })

  await workspaceNav(bravo, 'People').click()
  await expect(bravo.getByRole('heading', { name: 'Employee directory' })).toBeVisible()
  await bravo.getByTestId('directory-search').fill(accounts.alpha.displayName)
  const person = bravo.getByTestId('directory-person').filter({ hasText: accounts.alpha.displayName })
  await expect(person).toBeVisible({ timeout: 15_000 })
  await expect(person.getByTestId('avatar-image')).toBeVisible({ timeout: 20_000 })

  await workspaceNav(alpha, 'Settings').click()
  await alpha.getByTestId('settings-open-profile').click()
  await alpha.getByTestId('remove-profile-photo').click()
  await expect(alpha.getByTestId('settings-shell').getByTestId('avatar-image')).toHaveCount(0, {
    timeout: 20_000,
  })
  await expect(alpha.getByTestId('settings-shell').getByTestId('user-avatar')).toContainText('E')

  await alpha.close()
  await bravo.close()
})

import { expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const accountsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '.auth/accounts.json')

export function loadAccounts() {
  return JSON.parse(readFileSync(accountsPath, 'utf8'))
}

export async function login(page, user, landing = 'chats') {
  await page.goto('/login')
  const chats = page.getByTestId('chats-heading')
  const changeHeading = page.getByRole('heading', { name: 'Change password' })
  const username = page.getByTestId('login-username')

  await expect(username.or(chats).or(changeHeading)).toBeVisible({ timeout: 20_000 })
  if (landing === 'chats' && (await chats.isVisible().catch(() => false))) return
  if (landing === 'change-password' && (await changeHeading.isVisible().catch(() => false))) return

  await username.fill(user.username)
  await page.getByTestId('login-password').fill(user.password)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByTestId('login-submit').click()
    const arrived = await page
      .waitForFunction(
        (wantChange) => {
          const pathName = window.location.pathname
          if (wantChange) return pathName.includes('change-password')
          return pathName === '/' || pathName.startsWith('/c/')
        },
        landing === 'change-password',
        { timeout: 8_000 },
      )
      .then(() => true)
      .catch(() => false)

    if (arrived) {
      if (landing === 'change-password') {
        await expect(changeHeading).toBeVisible({ timeout: 10_000 })
      } else {
        await expect(chats).toBeVisible({ timeout: 10_000 })
      }
      return
    }

    if (attempt < 2) {
      await page.waitForTimeout(65_000)
      continue
    }
  }

  throw new Error(`Login did not reach ${landing} for ${user.username}`)
}

export async function openNewChat(page, displayName) {
  await page.getByRole('button', { name: 'New chat' }).click()
  await expect(page.getByRole('heading', { name: 'New chat' })).toBeVisible()
  await page.getByPlaceholder('Search employees').fill(displayName)
  const person = page.getByTestId('directory-person').filter({ hasText: displayName })
  await expect(person).toBeVisible({ timeout: 15_000 })
  await person.click()
  await expect(page.getByTestId('message-pane')).toBeVisible({ timeout: 20_000 })
}

export async function sendMessage(page, text) {
  await page.getByTestId('message-composer').fill(text)
  await page.getByTestId('send-message').click()
  const row = page.locator('[data-testid="chat-message"]').filter({ hasText: text })
  await expect(row.getByTestId('message-body')).toBeVisible({ timeout: 15_000 })
  await expect(row.getByTestId(/receipt-(sent|delivered|read)/)).toBeVisible({ timeout: 15_000 })
}

export async function openConversation(page, title) {
  const item = page.getByTestId('conversation-item').filter({ hasText: title })
  await expect(item).toBeVisible({ timeout: 20_000 })
  await item.click()
  await expect(page.getByTestId('message-pane')).toBeVisible({ timeout: 20_000 })
}

export async function openMessageMenu(page, text) {
  const row = page.locator('[data-testid="chat-message"]').filter({ hasText: text })
  await row.getByRole('button', { name: 'Message actions' }).click()
}

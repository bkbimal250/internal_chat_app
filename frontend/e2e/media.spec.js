import { test, expect } from '@playwright/test'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadAccounts, login, openConversation, openNewChat } from './helpers.js'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64',
)

test('authorized employees can upload and download an image attachment', async ({ browser }) => {
  test.setTimeout(120_000)
  const accounts = loadAccounts()
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.auth')
  mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, 'pixel.png')
  writeFileSync(filePath, png)

  const alpha = await browser.newPage()
  const bravo = await browser.newPage()
  await login(alpha, accounts.alpha)
  await alpha.waitForTimeout(1500)
  await login(bravo, accounts.bravo)
  await openNewChat(alpha, accounts.bravo.displayName)
  await openConversation(bravo, accounts.alpha.displayName)

  await expect(alpha.getByTestId('attach-menu')).toBeVisible()
  await alpha.getByTestId('attachment-input').setInputFiles(filePath)
  await expect(alpha.getByTestId('attachment-image')).toBeVisible({ timeout: 30_000 })
  await expect(bravo.getByTestId('attachment-image')).toBeVisible({ timeout: 30_000 })
  await alpha.getByTestId('attachment-image').click()
  await expect(alpha.getByRole('dialog')).toBeVisible()
  await alpha.close()
  await bravo.close()
})

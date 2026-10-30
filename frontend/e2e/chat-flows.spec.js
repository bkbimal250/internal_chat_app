import { test, expect } from '@playwright/test'
import {
  loadAccounts,
  login,
  openConversation,
  openMessageMenu,
  openNewChat,
  sendMessage,
} from './helpers.js'

test.describe('Realtime messaging, receipts, groups, and sync', () => {
  let alpha
  let bravo
  let charlie
  let alphaDevice
  let accounts
  const stamp = Date.now()
  const liveText = `live-${stamp}`
  const replyText = `reply-${stamp}`
  const editedText = `edited-${stamp}`
  const deletedText = `delete-${stamp}`
  const forwardText = `forward-${stamp}`
  const reconnectText = `reconnect-${stamp}`
  const deviceText = `device-${stamp}`
  const groupName = `E2E Group ${stamp}`

  test.beforeAll(async ({ browser }) => {
    accounts = loadAccounts()
    alpha = await browser.newPage()
    bravo = await browser.newPage()
    charlie = await browser.newPage()
    await login(alpha, accounts.alpha)
    await alpha.waitForTimeout(1500)
    await login(bravo, accounts.bravo)
    await bravo.waitForTimeout(1500)
    await login(charlie, accounts.charlie)
  })

  test.afterAll(async () => {
    await alphaDevice?.close()
    await alpha?.close()
    await bravo?.close()
    await charlie?.close()
  })

  test('two employees exchange messages in real time', async () => {
    await openNewChat(alpha, accounts.bravo.displayName)
    await sendMessage(alpha, liveText)
    await openConversation(bravo, accounts.alpha.displayName)
    await expect(bravo.getByTestId('message-body').filter({ hasText: liveText })).toBeVisible({
      timeout: 20_000,
    })
  })

  test('shows delivery and read receipt ticks', async () => {
    await expect(alpha.getByTestId('receipt-read').first()).toBeVisible({ timeout: 20_000 })
  })

  test('shows typing indicators and online status', async () => {
    await expect(alpha.getByTestId('chat-subtitle')).toHaveText('Online', { timeout: 20_000 })
    await expect(bravo.getByTestId('chat-subtitle')).toHaveText('Online', { timeout: 20_000 })
    await bravo.getByTestId('message-composer').fill('typing now')
    await expect(alpha.getByTestId('chat-subtitle')).toContainText('typing', { timeout: 10_000 })
    await bravo.getByTestId('message-composer').fill('')
  })

  test('creates a group and enforces owner and admin permissions', async () => {
    await alpha.getByRole('button', { name: 'Create group' }).first().click()
    await alpha.getByTestId('group-name').fill(groupName)
    await alpha.getByRole('dialog').getByRole('button', { name: 'Create group' }).click()
    await expect(alpha.getByTestId('message-pane').getByText(groupName)).toBeVisible({
      timeout: 15_000,
    })
    await alpha.getByRole('button', { name: 'Group info' }).click()
    await expect(alpha.getByRole('heading', { name: groupName })).toBeVisible()
    await alpha.getByPlaceholder('Search employees').fill(accounts.bravo.displayName)
    await alpha.getByTestId('add-member').filter({ hasText: accounts.bravo.displayName }).click()
    await expect(
      alpha.getByTestId('group-member').filter({ hasText: accounts.bravo.displayName }),
    ).toBeVisible({ timeout: 15_000 })
    await alpha.getByPlaceholder('Search employees').fill(accounts.charlie.displayName)
    await alpha.getByTestId('add-member').filter({ hasText: accounts.charlie.displayName }).click()
    await expect(
      alpha.getByTestId('group-member').filter({ hasText: accounts.charlie.displayName }),
    ).toBeVisible({ timeout: 15_000 })

    await openConversation(bravo, groupName)
    await bravo.getByRole('button', { name: 'Group info' }).click()
    await expect(bravo.getByRole('heading', { name: groupName })).toBeVisible()
    await expect(bravo.getByRole('button', { name: 'Promote' })).toHaveCount(0)
    await expect(bravo.getByRole('button', { name: 'Make owner' })).toHaveCount(0)
    await bravo.keyboard.press('Escape')
  })

  test('lets the group owner promote, transfer ownership, and leave', async () => {
    await alpha.keyboard.press('Escape')
    await bravo.keyboard.press('Escape')
    await openConversation(alpha, groupName)
    await alpha.getByRole('button', { name: 'Group info' }).click()
    const bravoRow = alpha.getByTestId('group-member').filter({ hasText: accounts.bravo.displayName })
    await expect(bravoRow.getByTestId('member-promote')).toBeVisible()
    await Promise.all([
      alpha.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' && response.url().includes('/role') && response.ok(),
        { timeout: 15_000 },
      ),
      bravoRow.getByTestId('member-promote').click(),
    ])
    await expect(bravoRow).toHaveAttribute('data-member-role', 'admin', { timeout: 15_000 })
    await Promise.all([
      alpha.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' && response.url().includes('/role') && response.ok(),
        { timeout: 15_000 },
      ),
      bravoRow.getByTestId('member-demote').click(),
    ])
    await expect(bravoRow).toHaveAttribute('data-member-role', 'member', { timeout: 15_000 })
    await Promise.all([
      alpha.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().includes('/transfer-owner') &&
          response.ok(),
        { timeout: 15_000 },
      ),
      bravoRow.getByTestId('member-make-owner').click(),
    ])
    await expect(
      alpha
        .getByTestId('group-member')
        .filter({ hasText: accounts.bravo.displayName })
        .getByText('owner', { exact: true }),
    ).toBeVisible({ timeout: 15_000 })
    await expect(alpha.getByTestId('leave-group')).toBeVisible()
    await alpha.getByTestId('leave-group').click()
    await expect(alpha.getByTestId('chats-heading')).toBeVisible()
    await expect(alpha.getByTestId('conversation-item').filter({ hasText: groupName })).toHaveCount(0)
  })

  test('synchronizes a second device for the same employee', async ({ browser }) => {
    await alpha.keyboard.press('Escape')
    await bravo.keyboard.press('Escape')
    alphaDevice = await browser.newPage()
    await login(alphaDevice, accounts.alpha)
    await openConversation(alpha, accounts.bravo.displayName)
    await openConversation(bravo, accounts.alpha.displayName)
    await openConversation(alphaDevice, accounts.bravo.displayName)
    await sendMessage(bravo, deviceText)
    await expect(alpha.getByTestId('message-body').filter({ hasText: deviceText })).toBeVisible({
      timeout: 20_000,
    })
    await expect(alphaDevice.getByTestId('message-body').filter({ hasText: deviceText })).toBeVisible({
      timeout: 20_000,
    })
  })

  test('recovers messages after a browser disconnect without duplicates', async () => {
    await alpha.keyboard.press('Escape')
    await bravo.keyboard.press('Escape')
    await openConversation(alpha, accounts.bravo.displayName)
    await openConversation(bravo, accounts.alpha.displayName)
    await bravo.context().setOffline(true)
    await sendMessage(alpha, reconnectText)
    await bravo.context().setOffline(false)
    await expect(bravo.getByTestId('message-body').filter({ hasText: reconnectText })).toBeVisible({
      timeout: 30_000,
    })
    await expect(bravo.getByTestId('message-body').filter({ hasText: reconnectText })).toHaveCount(1)
  })

  test('replies, edits, deletes, and forwards a message', async () => {
    test.setTimeout(120_000)
    await alpha.keyboard.press('Escape')
    await bravo.keyboard.press('Escape')
    await openConversation(alpha, accounts.bravo.displayName)
    await openConversation(bravo, accounts.alpha.displayName)
    const actionText = `actions-${stamp}`
    await sendMessage(alpha, actionText)
    await openMessageMenu(alpha, actionText)
    await alpha.getByRole('menuitem', { name: 'Reply' }).click()
    await expect(alpha.getByText(/Replying to/)).toBeVisible()
    await sendMessage(alpha, replyText)
    await expect(bravo.getByText('Replying to a message')).toBeVisible({ timeout: 15_000 })
    await expect(bravo.getByTestId('message-body').filter({ hasText: replyText })).toBeVisible()

    await sendMessage(alpha, deletedText)
    await openMessageMenu(alpha, deletedText)
    await alpha.getByRole('menuitem', { name: 'Edit' }).click()
    await expect(alpha.getByText('Editing message')).toBeVisible()
    const composer = alpha.getByTestId('message-composer')
    await expect(composer).toHaveValue(deletedText)
    await composer.fill('')
    await composer.pressSequentially(editedText)
    await expect(composer).toHaveValue(editedText)
    await Promise.all([
      alpha.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          response.url().includes('/api/v1/messages/') &&
          response.ok(),
        { timeout: 15_000 },
      ),
      alpha.getByTestId('send-message').click(),
    ])
    await expect(alpha.getByTestId('message-body').filter({ hasText: editedText })).toBeVisible({
      timeout: 15_000,
    })
    await expect(alpha.getByText('Editing message')).toHaveCount(0)
    await expect(alpha.getByTestId('message-body').filter({ hasText: editedText })).toBeVisible()
    await expect(bravo.getByTestId('message-body').filter({ hasText: editedText })).toBeVisible({
      timeout: 15_000,
    })
    await expect(bravo.getByText('edited').first()).toBeVisible()

    await openMessageMenu(alpha, editedText)
    await alpha.getByRole('menuitem', { name: 'Delete' }).click()
    await expect(alpha.getByText('This message was deleted')).toBeVisible()
    await expect(bravo.getByText('This message was deleted')).toBeVisible({ timeout: 15_000 })

    const forwardGroup = `${groupName} forward`
    await alpha.getByRole('button', { name: 'Create group' }).first().click()
    await alpha.getByTestId('group-name').fill(forwardGroup)
    await alpha.getByRole('dialog').getByRole('button', { name: 'Create group' }).click()
    await expect(alpha.getByTestId('message-pane').getByText(forwardGroup)).toBeVisible({
      timeout: 15_000,
    })
    await openConversation(alpha, accounts.bravo.displayName)
    await sendMessage(alpha, forwardText)
    await openMessageMenu(alpha, forwardText)
    await alpha.getByRole('menuitem', { name: 'Forward' }).click()
    await alpha.getByRole('button', { name: forwardGroup }).click()
    await expect(alpha.getByText('Message forwarded')).toBeVisible()
    await openConversation(alpha, forwardGroup)
    await expect(alpha.getByText('Forwarded')).toBeVisible()
    await expect(alpha.getByTestId('message-body').filter({ hasText: forwardText })).toBeVisible()
  })
})

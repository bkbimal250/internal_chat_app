import { test, expect } from '@playwright/test'
import { loadAccounts, login, workspaceNav } from './helpers.js'

test.describe('Directory and groups browse', () => {
  test('directory searches without page buttons and loads more on scroll', async ({ page }) => {
    const accounts = loadAccounts()
    await login(page, accounts.alpha)
    await workspaceNav(page, 'People').click()
    await expect(page.getByRole('heading', { name: 'Employee directory' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Next' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Previous' })).toHaveCount(0)

    const people = page.getByTestId('directory-person')
    await expect(people.first()).toBeVisible()
    const summary = page.getByTestId('directory-count')
    const initial = await summary.textContent()
    if (initial?.includes('scroll for more')) {
      await page.locator('[data-virtuoso-scroller]').evaluate((el) => {
        el.scrollTop = el.scrollHeight
      })
      await expect.poll(async () => summary.textContent(), { timeout: 10_000 }).not.toBe(initial)
    }

    await page.getByTestId('directory-search').fill(accounts.charlie.displayName)
    const match = people.filter({ hasText: accounts.charlie.displayName })
    await expect(match).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Clear search' }).click()
    await expect(people.first()).toBeVisible()
  })

  test('groups page searches and opens create dialog', async ({ page }) => {
    const accounts = loadAccounts()
    await login(page, accounts.alpha)
    await workspaceNav(page, 'Groups').click()
    await expect(page.getByRole('heading', { name: 'Your groups' })).toBeVisible()
    await expect(page.getByTestId('groups-search')).toBeVisible()
    await page.getByTestId('groups-create').click()
    await expect(page.getByRole('heading', { name: 'Create group' })).toBeVisible()
    await page.getByTestId('group-name').fill(`Browse group ${Date.now()}`)
    await page.getByRole('dialog').getByRole('button', { name: 'Create group' }).click()
    await expect(page.getByTestId('message-pane')).toBeVisible({ timeout: 20_000 })
  })
})

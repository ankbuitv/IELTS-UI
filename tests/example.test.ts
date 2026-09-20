import { test, expect } from '@playwright/test';

test('IELTS platform UI', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).not.toBeEmpty();
  await expect(page).toHaveTitle(/IELTS/);
  await page.screenshot({ path: 'screenshots/landing.png', fullPage: true });
  // Danh sách đăng nhập demo
  await page.goto('/login');
  await expect(page.getByPlaceholder('Email')).toBeVisible();
  await page.screenshot({ path: 'screenshots/login.png', fullPage: true });
});

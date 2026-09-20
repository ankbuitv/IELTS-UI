import { test, expect } from '@playwright/test';

test('landing page', async ({ page }) => {
  await page.goto('/');
  await page.screenshot({ path: 'screenshots/landing.png', fullPage: true });
});

test('login page', async ({ page }) => {
  await page.goto('/login');
  await page.screenshot({ path: 'screenshots/login.png', fullPage: true });
});

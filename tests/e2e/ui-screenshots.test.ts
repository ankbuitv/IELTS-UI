import { test, expect } from '@playwright/test';

test('landing page', async ({ page }) => {
  await page.goto('/');
  await page.screenshot({ path: 'screenshots/landing.png', fullPage: true });
});

test('login form state', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email *').fill('admin@demo.test');
  await page.getByLabel('Password *').fill('Demo-Passw0rd!23');
  await page.screenshot({ path: 'screenshots/login-filled.png', fullPage: true });
});

test('admin login + dashboard', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email *').fill('admin@demo.test');
  await page.getByLabel('Password *').fill('Demo-Passw0rd!23');
  await page.getByRole('button', { name: /^sign in$/i }).last().click();
  await page.waitForURL(/\/admin/, { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/admin-dashboard.png', fullPage: true });
});
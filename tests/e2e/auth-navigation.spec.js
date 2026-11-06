const { test, expect } = require('@playwright/test');

function randomEmail() {
    return `e2e_${Date.now()}_${Math.floor(Math.random() * 100000)}@example.com`;
}

test('register, login, and navigate protected pages', async ({ page }) => {
    const email = randomEmail();
    const password = 'password123';

    await page.goto('/register.html');
    await page.getByPlaceholder('Email Address').fill(email);
    await page.getByPlaceholder('Choose Password').fill(password);
    await page.getByRole('button', { name: 'Register Account' }).click();

    await expect(page).toHaveURL(/\/index\.html$|\/$/);

    await page.getByLabel('Email Address').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Login' }).click();

    await expect(page).toHaveURL(/\/dashboard\.html$/);
    await expect(page.getByRole('heading', { name: 'Welcome to Your Secure Dashboard' })).toBeVisible();

    await page.getByRole('link', { name: 'Profile' }).click();
    await expect(page).toHaveURL(/\/profile\.html$/);
    await expect(page.getByRole('heading', { name: 'Your Profile' })).toBeVisible();

    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings\.html$/);
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    await page.getByRole('link', { name: 'Help' }).click();
    await expect(page).toHaveURL(/\/help\.html$/);
    await expect(page.getByRole('heading', { name: 'Help Center' })).toBeVisible();

    await page.getByRole('button', { name: 'Log Out' }).click();
    await expect(page).toHaveURL(/\/index\.html$|\/$/);
});

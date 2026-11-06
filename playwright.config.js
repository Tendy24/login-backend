const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests/e2e',
    timeout: 30_000,
    use: {
        baseURL: 'http://127.0.0.1:3000',
        headless: true,
        trace: 'on-first-retry'
    },
    webServer: {
        command: 'node server.js',
        port: 3000,
        reuseExistingServer: true
    }
});

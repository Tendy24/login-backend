function showAuthMessage(messageBox, type, text) {
    if (!messageBox) {
        return;
    }

    messageBox.style.display = 'block';

    if (type === 'success' || type === 'error') {
        messageBox.className = `message ${type}`;
    }

    if (type === 'success') {
        messageBox.style.color = '';
    } else if (type === 'error') {
        messageBox.style.color = '';
    }

    messageBox.innerText = text;
}

function getPreferredHomePage() {
    const preferred = localStorage.getItem('preferredHomePage');
    const allowed = new Set(['/dashboard.html', '/profile.html', '/settings.html', '/help.html']);
    if (preferred && allowed.has(preferred)) {
        return preferred;
    }
    return '/dashboard.html';
}

function setSessionTokens(result) {
    if (result.token) {
        localStorage.setItem('authToken', result.token);
    }
    if (result.refreshToken) {
        localStorage.setItem('refreshToken', result.refreshToken);
    }
}

function extractErrorMessage(result) {
    if (!result || typeof result !== 'object') {
        return 'An unknown error occurred.';
    }

    if (result.message) {
        return result.message;
    }

    if (result.data && result.data.caa_login_web && result.data.caa_login_web.error_message) {
        return result.data.caa_login_web.error_message.text;
    }

    if (result.login_web && result.login_web.error_message) {
        return result.login_web.error_message.text;
    }

    return 'An unknown error occurred.';
}

function setupLoginForm() {
    const form = document.getElementById('loginForm');
    if (!form) {
        return;
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = document.getElementById('email')?.value || '';
        const password = document.getElementById('password')?.value || '';
        const messageBox = document.getElementById('messageBox');
        const submitBtn = document.getElementById('submitBtn');

        if (submitBtn) {
            submitBtn.innerText = 'Authenticating...';
            submitBtn.disabled = true;
        }
        if (messageBox) {
            messageBox.style.display = 'none';
        }

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });

            const result = await response.json();

            if (result.success) {
                showAuthMessage(messageBox, 'success', result.message || 'Login successful. Redirecting...');
                setSessionTokens(result);
                setTimeout(() => {
                    window.location.href = getPreferredHomePage();
                }, 1000);
            } else {
                showAuthMessage(messageBox, 'error', extractErrorMessage(result));
            }
        } catch (error) {
            showAuthMessage(messageBox, 'error', 'Cannot connect to backend server.');
        } finally {
            if (submitBtn) {
                submitBtn.innerText = 'Login';
                submitBtn.disabled = false;
            }
        }
    });
}

function setupRegisterForm() {
    const form = document.getElementById('registerForm');
    if (!form) {
        return;
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = document.getElementById('email')?.value || '';
        const password = document.getElementById('password')?.value || '';
        const messageBox = document.getElementById('messageBox');

        if (messageBox) {
            messageBox.textContent = 'Creating profile...';
            messageBox.style.color = '#666';
        }

        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const result = await response.json();

            if (result.success) {
                if (messageBox) {
                    messageBox.textContent = result.message || 'Account created. Redirecting to login...';
                    messageBox.style.color = 'green';
                }
                setTimeout(() => {
                    window.location.href = '/index.html';
                }, 1200);
            } else {
                if (messageBox) {
                    messageBox.textContent = extractErrorMessage(result);
                    messageBox.style.color = 'red';
                }
            }
        } catch (error) {
            if (messageBox) {
                messageBox.textContent = 'Network error. Try again.';
                messageBox.style.color = 'red';
            }
        }
    });
}

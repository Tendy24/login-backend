const DEV_MODE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

function showDebugToast(message) {
    if (!DEV_MODE) {
        return;
    }

    const toast = document.getElementById('debugToast');
    if (!toast) {
        return;
    }

    toast.innerText = message;
    toast.style.display = 'block';
    setTimeout(() => {
        toast.style.display = 'none';
    }, 1800);
}

function getAccessToken() {
    return localStorage.getItem('authToken');
}

function clearSession() {
    localStorage.removeItem('authToken');
    localStorage.removeItem('refreshToken');
}

function redirectToLogin() {
    window.location.href = '/';
}

async function refreshAccessToken() {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) {
        return null;
    }

    try {
        const refreshResponse = await fetch('/api/refresh-token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ refreshToken })
        });

        const refreshResult = await refreshResponse.json();

        if (!refreshResponse.ok || !refreshResult.success || !refreshResult.token || !refreshResult.refreshToken) {
            return null;
        }

        localStorage.setItem('authToken', refreshResult.token);
        localStorage.setItem('refreshToken', refreshResult.refreshToken);
        showDebugToast('Session refreshed (dev)');
        return refreshResult.token;
    } catch (error) {
        return null;
    }
}

async function withAutoRefresh(fetcher, token) {
    let accessToken = token;
    let attempt = await fetcher(accessToken);

    if (attempt.response.status === 403) {
        const newAccessToken = await refreshAccessToken();
        if (newAccessToken) {
            accessToken = newAccessToken;
            attempt = await fetcher(accessToken);
        }
    }

    return attempt;
}

async function fetchDashboardData(token) {
    const response = await fetch('/api/dashboard-data', {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`
        }
    });

    const result = await response.json();
    return { response, result };
}

async function fetchProfileData(token) {
    const response = await fetch('/api/me', {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`
        }
    });

    const result = await response.json();
    return { response, result };
}

function setActiveNav(pageKey) {
    document.querySelectorAll('[data-nav]').forEach((el) => {
        if (el.getAttribute('data-nav') === pageKey) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });
}

function wireLogout() {
    document.querySelectorAll('[data-action="logout"]').forEach((btn) => {
        btn.addEventListener('click', logout);
    });
}

async function logout() {
    const token = getAccessToken();

    try {
        if (token) {
            await fetch('/api/logout', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`
                }
            });
        }
    } catch (error) {
        // Ignore network/logout errors and proceed with cleanup.
    } finally {
        clearSession();
        redirectToLogin();
    }
}

async function bootstrapProtectedPage(options = {}) {
    const { pageKey = '', onReady } = options;
    const token = getAccessToken();

    if (!token) {
        redirectToLogin();
        return;
    }

    setActiveNav(pageKey);
    wireLogout();

    try {
        const dashboardAttempt = await withAutoRefresh(fetchDashboardData, token);
        const profileAttempt = await withAutoRefresh(fetchProfileData, getAccessToken());

        if (!dashboardAttempt.response.ok || !dashboardAttempt.result.success) {
            clearSession();
            redirectToLogin();
            return;
        }

        if (!profileAttempt.response.ok || !profileAttempt.result.success || !profileAttempt.result.user) {
            clearSession();
            redirectToLogin();
            return;
        }

        const dashboardMessage = document.getElementById('dashboardMessage');
        const profileEmail = document.getElementById('profileEmail');
        const profileId = document.getElementById('profileId');
        const navUserEmail = document.getElementById('navUserEmail');

        if (dashboardMessage) {
            dashboardMessage.innerText = dashboardAttempt.result.message;
        }
        if (profileEmail) {
            profileEmail.innerText = `Email: ${profileAttempt.result.user.email}`;
        }
        if (profileId) {
            profileId.innerText = `User ID: ${profileAttempt.result.user.id}`;
        }
        if (navUserEmail) {
            navUserEmail.innerText = profileAttempt.result.user.email;
        }

        if (typeof onReady === 'function') {
            onReady({
                dashboard: dashboardAttempt.result,
                user: profileAttempt.result.user
            });
        }
    } catch (error) {
        const dashboardMessage = document.getElementById('dashboardMessage');
        if (dashboardMessage) {
            dashboardMessage.innerText = 'Unable to verify session with the server.';
        }
    }
}

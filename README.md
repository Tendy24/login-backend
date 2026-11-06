# login-backend

[![CI](https://github.com/Tendy24/login-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/Tendy24/login-backend/actions/workflows/ci.yml)

> CI is configured via GitHub Actions in `.github/workflows/ci.yml`.

Simple Node.js + Express authentication backend with MongoDB, JWT access tokens, refresh token rotation, rate-limited login, and a static frontend.

## Features

- User registration with bcrypt password hashing
- Login with JWT access token issuance
- Refresh token rotation (`/api/refresh-token`)
- Protected routes with middleware (`/api/dashboard-data`, `/api/me`)
- Login rate limiting by client IP
- Optional dev seeding of a test user
- Static frontend pages in `public/`

## Tech Stack

- Node.js (CommonJS)
- Express
- Mongoose (MongoDB)
- bcrypt
- jsonwebtoken
- dotenv

## Project Structure

- `server.js` — API + auth logic + static serving
- `public/index.html` — login UI
- `public/dashboard.html` — protected dashboard UI
- `.env` — runtime config

## Prerequisites

- Node.js 18+ recommended
- MongoDB running (local or Docker)

## Environment Variables

Create/update `.env` with:

- `MONGODB_URI` — Mongo connection string
- `JWT_SECRET` — secret used to sign/verify access tokens
- `NODE_ENV` — `development` or `production`
- `ENABLE_SEED_USER` — `true` to seed test user in non-production
- `ACCESS_TOKEN_EXPIRES_IN` — access token lifetime (example: `1h`)
- `REFRESH_TOKEN_TTL_DAYS` — refresh token lifetime in days
- `LOGIN_RATE_LIMIT_WINDOW_MS` — login rate-limit window in milliseconds
- `LOGIN_RATE_LIMIT_MAX_ATTEMPTS` — max login attempts per IP in that window

Current sample values:

- `MONGODB_URI=mongodb://admin:password123@127.0.0.1:27017/auth_db?authSource=admin`
- `JWT_SECRET=super_secret_kali_key_123`
- `NODE_ENV=development`
- `ENABLE_SEED_USER=true`
- `ACCESS_TOKEN_EXPIRES_IN=1h`
- `REFRESH_TOKEN_TTL_DAYS=7`
- `LOGIN_RATE_LIMIT_WINDOW_MS=60000`
- `LOGIN_RATE_LIMIT_MAX_ATTEMPTS=5`

## Install & Run

1. Install dependencies:
   - `npm install`
2. Start the server:
   - `node server.js`
3. Open:
   - `http://localhost:3000`

## Integration Tests

This project includes integration tests in `tests/auth.integration.test.js`.

The suite uses:

- `jest`
- `supertest`

It runs against a dedicated test database URI (default: `auth_db_test` on local MongoDB).
You can override the URI with:

- `TEST_MONGODB_URI`

Run tests:

- `npm test`

What is covered:

- register success + password hashing
- duplicate registration rejection
- login token issuance
- protected route access (`/api/dashboard-data`, `/api/me`)
- refresh-token rotation
- logout invalidation of refresh token
- login rate-limiter behavior

## Dev Seed Behavior

When `NODE_ENV != production` and `ENABLE_SEED_USER=true`, the server seeds one user if the `users` collection is empty:

- Email: `test@example.com`
- Password: `password123`

Password is stored as a bcrypt hash.

## API Routes

### `POST /api/register`

Create a new account.

Body:

- `email` (valid email)
- `password` (min 8 chars)

Success:

- `201 { success: true, message }`

---

### `POST /api/login`

Authenticate user and issue tokens.

Body:

- `email`
- `password`

Success:

- `200 { success: true, message, token, refreshToken }`

Errors:

- `400` invalid input
- `401` invalid credentials
- `429` too many attempts (rate limited)

---

### `POST /api/refresh-token`

Rotate refresh token and issue a new access token.

Body:

- `refreshToken`

Success:

- `200 { success: true, token, refreshToken }`

Errors:

- `400` missing token
- `401` invalid token
- `403` expired token

---

### `POST /api/logout` (Protected)

Requires header:

- `Authorization: Bearer <access_token>`

Behavior:

- Invalidates server-side stored refresh token for the authenticated user.

Success:

- `200 { success: true, message }`

---

### `GET /api/dashboard-data` (Protected)

Requires header:

- `Authorization: Bearer <access_token>`

Success:

- `200 { success: true, message }`

---

### `GET /api/me` (Protected)

Requires header:

- `Authorization: Bearer <access_token>`

Success:

- `200 { success: true, user: { id, email } }`

## Frontend Auth Flow

1. User logs in via `public/index.html`.
2. Access token + refresh token are stored in `localStorage`.
3. `public/dashboard.html` calls protected routes with access token.
4. If access token is expired (`403`), dashboard uses refresh token once to rotate and retry.
5. Logout should call `/api/logout` (to invalidate server-side refresh token) and clear client tokens.

## Notes

- Refresh tokens are never stored raw in MongoDB (only SHA-256 hash).
- Login rate limiter is in-memory; for multi-instance production setups, move to a shared store (Redis).
- Move secrets to a secure secret manager in production.

## Release Checklist

Before merging to `main` for a release:

- Ensure CI checks are green on the PR.
- Run production dependency audit:
   - `npm audit --omit=dev --audit-level=low`
- Confirm at least one approving review is present.
- Confirm branch is up to date with `main`.
- Merge through PR (no direct pushes to `main`).

## Quick Test Commands

Run these from the project root while `node server.js` is running.

### 1) Register a new user

```bash
curl -s -X POST http://localhost:3000/api/register \
   -H 'Content-Type: application/json' \
   -d '{"email":"newuser@example.com","password":"password123"}'
```

### 2) Login and get tokens

```bash
curl -s -X POST http://localhost:3000/api/login \
   -H 'Content-Type: application/json' \
   -d '{"email":"newuser@example.com","password":"password123"}'
```

### 3) Save tokens to shell variables (requires `jq`)

```bash
LOGIN_JSON=$(curl -s -X POST http://localhost:3000/api/login -H 'Content-Type: application/json' -d '{"email":"newuser@example.com","password":"password123"}')
ACCESS_TOKEN=$(echo "$LOGIN_JSON" | jq -r '.token')
REFRESH_TOKEN=$(echo "$LOGIN_JSON" | jq -r '.refreshToken')
echo "Access token set? ${ACCESS_TOKEN:+yes}"
echo "Refresh token set? ${REFRESH_TOKEN:+yes}"
```

### 4) Call protected dashboard route

```bash
curl -s http://localhost:3000/api/dashboard-data \
   -H "Authorization: Bearer $ACCESS_TOKEN"
```

### 5) Call protected profile route

```bash
curl -s http://localhost:3000/api/me \
   -H "Authorization: Bearer $ACCESS_TOKEN"
```

### 6) Rotate tokens with refresh token

```bash
curl -s -X POST http://localhost:3000/api/refresh-token \
   -H 'Content-Type: application/json' \
   -d "{\"refreshToken\":\"$REFRESH_TOKEN\"}"
```

### 7) Rate-limit check (optional)

Send multiple bad login attempts quickly to trigger `429`:

```bash
for i in {1..7}; do
   curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/login \
      -H 'Content-Type: application/json' \
      -d '{"email":"newuser@example.com","password":"wrongpass"}'
done
```

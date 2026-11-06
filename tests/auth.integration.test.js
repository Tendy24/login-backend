const request = require('supertest');

let app;
let mongoose;
let User;

jest.setTimeout(60000);

describe('Auth integration tests', () => {
    beforeAll(async () => {
        process.env.NODE_ENV = 'test';
        process.env.ENABLE_SEED_USER = 'false';
        process.env.JWT_SECRET = 'integration_test_secret_key';
        process.env.ACCESS_TOKEN_EXPIRES_IN = '2m';
        process.env.REFRESH_TOKEN_TTL_DAYS = '7';
        process.env.LOGIN_RATE_LIMIT_WINDOW_MS = '60000';
        process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS = '3';

        process.env.MONGODB_URI = process.env.TEST_MONGODB_URI || 'mongodb://admin:password123@127.0.0.1:27017/auth_db_test?authSource=admin';

        ({ app, mongoose, User } = require('../server'));
        await mongoose.connection.asPromise();
    });

    beforeEach(async () => {
        await User.deleteMany({});
    });

    afterAll(async () => {
        if (mongoose?.connection?.readyState) {
            await mongoose.connection.dropDatabase();
            await mongoose.connection.close();
        }
    });

    test('register creates a user with hashed password', async () => {
        const res = await request(app)
            .post('/api/register')
            .send({ email: 'integration@example.com', password: 'password123' });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);

        const user = await User.findOne({ email: 'integration@example.com' });
        expect(user).toBeTruthy();
        expect(user.passwordHash).toBeTruthy();
        expect(user.passwordHash).not.toBe('password123');
    });

    test('register rejects duplicate email', async () => {
        await request(app)
            .post('/api/register')
            .send({ email: 'dup@example.com', password: 'password123' });

        const res = await request(app)
            .post('/api/register')
            .send({ email: 'dup@example.com', password: 'password123' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    test('login returns tokens and protected routes work', async () => {
        await request(app)
            .post('/api/register')
            .send({ email: 'auth@example.com', password: 'password123' });

        const loginRes = await request(app)
            .post('/api/login')
            .set('x-forwarded-for', '10.10.10.10')
            .send({ email: 'auth@example.com', password: 'password123' });

        expect(loginRes.status).toBe(200);
        expect(loginRes.body.success).toBe(true);
        expect(typeof loginRes.body.token).toBe('string');
        expect(typeof loginRes.body.refreshToken).toBe('string');

        const dashboardRes = await request(app)
            .get('/api/dashboard-data')
            .set('Authorization', `Bearer ${loginRes.body.token}`);

        expect(dashboardRes.status).toBe(200);
        expect(dashboardRes.body.success).toBe(true);

        const meRes = await request(app)
            .get('/api/me')
            .set('Authorization', `Bearer ${loginRes.body.token}`);

        expect(meRes.status).toBe(200);
        expect(meRes.body.success).toBe(true);
        expect(meRes.body.user.email).toBe('auth@example.com');
    });

    test('refresh token rotates tokens', async () => {
        await request(app)
            .post('/api/register')
            .send({ email: 'refresh@example.com', password: 'password123' });

        const loginRes = await request(app)
            .post('/api/login')
            .set('x-forwarded-for', '20.20.20.20')
            .send({ email: 'refresh@example.com', password: 'password123' });

        const refreshRes = await request(app)
            .post('/api/refresh-token')
            .send({ refreshToken: loginRes.body.refreshToken });

        expect(refreshRes.status).toBe(200);
        expect(refreshRes.body.success).toBe(true);
        expect(typeof refreshRes.body.token).toBe('string');
        expect(typeof refreshRes.body.refreshToken).toBe('string');
        expect(refreshRes.body.refreshToken).not.toBe(loginRes.body.refreshToken);
    });

    test('logout invalidates refresh token', async () => {
        await request(app)
            .post('/api/register')
            .send({ email: 'logout@example.com', password: 'password123' });

        const loginRes = await request(app)
            .post('/api/login')
            .set('x-forwarded-for', '30.30.30.30')
            .send({ email: 'logout@example.com', password: 'password123' });

        const logoutRes = await request(app)
            .post('/api/logout')
            .set('Authorization', `Bearer ${loginRes.body.token}`);

        expect(logoutRes.status).toBe(200);
        expect(logoutRes.body.success).toBe(true);

        const refreshRes = await request(app)
            .post('/api/refresh-token')
            .send({ refreshToken: loginRes.body.refreshToken });

        expect(refreshRes.status).toBe(401);
        expect(refreshRes.body.success).toBe(false);
    });

    test('login rate limiter blocks after max attempts', async () => {
        await request(app)
            .post('/api/register')
            .send({ email: 'ratelimit@example.com', password: 'password123' });

        const statuses = [];
        for (let i = 0; i < 4; i += 1) {
            const res = await request(app)
                .post('/api/login')
                .set('x-forwarded-for', '99.99.99.99')
                .send({ email: 'ratelimit@example.com', password: 'wrongpass' });
            statuses.push(res.status);
        }

        expect(statuses).toEqual([401, 401, 401, 429]);
    });
});

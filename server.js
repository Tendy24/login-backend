require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose'); // 1. Import Mongoose
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();

// 2. Connect securely to your running Docker MongoDB instance
const mongoURI = process.env.MONGODB_URI || 'mongodb://admin:password123@127.0.0.1:27017/auth_db?authSource=admin';
const JWT_SECRET = process.env.JWT_SECRET;
const NODE_ENV = process.env.NODE_ENV || 'development';
const ENABLE_SEED_USER = process.env.ENABLE_SEED_USER === 'true';
const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || '1h';
const REFRESH_TOKEN_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 7);
const LOGIN_RATE_LIMIT_WINDOW_MS = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || 60000);
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = Number(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS || 5);

if (!JWT_SECRET) {
  console.error('❌ Missing JWT_SECRET in environment. Please set it in .env before starting the server.');
  process.exit(1);
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_REGEX.test(email);
}

function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 8;
}

function verifyAuthToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
  }

  try {
    const verifiedData = jwt.verify(token, JWT_SECRET);
    req.auth = verifiedData;
    return next();
  } catch (error) {
    return res.status(403).json({ success: false, message: 'Invalid or expired login session.' });
  }
}

const loginAttemptStore = new Map();

function getClientIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
    return forwardedFor.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function loginRateLimiter(req, res, next) {
  const now = Date.now();
  const ip = getClientIp(req);
  const existingEntry = loginAttemptStore.get(ip);

  if (!existingEntry || now > existingEntry.expiresAt) {
    loginAttemptStore.set(ip, { count: 1, expiresAt: now + LOGIN_RATE_LIMIT_WINDOW_MS });
    return next();
  }

  if (existingEntry.count >= LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
    const retryAfterSeconds = Math.ceil((existingEntry.expiresAt - now) / 1000);
    return res.status(429)
      .set('Retry-After', String(Math.max(retryAfterSeconds, 1)))
      .json({ success: false, message: 'Too many login attempts. Please try again shortly.' });
  }

  existingEntry.count += 1;
  loginAttemptStore.set(ip, existingEntry);
  return next();
}

function createAccessToken(user) {
  return jwt.sign(
    { userId: user._id, email: user.email },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
  );
}

function createRefreshToken() {
  return crypto.randomBytes(64).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

mongoose.connect(mongoURI)
  .then(() => {
    console.log('🚀 Connected smoothly to MongoDB inside Docker!');
    if (NODE_ENV !== 'production' && ENABLE_SEED_USER) {
      seedTestUsers();
    } else {
      console.log('ℹ️ Test-user seeding is disabled for this environment.');
    }
  })
  .catch((err) => console.error('❌ MongoDB connection error:', err));

// 3. Define a formal User layout (Schema) to replace the static MOCK_DATABASE object
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  refreshTokenHash: { type: String, default: null },
  refreshTokenExpiresAt: { type: Date, default: null }
});
const User = mongoose.model('User', userSchema);

// Function to seed initial test accounts if the database is empty
async function seedTestUsers() {
  try {
    const userCount = await User.countDocuments();

    if (userCount === 0) {
      console.log('🌱 Database is empty. Seeding initial test user account...');

      // 1. Generate the hash
      const hashedPassword = await bcrypt.hash('password123', 10);

      // 2. Insert it into the database
      await User.create({
        email: 'test@example.com',
        passwordHash: hashedPassword // Must be hashedPassword, NOT "password123"
      });

      console.log('✅ Secure seed complete!');
    } else {
      console.log(`ℹ️ Database already contains ${userCount} users. Skipping seeding.`);
    }
  } catch (err) {
    console.error('❌ Error while seeding database:', err);
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// The Registration endpoint handles creating and encrypting new accounts
app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;

  try {
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters long.' });
    }

    // 1. Check if a user with this email address already exists
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email already exists.'
      });
    }

    // 2. Hash the new password cryptographically using bcrypt
    const hashedPassword = await bcrypt.hash(password, 10);

    // 3. Create and save the new user record into MongoDB
    await User.create({
      email: normalizedEmail,
      passwordHash: hashedPassword
    });

    return res.status(201).json({
      success: true,
      message: 'Account created successfully! Redirecting...'
    });
  } catch (error) {
    console.error('Registration engine database error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server registry error. Please try again.'
    });
  }
});

// The authentication endpoint handles database communication asynchronously
app.post('/api/login', loginRateLimiter, async (req, res) => {
  const { email, password } = req.body;

  try {
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters long.' });
    }

    // 1. Query MongoDB for the user document by their email
    const user = await User.findOne({ email: normalizedEmail });

    // Artificial 1-second delay matching your design requirement
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 2. Fail early if no user account exists with that email
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'The email or password you entered is incorrect.'
      });
    }

    // 3. Verify password hash matches
    const passwordMatches = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: 'The email or password you entered is incorrect.'
      });
    }

    // 4. Successful Authentication Payload Generation
    const token = createAccessToken(user);
    const refreshToken = createRefreshToken();

    user.refreshTokenHash = hashToken(refreshToken);
    user.refreshTokenExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    await user.save();

    // Successful login should clear rate-limit pressure for this IP.
    loginAttemptStore.delete(getClientIp(req));

    return res.status(200).json({
      success: true,
      message: 'Authentication successful! Redirecting...',
      token: token, // Backward-compatible key for existing frontend
      refreshToken: refreshToken
    });
  } catch (error) {
    console.error('Database or processing error:', error);
    return res.status(500).json({ success: false, message: 'Internal server authentication error' });
  }
});

// Endpoint to rotate refresh token and issue a new access token
app.post('/api/refresh-token', async (req, res) => {
  const { refreshToken } = req.body;

  if (typeof refreshToken !== 'string' || refreshToken.trim().length === 0) {
    return res.status(400).json({ success: false, message: 'Refresh token is required.' });
  }

  try {
    const incomingTokenHash = hashToken(refreshToken);
    const user = await User.findOne({ refreshTokenHash: incomingTokenHash });

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid refresh token.' });
    }

    if (!user.refreshTokenExpiresAt || user.refreshTokenExpiresAt < new Date()) {
      user.refreshTokenHash = null;
      user.refreshTokenExpiresAt = null;
      await user.save();
      return res.status(403).json({ success: false, message: 'Refresh token expired. Please log in again.' });
    }

    const newAccessToken = createAccessToken(user);
    const newRefreshToken = createRefreshToken();

    user.refreshTokenHash = hashToken(newRefreshToken);
    user.refreshTokenExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    await user.save();

    return res.status(200).json({
      success: true,
      token: newAccessToken,
      refreshToken: newRefreshToken
    });
  } catch (error) {
    console.error('Refresh token processing error:', error);
    return res.status(500).json({ success: false, message: 'Internal server token refresh error' });
  }
});

// Endpoint to logout and invalidate the stored refresh token for the current user
app.post('/api/logout', verifyAuthToken, async (req, res) => {
  try {
    const user = await User.findById(req.auth.userId);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    user.refreshTokenHash = null;
    user.refreshTokenExpiresAt = null;
    await user.save();

    return res.status(200).json({ success: true, message: 'Logged out successfully.' });
  } catch (error) {
    console.error('Logout processing error:', error);
    return res.status(500).json({ success: false, message: 'Internal server logout error' });
  }
});

// Protected endpoint that verifies tokens
app.get('/api/dashboard-data', verifyAuthToken, async (req, res) => {
  return res.status(200).json({
    success: true,
    message: `Hello ${req.auth.email}! Welcome to your secure dashboard area.`
  });
});

// Protected profile endpoint for the currently authenticated user
app.get('/api/me', verifyAuthToken, async (req, res) => {
  try {
    const user = await User.findById(req.auth.userId).select('_id email');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user._id,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Profile lookup error:', error);
    return res.status(500).json({ success: false, message: 'Internal server profile error' });
  }
});

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log(`Backend server running on http://localhost:${port}`);
  });
}

module.exports = {
  app,
  mongoose,
  User
};

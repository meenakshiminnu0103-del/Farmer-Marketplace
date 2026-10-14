const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { get, run } = require('../db/database');
const uuidv4 = () => crypto.randomUUID();

const JWT_SECRET = process.env.JWT_SECRET || 'farmdirect-super-secret-jwt-key-2026';

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      full_name: user.full_name
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Authentication token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    const user = get("SELECT id, full_name, email, phone, role, account_status FROM users WHERE id = ?", [decoded.id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.account_status === 'suspended') {
      return res.status(403).json({ error: 'Your account has been suspended. Please contact platform support.' });
    }

    req.user = user;
    next();
  });
}

// Optional authentication (for public catalog browsing where logged-in user info is still helpful)
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    req.user = null;
    return next();
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (!err && decoded) {
      req.user = get("SELECT id, full_name, email, phone, role, account_status FROM users WHERE id = ?", [decoded.id]);
    }
    next();
  });
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Forbidden: This operation requires one of the following roles: [${roles.join(', ')}]. You are '${req.user.role}'.`
      });
    }
    next();
  };
}

function recordAudit(userId, action, details, ip = '127.0.0.1') {
  try {
    run(
      "INSERT INTO audit_logs (id, user_id, action, details, ip_address) VALUES (?, ?, ?, ?, ?)",
      [uuidv4(), userId, action, typeof details === 'object' ? JSON.stringify(details) : details, ip]
    );
  } catch (e) {
    console.error("Audit log error:", e);
  }
}

module.exports = {
  generateToken,
  authenticateToken,
  optionalAuth,
  requireRole,
  recordAudit,
  JWT_SECRET
};

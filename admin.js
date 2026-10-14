const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();
const { get, query, run } = require('../db/database');
const { authenticateToken, requireRole, recordAudit } = require('../middleware/auth');

// All endpoints in this file require Admin role
router.use(authenticateToken, requireRole('admin'));

// List all users
router.get('/users', (req, res) => {
  try {
    const users = query(`
      SELECT 
        u.id, u.full_name, u.email, u.phone, u.role, u.account_status, u.created_at,
        fp.farm_name, fp.farm_location, fp.verification_status as farmer_verification,
        bp.buyer_type, bp.business_name
      FROM users u
      LEFT JOIN farmer_profiles fp ON u.id = fp.user_id
      LEFT JOIN buyer_profiles bp ON u.id = bp.user_id
      ORDER BY u.created_at DESC
    `);
    res.json(users);
  } catch (err) {
    console.error("Admin users list error:", err);
    res.status(500).json({ error: 'Failed to retrieve users' });
  }
});

// Update user account status (active, suspended, pending_approval)
router.patch('/users/:id/status', (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'suspended', 'pending_approval'].includes(status)) {
      return res.status(400).json({ error: 'Invalid account status' });
    }

    const targetUser = get("SELECT * FROM users WHERE id = ?", [req.params.id]);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (targetUser.role === 'admin') {
      return res.status(400).json({ error: 'Cannot modify status of an administrator account.' });
    }

    run("UPDATE users SET account_status = ? WHERE id = ?", [status, req.params.id]);

    recordAudit(req.user.id, 'USER_STATUS_CHANGED', { targetUserId: req.params.id, status });

    res.json({ message: `User status changed to '${status}' successfully.` });
  } catch (err) {
    console.error("Update user status error:", err);
    res.status(500).json({ error: 'Failed to update user status' });
  }
});

// Manage categories
router.post('/categories', (req, res) => {
  try {
    const { category_name, description, icon } = req.body;
    if (!category_name || !category_name.trim()) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const catId = 'cat-' + category_name.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 15);
    run(
      "INSERT INTO categories (id, category_name, description, icon) VALUES (?, ?, ?, ?)",
      [catId, category_name.trim(), description || '', icon || 'Tag']
    );

    recordAudit(req.user.id, 'CATEGORY_CREATED', { catId, category_name });

    res.status(201).json({ message: 'Category added successfully' });
  } catch (err) {
    console.error("Create category error:", err);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// List disputes / complaints
router.get('/disputes', (req, res) => {
  try {
    const disputes = query(`
      SELECT 
        d.*,
        u.full_name as reporter_name,
        u.email as reporter_email
      FROM disputes d
      JOIN users u ON d.reported_by = u.id
      ORDER BY d.created_at DESC
    `);
    res.json(disputes);
  } catch (err) {
    console.error("Disputes error:", err);
    res.status(500).json({ error: 'Failed to retrieve disputes' });
  }
});

// Resolve dispute
router.patch('/disputes/:id', (req, res) => {
  try {
    const { status, resolution_notes } = req.body;
    if (!['open', 'resolved', 'dismissed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    run(
      "UPDATE disputes SET status = ?, resolution_notes = ? WHERE id = ?",
      [status, resolution_notes || '', req.params.id]
    );

    recordAudit(req.user.id, 'DISPUTE_UPDATED', { disputeId: req.params.id, status });

    res.json({ message: 'Dispute status updated' });
  } catch (err) {
    console.error("Update dispute error:", err);
    res.status(500).json({ error: 'Failed to update dispute' });
  }
});

// View audit logs
router.get('/audit-logs', (req, res) => {
  try {
    const logs = query(`
      SELECT a.*, u.full_name, u.role
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      ORDER BY a.created_at DESC
      LIMIT 50
    `);
    res.json(logs);
  } catch (err) {
    console.error("Audit logs error:", err);
    res.status(500).json({ error: 'Failed to retrieve audit logs' });
  }
});

module.exports = router;

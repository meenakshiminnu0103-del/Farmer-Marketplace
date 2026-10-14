const express = require('express');
const router = express.Router();
const { get, query, run } = require('../db/database');
const { authenticateToken } = require('../middleware/auth');

// Get all notifications for current user
router.get('/', authenticateToken, (req, res) => {
  try {
    const notifications = query(`
      SELECT * FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 30
    `, [req.user.id]);

    const unreadCount = get(`
      SELECT COUNT(*) as count FROM notifications
      WHERE user_id = ? AND read_status = 0
    `, [req.user.id]);

    res.json({
      notifications,
      unread_count: unreadCount ? unreadCount.count : 0
    });
  } catch (err) {
    console.error("Notifications error:", err);
    res.status(500).json({ error: 'Failed to retrieve notifications' });
  }
});

// Mark single notification as read
router.patch('/:id/read', authenticateToken, (req, res) => {
  try {
    run("UPDATE notifications SET read_status = 1 WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
    res.json({ message: 'Notification marked as read' });
  } catch (err) {
    console.error("Mark read error:", err);
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

// Mark all as read
router.patch('/read-all', authenticateToken, (req, res) => {
  try {
    run("UPDATE notifications SET read_status = 1 WHERE user_id = ?", [req.user.id]);
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    console.error("Mark all read error:", err);
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
});

module.exports = router;

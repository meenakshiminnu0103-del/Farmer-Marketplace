const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();
const { get, query, run } = require('../db/database');
const { authenticateToken } = require('../middleware/auth');

// Get active conversation threads for current user
router.get('/conversations', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;
    const conversations = query(`
      SELECT 
        CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END as other_user_id,
        u.full_name as other_user_name,
        u.role as other_user_role,
        fp.farm_name,
        m.message_text as last_message,
        m.created_at as last_message_at,
        SUM(CASE WHEN m.receiver_id = ? AND m.read_status = 0 THEN 1 ELSE 0 END) as unread_count
      FROM messages m
      JOIN users u ON (CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END) = u.id
      LEFT JOIN farmer_profiles fp ON u.id = fp.user_id
      WHERE m.sender_id = ? OR m.receiver_id = ?
      GROUP BY other_user_id
      ORDER BY m.created_at DESC
    `, [userId, userId, userId, userId, userId]);

    res.json(conversations);
  } catch (err) {
    console.error("Conversations error:", err);
    res.status(500).json({ error: 'Failed to retrieve conversations' });
  }
});

// Get messages between current user and another user
router.get('/thread/:otherUserId', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;
    const { otherUserId } = req.params;

    const messages = query(`
      SELECT 
        m.*,
        u_s.full_name as sender_name,
        u_s.role as sender_role,
        p.product_name
      FROM messages m
      JOIN users u_s ON m.sender_id = u_s.id
      LEFT JOIN products p ON m.product_id = p.id
      WHERE (m.sender_id = ? AND m.receiver_id = ?)
         OR (m.sender_id = ? AND m.receiver_id = ?)
      ORDER BY m.created_at ASC
    `, [userId, otherUserId, otherUserId, userId]);

    // Mark received messages in this thread as read
    run(
      "UPDATE messages SET read_status = 1 WHERE sender_id = ? AND receiver_id = ? AND read_status = 0",
      [otherUserId, userId]
    );

    const otherUser = get("SELECT id, full_name, role, phone FROM users WHERE id = ?", [otherUserId]);
    let otherProfile = null;
    if (otherUser && otherUser.role === 'farmer') {
      otherProfile = get("SELECT farm_name, farm_location FROM farmer_profiles WHERE user_id = ?", [otherUserId]);
    }

    res.json({
      messages,
      otherUser: { ...otherUser, profile: otherProfile }
    });
  } catch (err) {
    console.error("Thread error:", err);
    res.status(500).json({ error: 'Failed to retrieve message thread' });
  }
});

// Send a message (Inquiry, Negotiation, Bulk request, or general chat)
router.post('/', authenticateToken, (req, res) => {
  try {
    const senderId = req.user.id;
    const { receiver_id, product_id, order_id, message_type, proposed_price, message_text } = req.body;

    if (!receiver_id || !message_text || !message_text.trim()) {
      return res.status(400).json({ error: 'Receiver ID and message text are required.' });
    }

    const receiver = get("SELECT id, full_name FROM users WHERE id = ?", [receiver_id]);
    if (!receiver) {
      return res.status(404).json({ error: 'Recipient user not found' });
    }

    const messageId = 'msg-' + uuidv4().slice(0, 8);
    run(`
      INSERT INTO messages (
        id, sender_id, receiver_id, product_id, order_id, message_type, proposed_price, message_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      messageId,
      senderId,
      receiver_id,
      product_id || null,
      order_id || null,
      message_type || 'inquiry',
      proposed_price ? Number(proposed_price) : null,
      message_text.trim()
    ]);

    // Send in-app notification to receiver
    const senderTitle = req.user.role === 'farmer' ? 'Farmer' : 'Buyer';
    run(`
      INSERT INTO notifications (id, user_id, notification_type, message, link)
      VALUES (?, ?, 'message', ?, ?)
    `, [
      uuidv4(),
      receiver_id,
      `New direct message from ${senderTitle} ${req.user.full_name}: "${message_text.slice(0, 50)}..."`,
      `/messages?user=${senderId}`
    ]);

    const created = get("SELECT * FROM messages WHERE id = ?", [messageId]);
    res.status(201).json({ message: 'Message sent successfully', data: created });
  } catch (err) {
    console.error("Send message error:", err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

module.exports = router;

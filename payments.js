const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();
const { get, query, run } = require('../db/database');
const { authenticateToken, recordAudit } = require('../middleware/auth');

// Process Mock Payment (Sandbox Gateway)
router.post('/process-mock', authenticateToken, (req, res) => {
  try {
    const { order_id, payment_method, card_holder, simulated_pin } = req.body;

    if (!order_id || !payment_method) {
      return res.status(400).json({ error: 'Order ID and payment method are required.' });
    }

    const order = get("SELECT * FROM orders WHERE id = ?", [order_id]);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Idempotency: Prevent duplicate payment if already completed
    if (order.payment_status === 'completed') {
      const existingPay = get("SELECT * FROM payments WHERE order_id = ?", [order_id]);
      return res.json({
        message: 'Payment has already been confirmed for this order.',
        payment: existingPay
      });
    }

    // Server-side verification & transaction generation
    const prefix = payment_method.toUpperCase();
    const txnRef = `${prefix}-SANDBOX-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    // Update payment record
    const existingRecord = get("SELECT id FROM payments WHERE order_id = ?", [order_id]);
    if (existingRecord) {
      run(`
        UPDATE payments SET
          payment_method = ?,
          transaction_reference = ?,
          payment_status = 'completed',
          amount = ?
        WHERE order_id = ?
      `, [payment_method, txnRef, order.total_amount, order_id]);
    } else {
      run(`
        INSERT INTO payments (id, order_id, payment_method, transaction_reference, payment_status, amount)
        VALUES (?, ?, ?, ?, 'completed', ?)
      `, [uuidv4(), order_id, payment_method, txnRef, order.total_amount]);
    }

    // Update order payment status
    run("UPDATE orders SET payment_status = 'completed' WHERE id = ?", [order_id]);

    // Send payment confirmation notification
    run(`
      INSERT INTO notifications (id, user_id, notification_type, message, link)
      VALUES (?, ?, 'payment', ?, ?)
    `, [
      uuidv4(),
      order.buyer_id,
      `Payment of ₹${order.total_amount} confirmed (Ref: ${txnRef}) for order #${order_id}.`,
      `/order/${order_id}`
    ]);

    recordAudit(req.user.id, 'PAYMENT_PROCESSED', { orderId: order_id, txnRef, method: payment_method });

    res.json({
      success: true,
      message: 'Payment verified and captured successfully via sandbox gateway.',
      transaction: {
        order_id,
        payment_method,
        transaction_reference: txnRef,
        amount: order.total_amount,
        status: 'completed',
        timestamp: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error("Payment process error:", err);
    res.status(500).json({ error: 'Payment processing error' });
  }
});

// Get payment receipt by order ID
router.get('/:orderId/receipt', authenticateToken, (req, res) => {
  try {
    const order = get("SELECT * FROM orders WHERE id = ?", [req.params.orderId]);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (req.user.role !== 'admin' && order.buyer_id !== req.user.id && order.farmer_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized to view receipt' });
    }

    const payment = get("SELECT * FROM payments WHERE order_id = ?", [req.params.orderId]);
    const items = query("SELECT * FROM order_items WHERE order_id = ?", [req.params.orderId]);
    const farmer = get("SELECT u.full_name, fp.farm_name, fp.farm_location FROM users u JOIN farmer_profiles fp ON u.id = fp.user_id WHERE u.id = ?", [order.farmer_id]);
    const buyer = get("SELECT full_name, email, phone FROM users WHERE id = ?", [order.buyer_id]);

    res.json({
      receipt_id: 'REC-' + order.id,
      order,
      payment,
      items,
      farmer,
      buyer,
      issued_at: new Date().toISOString()
    });
  } catch (err) {
    console.error("Receipt error:", err);
    res.status(500).json({ error: 'Failed to generate receipt' });
  }
});

module.exports = router;

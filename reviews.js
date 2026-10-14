const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();
const { get, query, run } = require('../db/database');
const { authenticateToken, requireRole, recordAudit } = require('../middleware/auth');

// Create review (Only verified buyers with delivered order for this product!)
router.post('/', authenticateToken, requireRole('buyer'), (req, res) => {
  try {
    const { order_id, product_id, rating, review_text } = req.body;
    const buyerId = req.user.id;

    if (!order_id || !product_id || !rating) {
      return res.status(400).json({ error: 'Order ID, product ID, and rating are required.' });
    }

    const numericRating = Number(rating);
    if (isNaN(numericRating) || numericRating < 1 || numericRating > 5) {
      return res.status(400).json({ error: 'Rating must be an integer between 1 and 5.' });
    }

    // Verify buyer has a delivered order containing this product
    const eligibleOrder = get(`
      SELECT o.id, o.order_status, oi.id as item_id, p.farmer_id
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      WHERE o.id = ? AND o.buyer_id = ? AND oi.product_id = ? AND o.order_status = 'delivered'
    `, [order_id, buyerId, product_id]);

    if (!eligibleOrder) {
      return res.status(403).json({
        error: 'Only customers who have an eligible completed and delivered order for this produce can submit a review.'
      });
    }

    // Prevent duplicate reviews for the same order and product
    const existingReview = get("SELECT id FROM reviews WHERE order_id = ? AND product_id = ?", [order_id, product_id]);
    if (existingReview) {
      return res.status(409).json({ error: 'You have already reviewed this product for this order.' });
    }

    const reviewId = 'rev-' + uuidv4().slice(0, 8);
    run(`
      INSERT INTO reviews (id, buyer_id, product_id, order_id, rating, review_text)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [reviewId, buyerId, product_id, order_id, numericRating, review_text || '']);

    // Update farmer profile overall rating and review count
    const farmerId = eligibleOrder.farmer_id;
    const stats = get(`
      SELECT AVG(r.rating) as avg_rating, COUNT(r.id) as total_revs
      FROM reviews r
      JOIN products p ON r.product_id = p.id
      WHERE p.farmer_id = ?
    `, [farmerId]);

    if (stats) {
      run(
        "UPDATE farmer_profiles SET rating = ?, reviews_count = ? WHERE user_id = ?",
        [Math.round(stats.avg_rating * 10) / 10, stats.total_revs, farmerId]
      );
    }

    // Notify farmer of new customer review
    run(`
      INSERT INTO notifications (id, user_id, notification_type, message, link)
      VALUES (?, ?, 'system', ?, ?)
    `, [
      uuidv4(),
      farmerId,
      `New ${numericRating}-star review received from ${req.user.full_name}!`,
      `/product/${product_id}`
    ]);

    recordAudit(buyerId, 'REVIEW_SUBMITTED', { reviewId, productId: product_id, rating: numericRating });

    res.status(201).json({
      message: 'Review posted successfully. Thank you for supporting the farmer!',
      reviewId
    });
  } catch (err) {
    console.error("Submit review error:", err);
    res.status(500).json({ error: 'Failed to post review' });
  }
});

// Farmer response to review
router.post('/:id/respond', authenticateToken, requireRole('farmer'), (req, res) => {
  try {
    const { response_text } = req.body;
    if (!response_text || !response_text.trim()) {
      return res.status(400).json({ error: 'Response text is required' });
    }

    const review = get(`
      SELECT r.*, p.farmer_id
      FROM reviews r
      JOIN products p ON r.product_id = p.id
      WHERE r.id = ?
    `, [req.params.id]);

    if (!review) {
      return res.status(404).json({ error: 'Review not found' });
    }

    if (review.farmer_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized: You can only respond to reviews on your own produce.' });
    }

    run("UPDATE reviews SET farmer_response = ? WHERE id = ?", [response_text.trim(), review.id]);

    // Notify buyer
    run(`
      INSERT INTO notifications (id, user_id, notification_type, message, link)
      VALUES (?, ?, 'message', ?, ?)
    `, [
      uuidv4(),
      review.buyer_id,
      `Farmer responded to your review on product #${review.product_id}.`,
      `/product/${review.product_id}`
    ]);

    res.json({ message: 'Response published successfully' });
  } catch (err) {
    console.error("Farmer review response error:", err);
    res.status(500).json({ error: 'Failed to respond to review' });
  }
});

// Report review for admin moderation
router.post('/:id/report', authenticateToken, (req, res) => {
  try {
    const { reason } = req.body;
    const review = get("SELECT * FROM reviews WHERE id = ?", [req.params.id]);
    if (!review) {
      return res.status(404).json({ error: 'Review not found' });
    }

    run("UPDATE reviews SET reported = 1 WHERE id = ?", [review.id]);

    // Create dispute entry for admin
    run(`
      INSERT INTO disputes (id, reported_by, target_type, target_id, reason, status)
      VALUES (?, ?, 'review', ?, ?, 'open')
    `, [uuidv4(), req.user.id, review.id, reason || 'Flagged for moderation']);

    res.json({ message: 'Review reported for administrative moderation.' });
  } catch (err) {
    console.error("Report review error:", err);
    res.status(500).json({ error: 'Failed to report review' });
  }
});

module.exports = router;

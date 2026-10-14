const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();
const { get, query, run } = require('../db/database');
const { authenticateToken, requireRole, recordAudit } = require('../middleware/auth');

// Get deliveries for current delivery partner
router.get('/my-deliveries', authenticateToken, requireRole('delivery_partner'), (req, res) => {
  try {
    const deliveries = query(`
      SELECT 
        d.*,
        o.id as order_id,
        o.order_status,
        o.total_amount,
        o.delivery_type,
        o.payment_status,
        u_b.full_name as buyer_name,
        u_b.phone as buyer_phone,
        u_f.full_name as farmer_name,
        u_f.phone as farmer_phone,
        fp.farm_name,
        fp.farm_location
      FROM deliveries d
      JOIN orders o ON d.order_id = o.id
      JOIN users u_b ON o.buyer_id = u_b.id
      JOIN users u_f ON o.farmer_id = u_f.id
      LEFT JOIN farmer_profiles fp ON u_f.id = fp.user_id
      WHERE d.delivery_partner_id = ?
      ORDER BY d.created_at DESC
    `, [req.user.id]);

    for (const d of deliveries) {
      d.items = query("SELECT product_name, quantity, unit FROM order_items WHERE order_id = ?", [d.order_id]);
    }

    res.json(deliveries);
  } catch (err) {
    console.error("My deliveries error:", err);
    res.status(500).json({ error: 'Failed to retrieve deliveries' });
  }
});

// Get available unassigned deliveries ready for pickup
router.get('/available', authenticateToken, requireRole('delivery_partner'), (req, res) => {
  try {
    const available = query(`
      SELECT 
        d.*,
        o.id as order_id,
        o.order_status,
        o.total_amount,
        o.delivery_fee,
        u_b.full_name as buyer_name,
        u_f.full_name as farmer_name,
        fp.farm_name,
        fp.farm_location
      FROM deliveries d
      JOIN orders o ON d.order_id = o.id
      JOIN users u_b ON o.buyer_id = u_b.id
      JOIN users u_f ON o.farmer_id = u_f.id
      LEFT JOIN farmer_profiles fp ON u_f.id = fp.user_id
      WHERE (d.delivery_partner_id IS NULL OR d.delivery_partner_id = '')
        AND o.order_status NOT IN ('delivered', 'cancelled')
      ORDER BY d.created_at ASC
    `);

    for (const d of available) {
      d.items = query("SELECT product_name, quantity, unit FROM order_items WHERE order_id = ?", [d.order_id]);
    }

    res.json(available);
  } catch (err) {
    console.error("Available deliveries error:", err);
    res.status(500).json({ error: 'Failed to retrieve available deliveries' });
  }
});

// Accept delivery assignment
router.post('/:id/accept', authenticateToken, requireRole('delivery_partner'), (req, res) => {
  try {
    const delivery = get("SELECT * FROM deliveries WHERE id = ?", [req.params.id]);
    if (!delivery) {
      return res.status(404).json({ error: 'Delivery record not found' });
    }

    if (delivery.delivery_partner_id && delivery.delivery_partner_id !== req.user.id) {
      return res.status(409).json({ error: 'This delivery has already been assigned to another partner.' });
    }

    run("UPDATE deliveries SET delivery_partner_id = ? WHERE id = ?", [req.user.id, delivery.id]);
    run("UPDATE orders SET delivery_partner_id = ? WHERE id = ?", [req.user.id, delivery.order_id]);

    // Notify buyer
    const order = get("SELECT buyer_id, id FROM orders WHERE id = ?", [delivery.order_id]);
    if (order) {
      run(`
        INSERT INTO notifications (id, user_id, notification_type, message, link)
        VALUES (?, ?, 'delivery', ?, ?)
      `, [
        uuidv4(),
        order.buyer_id,
        `Delivery partner ${req.user.full_name} has accepted pickup for order #${order.id}.`,
        `/order/${order.id}`
      ]);
    }

    recordAudit(req.user.id, 'DELIVERY_ACCEPTED', { deliveryId: delivery.id, orderId: delivery.order_id });

    res.json({ message: 'Delivery assignment accepted successfully' });
  } catch (err) {
    console.error("Accept delivery error:", err);
    res.status(500).json({ error: 'Failed to accept delivery' });
  }
});

// Update delivery status
router.patch('/:id/status', authenticateToken, (req, res) => {
  try {
    const { status, pickup_status, tracking_notes } = req.body;
    const user = req.user;

    const delivery = get("SELECT * FROM deliveries WHERE id = ?", [req.params.id]);
    if (!delivery) {
      return res.status(404).json({ error: 'Delivery record not found' });
    }

    if (user.role !== 'admin' && delivery.delivery_partner_id !== user.id) {
      return res.status(403).json({ error: 'Unauthorized to update this delivery' });
    }

    const updates = [];
    const params = [];

    if (status) {
      updates.push("delivery_status = ?");
      params.push(status);
    }
    if (pickup_status) {
      updates.push("pickup_status = ?");
      params.push(pickup_status);
    }
    if (tracking_notes) {
      updates.push("tracking_notes = ?");
      params.push(tracking_notes);
    }

    if (status === 'delivered') {
      updates.push("delivered_at = CURRENT_TIMESTAMP");
      // Synchronize order status
      run("UPDATE orders SET order_status = 'delivered' WHERE id = ?", [delivery.order_id]);
    } else if (status === 'in_transit') {
      run("UPDATE orders SET order_status = 'shipped' WHERE id = ?", [delivery.order_id]);
    }

    params.push(delivery.id);
    run(`UPDATE deliveries SET ${updates.join(', ')} WHERE id = ?`, params);

    // Notify buyer
    const order = get("SELECT buyer_id FROM orders WHERE id = ?", [delivery.order_id]);
    if (order) {
      run(`
        INSERT INTO notifications (id, user_id, notification_type, message, link)
        VALUES (?, ?, 'delivery', ?, ?)
      `, [
        uuidv4(),
        order.buyer_id,
        `Delivery status update for #${delivery.order_id}: ${status.toUpperCase()} (${tracking_notes || 'In progress'})`,
        `/order/${delivery.order_id}`
      ]);
    }

    recordAudit(user.id, 'DELIVERY_STATUS_UPDATED', { deliveryId: delivery.id, status, notes: tracking_notes });

    res.json({ message: 'Delivery status updated successfully' });
  } catch (err) {
    console.error("Update delivery error:", err);
    res.status(500).json({ error: 'Failed to update delivery status' });
  }
});

// Order tracking with simulated status milestone timeline
router.get('/track/:orderId', (req, res) => {
  try {
    const order = get(`
      SELECT 
        o.id, o.order_status, o.created_at, o.delivery_type, o.delivery_address,
        d.pickup_address, d.dropoff_address, d.delivery_status, d.pickup_status,
        d.estimated_delivery, d.delivered_at, d.tracking_notes,
        dp.full_name as partner_name, dp.phone as partner_phone
      FROM orders o
      LEFT JOIN deliveries d ON o.id = d.order_id
      LEFT JOIN users dp ON d.delivery_partner_id = dp.id
      WHERE o.id = ?
    `, [req.params.orderId]);

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Milestones for tracking stepper
    const milestones = [
      {
        step: 1,
        title: 'Order Placed',
        description: 'Order confirmed and inventory reserved from farm',
        status: 'completed',
        timestamp: order.created_at
      },
      {
        step: 2,
        title: 'Farm Harvest & Packaging',
        description: 'Farmer is harvesting produce fresh from fields',
        status: ['preparing', 'ready_for_pickup', 'shipped', 'delivered'].includes(order.order_status) ? 'completed' : (order.order_status === 'pending_confirmation' ? 'current' : 'pending'),
        timestamp: null
      },
      {
        step: 3,
        title: 'Picked Up by Logistics',
        description: order.partner_name ? `Picked up by ${order.partner_name} for climate-controlled transit` : 'Assigned to delivery route',
        status: ['shipped', 'delivered'].includes(order.order_status) ? 'completed' : (order.order_status === 'ready_for_pickup' ? 'current' : 'pending'),
        timestamp: null
      },
      {
        step: 4,
        title: 'Out for Delivery / In Transit',
        description: 'Produce on the way to destination address',
        status: order.order_status === 'delivered' ? 'completed' : (order.order_status === 'shipped' ? 'current' : 'pending'),
        timestamp: null
      },
      {
        step: 5,
        title: 'Delivered',
        description: 'Fresh farm produce handed over successfully',
        status: order.order_status === 'delivered' ? 'completed' : 'pending',
        timestamp: order.delivered_at
      }
    ];

    res.json({
      order,
      milestones,
      is_simulated_gps: true, // Note clearly that live GPS is simulated
      tracking_mode_notice: "Simulated milestone logistics tracking for demonstration purposes."
    });
  } catch (err) {
    console.error("Track order error:", err);
    res.status(500).json({ error: 'Failed to retrieve tracking details' });
  }
});

module.exports = router;

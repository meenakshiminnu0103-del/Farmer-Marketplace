const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();
const { get, query, run } = require('../db/database');
const { authenticateToken, recordAudit } = require('../middleware/auth');

// Create Order (Checkout)
router.post('/checkout', authenticateToken, (req, res) => {
  try {
    const buyerId = req.user.id;
    const { items, delivery_address, delivery_type, payment_method } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Order must contain at least one item.' });
    }

    if (!delivery_address || !delivery_address.trim()) {
      return res.status(400).json({ error: 'Delivery address is required.' });
    }

    // Step 1: Validate stock, MOQ, and active status for all items atomically
    const validatedItems = [];
    const farmerItemMap = {}; // Group by farmer for clean order fulfillment

    for (const item of items) {
      const product = get("SELECT * FROM products WHERE id = ?", [item.product_id]);
      if (!product) {
        return res.status(404).json({ error: `Product with ID '${item.product_id}' was not found.` });
      }

      if (product.availability_status === 'out_of_stock' || product.available_quantity <= 0) {
        return res.status(400).json({ error: `Product '${product.product_name}' is currently out of stock.` });
      }

      const qty = Number(item.quantity);
      if (isNaN(qty) || qty <= 0) {
        return res.status(400).json({ error: `Invalid quantity for '${product.product_name}'.` });
      }

      if (qty < product.minimum_order_quantity) {
        return res.status(400).json({
          error: `Minimum order quantity for '${product.product_name}' is ${product.minimum_order_quantity} ${product.unit}.`
        });
      }

      if (qty > product.available_quantity) {
        return res.status(400).json({
          error: `Insufficient stock for '${product.product_name}'. Requested: ${qty} ${product.unit}, Available: ${product.available_quantity} ${product.unit}.`
        });
      }

      // Calculate bulk discount if eligible
      let unitPrice = product.price;
      if (product.bulk_min_qty > 0 && qty >= product.bulk_min_qty && product.bulk_discount_pct > 0) {
        const discount = (unitPrice * product.bulk_discount_pct) / 100;
        unitPrice = Math.round((unitPrice - discount) * 100) / 100;
      }

      const itemTotal = Math.round(unitPrice * qty * 100) / 100;

      const validated = {
        product,
        quantity: qty,
        unit_price: unitPrice,
        item_total: itemTotal
      };

      validatedItems.push(validated);

      if (!farmerItemMap[product.farmer_id]) {
        farmerItemMap[product.farmer_id] = [];
      }
      farmerItemMap[product.farmer_id].push(validated);
    }

    // Step 2: Atomic Execution: Deduct inventory & create per-farmer orders
    const createdOrders = [];

    for (const [farmerId, farmerItems] of Object.entries(farmerItemMap)) {
      const orderSubtotal = farmerItems.reduce((acc, it) => acc + it.item_total, 0);
      const deliveryFee = delivery_type === 'farmer_pickup' ? 0 : 50;
      const platformFee = 15;
      const totalAmount = Math.round((orderSubtotal + deliveryFee + platformFee) * 100) / 100;

      const orderId = 'ORD-' + Math.floor(100000 + Math.random() * 900000);

      // Create Order Record
      run(`
        INSERT INTO orders (
          id, buyer_id, farmer_id, order_status, subtotal, delivery_fee, platform_fee,
          total_amount, payment_status, delivery_type, delivery_address
        ) VALUES (?, ?, ?, 'pending_confirmation', ?, ?, ?, ?, 'pending', ?, ?)
      `, [
        orderId,
        buyerId,
        farmerId,
        orderSubtotal,
        deliveryFee,
        platformFee,
        totalAmount,
        delivery_type || 'home_delivery',
        delivery_address
      ]);

      // Create Order Items and Deduct Inventory Atomically
      for (const it of farmerItems) {
        const itemId = 'item-' + uuidv4().slice(0, 8);
        run(`
          INSERT INTO order_items (id, order_id, product_id, farmer_id, product_name, unit, quantity, unit_price, item_total)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          itemId,
          orderId,
          it.product.id,
          farmerId,
          it.product.product_name,
          it.product.unit,
          it.quantity,
          it.unit_price,
          it.item_total
        ]);

        // Deduct inventory
        const newQty = it.product.available_quantity - it.quantity;
        const newStatus = newQty <= 0 ? 'out_of_stock' : 'available';
        run("UPDATE products SET available_quantity = ?, availability_status = ? WHERE id = ?", [newQty, newStatus, it.product.id]);

        // Low stock notification to farmer if quantity dropped below MOQ * 2
        if (newQty <= it.product.minimum_order_quantity * 2 && newQty > 0) {
          run("INSERT INTO notifications (id, user_id, notification_type, message, link) VALUES (?, ?, 'stock', ?, ?)", [
            uuidv4(),
            farmerId,
            `Low stock alert: '${it.product.product_name}' has only ${newQty} ${it.product.unit} remaining.`,
            '/farmer/products'
          ]);
        }
      }

      // Create Delivery Record
      const farmerProfile = get("SELECT farm_name, farm_location FROM farmer_profiles WHERE user_id = ?", [farmerId]);
      const pickupAddress = farmerProfile ? `${farmerProfile.farm_name}, ${farmerProfile.farm_location}` : 'Farmer Premises';

      run(`
        INSERT INTO deliveries (
          id, order_id, pickup_status, delivery_status, pickup_address, dropoff_address, estimated_delivery, tracking_notes
        ) VALUES (?, ?, 'pending', 'assigned', ?, ?, 'Estimated in 24-48 hours', 'Order placed. Awaiting farmer harvest confirmation.')
      `, [
        'del-' + uuidv4().slice(0, 8),
        orderId,
        pickupAddress,
        delivery_address
      ]);

      // Create Payment Transaction Record
      const pMethod = payment_method || 'cod';
      const txnRef = 'FD-' + (pMethod === 'cod' ? 'COD' : 'PAY') + '-' + Math.floor(100000000 + Math.random() * 900000000);
      const pStatus = pMethod === 'cod' ? 'pending' : 'completed';

      run(`
        INSERT INTO payments (id, order_id, payment_method, transaction_reference, payment_status, amount)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        'pay-' + uuidv4().slice(0, 8),
        orderId,
        pMethod,
        txnRef,
        pStatus,
        totalAmount
      ]);

      if (pStatus === 'completed') {
        run("UPDATE orders SET payment_status = 'completed' WHERE id = ?", [orderId]);
      }

      // Notify Farmer
      run(`
        INSERT INTO notifications (id, user_id, notification_type, message, link)
        VALUES (?, ?, 'order', ?, ?)
      `, [
        uuidv4(),
        farmerId,
        `New order received: ${orderId} (${farmerItems.length} items, ₹${totalAmount}). Please confirm harvest.`,
        '/farmer/orders'
      ]);

      // Notify Buyer
      run(`
        INSERT INTO notifications (id, user_id, notification_type, message, link)
        VALUES (?, ?, 'order', ?, ?)
      `, [
        uuidv4(),
        buyerId,
        `Order ${orderId} placed successfully with ${farmerProfile ? farmerProfile.farm_name : 'the farmer'}!`,
        '/buyer/orders'
      ]);

      createdOrders.push({
        order_id: orderId,
        farmer_name: farmerProfile ? farmerProfile.farm_name : 'Farmer',
        total_amount: totalAmount,
        payment_status: pStatus,
        transaction_reference: txnRef
      });
    }

    recordAudit(buyerId, 'CHECKOUT_SUCCESS', { count: createdOrders.length });

    res.status(201).json({
      message: 'Order(s) placed successfully!',
      orders: createdOrders
    });
  } catch (err) {
    console.error("Checkout error:", err);
    res.status(500).json({ error: 'Failed to process checkout' });
  }
});

// List orders with role filtering
router.get('/', authenticateToken, (req, res) => {
  try {
    const user = req.user;
    let sql = `
      SELECT 
        o.*,
        u_b.full_name as buyer_name,
        u_b.phone as buyer_phone,
        u_f.full_name as farmer_name,
        fp.farm_name,
        fp.farm_location,
        d.delivery_status,
        d.estimated_delivery,
        p.payment_method,
        p.transaction_reference
      FROM orders o
      JOIN users u_b ON o.buyer_id = u_b.id
      JOIN users u_f ON o.farmer_id = u_f.id
      LEFT JOIN farmer_profiles fp ON u_f.id = fp.user_id
      LEFT JOIN deliveries d ON o.id = d.order_id
      LEFT JOIN payments p ON o.id = p.order_id
      WHERE 1=1
    `;
    const params = [];

    if (user.role === 'buyer') {
      sql += ` AND o.buyer_id = ?`;
      params.push(user.id);
    } else if (user.role === 'farmer') {
      sql += ` AND o.farmer_id = ?`;
      params.push(user.id);
    } else if (user.role === 'delivery_partner') {
      sql += ` AND (o.delivery_partner_id = ? OR d.delivery_partner_id = ?)`;
      params.push(user.id, user.id);
    }
    // Admin sees all

    sql += ` ORDER BY o.created_at DESC`;

    const orders = query(sql, params);

    // Fetch items for each order
    for (const order of orders) {
      order.items = query("SELECT * FROM order_items WHERE order_id = ?", [order.id]);
    }

    res.json(orders);
  } catch (err) {
    console.error("Orders list error:", err);
    res.status(500).json({ error: 'Failed to retrieve orders' });
  }
});

// Get single order details with full items, delivery tracking, payment, and review eligibility
router.get('/:id', authenticateToken, (req, res) => {
  try {
    const user = req.user;
    const order = get(`
      SELECT 
        o.*,
        u_b.full_name as buyer_name,
        u_b.phone as buyer_phone,
        u_b.email as buyer_email,
        u_f.full_name as farmer_name,
        u_f.phone as farmer_phone,
        fp.farm_name,
        fp.farm_location,
        d.id as delivery_id,
        d.delivery_status,
        d.pickup_status,
        d.pickup_address,
        d.dropoff_address,
        d.estimated_delivery,
        d.delivered_at,
        d.tracking_notes,
        p.payment_method,
        p.transaction_reference,
        dp.full_name as delivery_partner_name,
        dp.phone as delivery_partner_phone
      FROM orders o
      JOIN users u_b ON o.buyer_id = u_b.id
      JOIN users u_f ON o.farmer_id = u_f.id
      LEFT JOIN farmer_profiles fp ON u_f.id = fp.user_id
      LEFT JOIN deliveries d ON o.id = d.order_id
      LEFT JOIN payments p ON o.id = p.order_id
      LEFT JOIN users dp ON d.delivery_partner_id = dp.id
      WHERE o.id = ?
    `, [req.params.id]);

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Role access control: only authorized participants or admin
    if (
      user.role !== 'admin' &&
      order.buyer_id !== user.id &&
      order.farmer_id !== user.id &&
      order.delivery_partner_id !== user.id
    ) {
      return res.status(403).json({ error: 'Unauthorized to view this order.' });
    }

    const items = query("SELECT * FROM order_items WHERE order_id = ?", [order.id]);
    order.items = items;

    // Check review eligibility for each product
    if (user.role === 'buyer' && order.order_status === 'delivered') {
      for (const it of order.items) {
        const rev = get("SELECT * FROM reviews WHERE order_id = ? AND product_id = ?", [order.id, it.product_id]);
        it.review = rev;
      }
    }

    res.json(order);
  } catch (err) {
    console.error("Order detail error:", err);
    res.status(500).json({ error: 'Failed to retrieve order details' });
  }
});

// Update order status (Farmer, Delivery Partner, or Admin)
router.patch('/:id/status', authenticateToken, (req, res) => {
  try {
    const { status, tracking_notes } = req.body;
    const user = req.user;

    const validStatuses = [
      'pending_confirmation',
      'confirmed',
      'preparing',
      'ready_for_pickup',
      'shipped',
      'delivered',
      'cancelled'
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid order status' });
    }

    const order = get("SELECT * FROM orders WHERE id = ?", [req.params.id]);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Verify permission
    if (user.role === 'farmer' && order.farmer_id !== user.id) {
      return res.status(403).json({ error: 'Unauthorized to update this order' });
    }

    if (user.role === 'buyer' && status !== 'cancelled') {
      return res.status(403).json({ error: 'Buyers can only request order cancellation' });
    }

    // Handle cancellation and stock restoration
    if (status === 'cancelled') {
      if (['shipped', 'delivered'].includes(order.order_status)) {
        return res.status(400).json({ error: 'Orders already shipped or delivered cannot be cancelled.' });
      }

      // Restore inventory
      const items = query("SELECT product_id, quantity FROM order_items WHERE order_id = ?", [order.id]);
      for (const it of items) {
        run(
          "UPDATE products SET available_quantity = available_quantity + ?, availability_status = 'available' WHERE id = ?",
          [it.quantity, it.product_id]
        );
      }

      // Update payment status to refunded if completed
      if (order.payment_status === 'completed') {
        run("UPDATE orders SET payment_status = 'refunded' WHERE id = ?", [order.id]);
        run("UPDATE payments SET payment_status = 'refunded' WHERE order_id = ?", [order.id]);
      }
    }

    // Update order status
    run("UPDATE orders SET order_status = ? WHERE id = ?", [status, order.id]);

    // Synchronize delivery table status
    let deliveryStatus = 'assigned';
    if (['preparing', 'ready_for_pickup'].includes(status)) {
      deliveryStatus = 'assigned';
    } else if (status === 'shipped') {
      deliveryStatus = 'in_transit';
    } else if (status === 'delivered') {
      deliveryStatus = 'delivered';
      run("UPDATE deliveries SET delivered_at = CURRENT_TIMESTAMP WHERE order_id = ?", [order.id]);
    }

    run(
      "UPDATE deliveries SET delivery_status = ?, tracking_notes = COALESCE(?, tracking_notes) WHERE order_id = ?",
      [deliveryStatus, tracking_notes, order.id]
    );

    // Notify Buyer about status update
    run(`
      INSERT INTO notifications (id, user_id, notification_type, message, link)
      VALUES (?, ?, 'order', ?, ?)
    `, [
      uuidv4(),
      order.buyer_id,
      `Your order #${order.id} status is now: ${status.replace(/_/g, ' ').toUpperCase()}`,
      `/order/${order.id}`
    ]);

    recordAudit(user.id, 'ORDER_STATUS_UPDATED', { orderId: order.id, status });

    const updated = get("SELECT * FROM orders WHERE id = ?", [order.id]);
    res.json({ message: 'Order status updated successfully', order: updated });
  } catch (err) {
    console.error("Order status update error:", err);
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

// Cancel Order endpoint
router.post('/:id/cancel', authenticateToken, (req, res) => {
  try {
    const { reason } = req.body;
    const user = req.user;
    const order = get("SELECT * FROM orders WHERE id = ?", [req.params.id]);

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (user.role !== 'admin' && order.buyer_id !== user.id && order.farmer_id !== user.id) {
      return res.status(403).json({ error: 'Unauthorized to cancel this order' });
    }

    if (['shipped', 'delivered'].includes(order.order_status)) {
      return res.status(400).json({ error: 'Order has already been dispatched or delivered and cannot be cancelled.' });
    }

    // Restore stock
    const items = query("SELECT product_id, quantity FROM order_items WHERE order_id = ?", [order.id]);
    for (const it of items) {
      run(
        "UPDATE products SET available_quantity = available_quantity + ?, availability_status = 'available' WHERE id = ?",
        [it.quantity, it.product_id]
      );
    }

    // Set refund if paid
    let paymentStatus = order.payment_status;
    if (order.payment_status === 'completed') {
      paymentStatus = 'refunded';
      run("UPDATE payments SET payment_status = 'refunded' WHERE order_id = ?", [order.id]);
    }

    run(
      "UPDATE orders SET order_status = 'cancelled', cancel_reason = ?, payment_status = ? WHERE id = ?",
      [reason || 'Cancelled by user', paymentStatus, order.id]
    );

    run(
      "UPDATE deliveries SET delivery_status = 'failed', tracking_notes = 'Order cancelled.' WHERE order_id = ?",
      [order.id]
    );

    // Notify parties
    const notifyTarget = user.id === order.buyer_id ? order.farmer_id : order.buyer_id;
    run(`
      INSERT INTO notifications (id, user_id, notification_type, message, link)
      VALUES (?, ?, 'order', ?, ?)
    `, [
      uuidv4(),
      notifyTarget,
      `Order #${order.id} was cancelled. Reason: ${reason || 'Not specified'}. Stock restored.`,
      `/order/${order.id}`
    ]);

    recordAudit(user.id, 'ORDER_CANCELLED', { orderId: order.id, reason });

    res.json({ message: 'Order successfully cancelled and inventory restored.' });
  } catch (err) {
    console.error("Order cancel error:", err);
    res.status(500).json({ error: 'Failed to cancel order' });
  }
});

module.exports = router;

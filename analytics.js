const express = require('express');
const router = express.Router();
const { get, query } = require('../db/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

// Farmer Dashboard Analytics
router.get('/farmer', authenticateToken, requireRole('farmer'), (req, res) => {
  try {
    const farmerId = req.user.id;

    // Summary counts
    const activeListings = get("SELECT COUNT(*) as count FROM products WHERE farmer_id = ? AND availability_status = 'available'", [farmerId]);
    const totalOrders = get("SELECT COUNT(*) as count FROM orders WHERE farmer_id = ?", [farmerId]);
    const pendingOrders = get("SELECT COUNT(*) as count FROM orders WHERE farmer_id = ? AND order_status IN ('pending_confirmation', 'confirmed', 'preparing')", [farmerId]);
    const completedOrders = get("SELECT COUNT(*) as count FROM orders WHERE farmer_id = ? AND order_status = 'delivered'", [farmerId]);
    const totalRevenue = get("SELECT COALESCE(SUM(subtotal), 0) as total FROM orders WHERE farmer_id = ? AND order_status != 'cancelled'", [farmerId]);

    // Low stock alerts
    const lowStockAlerts = query(`
      SELECT id, product_name, available_quantity, minimum_order_quantity, unit, price, image_url
      FROM products
      WHERE farmer_id = ? AND available_quantity <= (minimum_order_quantity * 2)
      ORDER BY available_quantity ASC
    `, [farmerId]);

    // Top selling products
    const topProducts = query(`
      SELECT p.id, p.product_name, p.unit, p.price, COALESCE(SUM(oi.quantity), 0) as total_sold, COALESCE(SUM(oi.item_total), 0) as total_revenue
      FROM products p
      LEFT JOIN order_items oi ON p.id = oi.product_id
      LEFT JOIN orders o ON oi.order_id = o.id AND o.order_status != 'cancelled'
      WHERE p.farmer_id = ?
      GROUP BY p.id
      ORDER BY total_sold DESC
      LIMIT 5
    `, [farmerId]);

    // Revenue history for chart (Last 7 days or mock series)
    const revenueData = [
      { day: 'Mon', revenue: 1400, orders: 3 },
      { day: 'Tue', revenue: 2800, orders: 5 },
      { day: 'Wed', revenue: 1950, orders: 4 },
      { day: 'Thu', revenue: 3600, orders: 7 },
      { day: 'Fri', revenue: 4200, orders: 8 },
      { day: 'Sat', revenue: 5800, orders: 12 },
      { day: 'Sun', revenue: 4900, orders: 10 }
    ];

    // Recent enquiries
    const recentEnquiries = query(`
      SELECT m.*, u.full_name as sender_name, p.product_name
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      LEFT JOIN products p ON m.product_id = p.id
      WHERE m.receiver_id = ?
      ORDER BY m.created_at DESC
      LIMIT 5
    `, [farmerId]);

    res.json({
      metrics: {
        activeListings: activeListings ? activeListings.count : 0,
        totalOrders: totalOrders ? totalOrders.count : 0,
        pendingOrders: pendingOrders ? pendingOrders.count : 0,
        completedOrders: completedOrders ? completedOrders.count : 0,
        totalRevenue: totalRevenue ? totalRevenue.total : 0
      },
      lowStockAlerts,
      topProducts,
      revenueChart: revenueData,
      recentEnquiries
    });
  } catch (err) {
    console.error("Farmer analytics error:", err);
    res.status(500).json({ error: 'Failed to retrieve farmer analytics' });
  }
});

// Buyer Dashboard Analytics
router.get('/buyer', authenticateToken, requireRole('buyer'), (req, res) => {
  try {
    const buyerId = req.user.id;

    const totalOrders = get("SELECT COUNT(*) as count FROM orders WHERE buyer_id = ?", [buyerId]);
    const activeOrders = get("SELECT COUNT(*) as count FROM orders WHERE buyer_id = ? AND order_status NOT IN ('delivered', 'cancelled')", [buyerId]);
    const totalSpent = get("SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE buyer_id = ? AND order_status != 'cancelled'", [buyerId]);
    const totalReviews = get("SELECT COUNT(*) as count FROM reviews WHERE buyer_id = ?", [buyerId]);

    // Recent orders
    const recentOrders = query(`
      SELECT o.*, fp.farm_name, fp.farm_location, d.delivery_status
      FROM orders o
      JOIN users u_f ON o.farmer_id = u_f.id
      LEFT JOIN farmer_profiles fp ON u_f.id = fp.user_id
      LEFT JOIN deliveries d ON o.id = d.order_id
      WHERE o.buyer_id = ?
      ORDER BY o.created_at DESC
      LIMIT 5
    `, [buyerId]);

    for (const o of recentOrders) {
      o.items = query("SELECT * FROM order_items WHERE order_id = ?", [o.id]);
    }

    res.json({
      metrics: {
        totalOrders: totalOrders ? totalOrders.count : 0,
        activeOrders: activeOrders ? activeOrders.count : 0,
        totalSpent: totalSpent ? totalSpent.total : 0,
        totalReviews: totalReviews ? totalReviews.count : 0
      },
      recentOrders
    });
  } catch (err) {
    console.error("Buyer analytics error:", err);
    res.status(500).json({ error: 'Failed to retrieve buyer analytics' });
  }
});

// Admin Platform Analytics
router.get('/admin', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const usersCount = get("SELECT COUNT(*) as count FROM users");
    const farmersCount = get("SELECT COUNT(*) as count FROM users WHERE role = 'farmer'");
    const buyersCount = get("SELECT COUNT(*) as count FROM users WHERE role = 'buyer'");
    const deliveryPartnersCount = get("SELECT COUNT(*) as count FROM users WHERE role = 'delivery_partner'");
    const totalOrders = get("SELECT COUNT(*) as count FROM orders");
    const gmv = get("SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE order_status != 'cancelled'");
    const openDisputes = get("SELECT COUNT(*) as count FROM disputes WHERE status = 'open'");

    // Category distribution
    const categoryStats = query(`
      SELECT c.category_name, COUNT(p.id) as product_count
      FROM categories c
      LEFT JOIN products p ON c.id = p.category_id
      GROUP BY c.id
    `);

    // 6-month growth trend
    const platformTrend = [
      { month: 'May', gmv: 34000, orders: 42 },
      { month: 'Jun', gmv: 52000, orders: 68 },
      { month: 'Jul', gmv: 78000, orders: 95 },
      { month: 'Aug', gmv: 110000, orders: 130 },
      { month: 'Sep', gmv: 145000, orders: 180 },
      { month: 'Oct', gmv: 198000, orders: 245 }
    ];

    res.json({
      metrics: {
        totalUsers: usersCount ? usersCount.count : 0,
        totalFarmers: farmersCount ? farmersCount.count : 0,
        totalBuyers: buyersCount ? buyersCount.count : 0,
        totalDeliveryPartners: deliveryPartnersCount ? deliveryPartnersCount.count : 0,
        totalOrders: totalOrders ? totalOrders.count : 0,
        gmv: gmv ? gmv.total : 0,
        openDisputes: openDisputes ? openDisputes.count : 0
      },
      categoryStats,
      platformTrend
    });
  } catch (err) {
    console.error("Admin analytics error:", err);
    res.status(500).json({ error: 'Failed to retrieve admin analytics' });
  }
});

module.exports = router;

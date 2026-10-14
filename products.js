const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();
const { get, query, run } = require('../db/database');
const { authenticateToken, requireRole, optionalAuth, recordAudit } = require('../middleware/auth');

// Get all categories with product counts
router.get('/categories/all', (req, res) => {
  try {
    const categories = query(`
      SELECT c.*, COUNT(p.id) as product_count
      FROM categories c
      LEFT JOIN products p ON c.id = p.category_id AND p.availability_status != 'out_of_stock'
      GROUP BY c.id
      ORDER BY c.category_name ASC
    `);
    res.json(categories);
  } catch (err) {
    console.error("Categories error:", err);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Search and filter marketplace products
router.get('/', optionalAuth, (req, res) => {
  try {
    const {
      search,
      category,
      min_price,
      max_price,
      location,
      organic,
      bulk_only,
      sort,
      farmer_id
    } = req.query;

    let sql = `
      SELECT 
        p.*,
        c.category_name,
        u.full_name as farmer_name,
        fp.farm_name,
        fp.farm_location,
        fp.rating as farmer_rating,
        fp.reviews_count as farmer_reviews_count,
        fp.verification_status as farmer_verified
      FROM products p
      JOIN users u ON p.farmer_id = u.id
      JOIN farmer_profiles fp ON u.id = fp.user_id
      JOIN categories c ON p.category_id = c.id
      WHERE 1=1
    `;

    const params = [];

    if (farmer_id) {
      sql += ` AND p.farmer_id = ?`;
      params.push(farmer_id);
    }

    if (search && search.trim()) {
      sql += ` AND (p.product_name LIKE ? OR p.description LIKE ? OR fp.farm_name LIKE ? OR fp.farm_location LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term);
    }

    if (category && category !== 'all') {
      sql += ` AND (p.category_id = ? OR c.category_name LIKE ?)`;
      params.push(category, `%${category}%`);
    }

    if (min_price && !isNaN(Number(min_price))) {
      sql += ` AND p.price >= ?`;
      params.push(Number(min_price));
    }

    if (max_price && !isNaN(Number(max_price))) {
      sql += ` AND p.price <= ?`;
      params.push(Number(max_price));
    }

    if (location && location.trim()) {
      sql += ` AND fp.farm_location LIKE ?`;
      params.push(`%${location.trim()}%`);
    }

    if (organic === 'true' || organic === '1') {
      sql += ` AND p.is_organic = 1`;
    }

    if (bulk_only === 'true' || bulk_only === '1') {
      sql += ` AND p.bulk_discount_pct > 0`;
    }

    // Sorting
    if (sort === 'price_asc') {
      sql += ` ORDER BY p.price ASC`;
    } else if (sort === 'price_desc') {
      sql += ` ORDER BY p.price DESC`;
    } else if (sort === 'rating') {
      sql += ` ORDER BY fp.rating DESC`;
    } else if (sort === 'stock') {
      sql += ` ORDER BY p.available_quantity DESC`;
    } else {
      sql += ` ORDER BY p.created_at DESC`;
    }

    const products = query(sql, params);
    res.json(products);
  } catch (err) {
    console.error("Products fetch error:", err);
    res.status(500).json({ error: 'Failed to retrieve products' });
  }
});

// Get farmer public profile and listings
router.get('/farmer/:farmerId', (req, res) => {
  try {
    const { farmerId } = req.params;
    const farmer = get(`
      SELECT 
        u.id, u.full_name, u.email, u.phone, u.created_at as member_since,
        fp.farm_name, fp.farm_location, fp.farm_description, fp.verification_status,
        fp.rating, fp.reviews_count, fp.total_sales
      FROM users u
      JOIN farmer_profiles fp ON u.id = fp.user_id
      WHERE u.id = ? AND u.role = 'farmer'
    `, [farmerId]);

    if (!farmer) {
      return res.status(404).json({ error: 'Farmer not found' });
    }

    const products = query(`
      SELECT p.*, c.category_name
      FROM products p
      JOIN categories c ON p.category_id = c.id
      WHERE p.farmer_id = ?
      ORDER BY p.created_at DESC
    `, [farmerId]);

    const reviews = query(`
      SELECT r.*, u.full_name as buyer_name, p.product_name
      FROM reviews r
      JOIN users u ON r.buyer_id = u.id
      JOIN products p ON r.product_id = p.id
      WHERE p.farmer_id = ?
      ORDER BY r.created_at DESC
      LIMIT 10
    `, [farmerId]);

    res.json({
      farmer,
      products,
      reviews
    });
  } catch (err) {
    console.error("Farmer profile error:", err);
    res.status(500).json({ error: 'Failed to fetch farmer profile' });
  }
});

// Get single product details + reviews + price comparison
router.get('/:id', (req, res) => {
  try {
    const product = get(`
      SELECT 
        p.*,
        c.category_name,
        u.id as farmer_user_id,
        u.full_name as farmer_name,
        u.phone as farmer_phone,
        fp.farm_name,
        fp.farm_location,
        fp.farm_description,
        fp.rating as farmer_rating,
        fp.reviews_count as farmer_reviews_count,
        fp.verification_status as farmer_verified
      FROM products p
      JOIN users u ON p.farmer_id = u.id
      JOIN farmer_profiles fp ON u.id = fp.user_id
      JOIN categories c ON p.category_id = c.id
      WHERE p.id = ?
    `, [req.params.id]);

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Product reviews
    const reviews = query(`
      SELECT r.*, u.full_name as buyer_name
      FROM reviews r
      JOIN users u ON r.buyer_id = u.id
      WHERE r.product_id = ?
      ORDER BY r.created_at DESC
    `, [req.params.id]);

    // Similar / Comparable products from other farmers in the same category
    const similarProducts = query(`
      SELECT p.id, p.product_name, p.price, p.unit, p.image_url, fp.farm_name, fp.farm_location, fp.rating
      FROM products p
      JOIN users u ON p.farmer_id = u.id
      JOIN farmer_profiles fp ON u.id = fp.user_id
      WHERE p.category_id = ? AND p.id != ? AND p.availability_status = 'available'
      LIMIT 4
    `, [product.category_id, product.id]);

    res.json({
      product,
      reviews,
      similarProducts
    });
  } catch (err) {
    console.error("Product detail error:", err);
    res.status(500).json({ error: 'Failed to fetch product details' });
  }
});

// Add new product (Farmer only)
router.post('/', authenticateToken, requireRole('farmer'), (req, res) => {
  try {
    const {
      product_name,
      category_id,
      description,
      image_url,
      price,
      indicative_market_price,
      unit,
      available_quantity,
      minimum_order_quantity,
      bulk_discount_pct,
      bulk_min_qty,
      harvest_date,
      is_organic
    } = req.body;

    // Strict validation
    if (!product_name || !category_id || !price || !unit || available_quantity === undefined) {
      return res.status(400).json({ error: 'Product name, category, price, unit, and available quantity are required.' });
    }

    if (Number(price) <= 0) {
      return res.status(400).json({ error: 'Price must be a valid positive amount.' });
    }

    if (Number(available_quantity) < 0) {
      return res.status(400).json({ error: 'Available quantity cannot be negative.' });
    }

    const moq = minimum_order_quantity ? Number(minimum_order_quantity) : 1;
    if (moq <= 0) {
      return res.status(400).json({ error: 'Minimum order quantity must be greater than zero.' });
    }

    const productId = 'prod-' + uuidv4().slice(0, 8);
    const defaultImage = image_url || 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=600&auto=format&fit=crop&q=80';

    run(`
      INSERT INTO products (
        id, farmer_id, product_name, category_id, description, image_url,
        price, indicative_market_price, unit, available_quantity, minimum_order_quantity,
        bulk_discount_pct, bulk_min_qty, harvest_date, availability_status, is_organic
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?)
    `, [
      productId,
      req.user.id,
      product_name.trim(),
      category_id,
      description || '',
      defaultImage,
      Number(price),
      indicative_market_price ? Number(indicative_market_price) : Math.round(Number(price) * 1.25),
      unit.trim(),
      Number(available_quantity),
      moq,
      bulk_discount_pct ? Number(bulk_discount_pct) : 0,
      bulk_min_qty ? Number(bulk_min_qty) : 0,
      harvest_date || 'Harvested recently',
      is_organic ? 1 : 0
    ]);

    recordAudit(req.user.id, 'PRODUCT_CREATED', { productId, product_name, price });

    const createdProduct = get("SELECT * FROM products WHERE id = ?", [productId]);
    res.status(201).json({
      message: 'Product listed successfully!',
      product: createdProduct
    });
  } catch (err) {
    console.error("Create product error:", err);
    res.status(500).json({ error: 'Failed to create product listing' });
  }
});

// Update product (Farmer owner or Admin)
router.put('/:id', authenticateToken, (req, res) => {
  try {
    const product = get("SELECT * FROM products WHERE id = ?", [req.params.id]);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (req.user.role !== 'admin' && product.farmer_id !== req.user.id) {
      return res.status(403).json({ error: 'You are not authorized to update this listing' });
    }

    const {
      product_name,
      category_id,
      description,
      image_url,
      price,
      indicative_market_price,
      unit,
      available_quantity,
      minimum_order_quantity,
      bulk_discount_pct,
      bulk_min_qty,
      harvest_date,
      availability_status,
      is_organic
    } = req.body;

    if (price !== undefined && Number(price) <= 0) {
      return res.status(400).json({ error: 'Price must be positive' });
    }

    if (available_quantity !== undefined && Number(available_quantity) < 0) {
      return res.status(400).json({ error: 'Quantity cannot be negative' });
    }

    run(`
      UPDATE products SET
        product_name = COALESCE(?, product_name),
        category_id = COALESCE(?, category_id),
        description = COALESCE(?, description),
        image_url = COALESCE(?, image_url),
        price = COALESCE(?, price),
        indicative_market_price = COALESCE(?, indicative_market_price),
        unit = COALESCE(?, unit),
        available_quantity = COALESCE(?, available_quantity),
        minimum_order_quantity = COALESCE(?, minimum_order_quantity),
        bulk_discount_pct = COALESCE(?, bulk_discount_pct),
        bulk_min_qty = COALESCE(?, bulk_min_qty),
        harvest_date = COALESCE(?, harvest_date),
        availability_status = COALESCE(?, availability_status),
        is_organic = COALESCE(?, is_organic)
      WHERE id = ?
    `, [
      product_name,
      category_id,
      description,
      image_url,
      price !== undefined ? Number(price) : null,
      indicative_market_price !== undefined ? Number(indicative_market_price) : null,
      unit,
      available_quantity !== undefined ? Number(available_quantity) : null,
      minimum_order_quantity !== undefined ? Number(minimum_order_quantity) : null,
      bulk_discount_pct !== undefined ? Number(bulk_discount_pct) : null,
      bulk_min_qty !== undefined ? Number(bulk_min_qty) : null,
      harvest_date,
      availability_status,
      is_organic !== undefined ? (is_organic ? 1 : 0) : null,
      req.params.id
    ]);

    recordAudit(req.user.id, 'PRODUCT_UPDATED', { productId: req.params.id });

    const updated = get("SELECT * FROM products WHERE id = ?", [req.params.id]);
    res.json({ message: 'Product updated successfully', product: updated });
  } catch (err) {
    console.error("Update product error:", err);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// Delete product
router.delete('/:id', authenticateToken, (req, res) => {
  try {
    const product = get("SELECT * FROM products WHERE id = ?", [req.params.id]);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (req.user.role !== 'admin' && product.farmer_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized to delete this product' });
    }

    run("DELETE FROM products WHERE id = ?", [req.params.id]);
    recordAudit(req.user.id, 'PRODUCT_DELETED', { productId: req.params.id });

    res.json({ message: 'Product deleted successfully' });
  } catch (err) {
    console.error("Delete product error:", err);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

module.exports = router;

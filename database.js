const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', '..', 'farmdirect.db');

let dbInstance = null;
let SQL_MODULE = null;

async function getDB() {
  if (dbInstance) return dbInstance;

  SQL_MODULE = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    dbInstance = new SQL_MODULE.Database(fileBuffer);
  } else {
    dbInstance = new SQL_MODULE.Database();
  }

  // Enable foreign keys
  dbInstance.run("PRAGMA foreign_keys = ON;");
  initSchema(dbInstance);
  saveDB();

  return dbInstance;
}

function saveDB() {
  if (!dbInstance) return;
  try {
    const data = dbInstance.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (err) {
    console.error("Error persisting database to disk:", err);
  }
}

function initSchema(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      phone TEXT,
      role TEXT NOT NULL CHECK(role IN ('farmer', 'buyer', 'admin', 'delivery_partner')),
      account_status TEXT DEFAULT 'active' CHECK(account_status IN ('active', 'suspended', 'pending_approval')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS farmer_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      farm_name TEXT NOT NULL,
      farm_location TEXT NOT NULL,
      farm_description TEXT,
      verification_status TEXT DEFAULT 'verified' CHECK(verification_status IN ('verified', 'pending', 'rejected')),
      rating REAL DEFAULT 4.8,
      reviews_count INTEGER DEFAULT 0,
      total_sales REAL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS buyer_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      buyer_type TEXT NOT NULL CHECK(buyer_type IN ('consumer', 'restaurant', 'retailer', 'wholesaler')),
      business_name TEXT,
      delivery_address TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS delivery_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      vehicle_type TEXT DEFAULT 'Motor Van',
      vehicle_number TEXT,
      operating_area TEXT,
      availability_status TEXT DEFAULT 'available' CHECK(availability_status IN ('available', 'busy', 'offline')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      category_name TEXT UNIQUE NOT NULL,
      description TEXT,
      icon TEXT
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      farmer_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      category_id TEXT NOT NULL,
      description TEXT,
      image_url TEXT,
      price REAL NOT NULL CHECK(price > 0),
      indicative_market_price REAL,
      unit TEXT NOT NULL,
      available_quantity REAL NOT NULL CHECK(available_quantity >= 0),
      minimum_order_quantity REAL DEFAULT 1 CHECK(minimum_order_quantity > 0),
      bulk_discount_pct REAL DEFAULT 0,
      bulk_min_qty REAL DEFAULT 0,
      harvest_date TEXT,
      availability_status TEXT DEFAULT 'available' CHECK(availability_status IN ('available', 'out_of_stock', 'harvesting_soon')),
      is_organic INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (farmer_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      buyer_id TEXT NOT NULL,
      farmer_id TEXT NOT NULL,
      order_status TEXT DEFAULT 'pending_confirmation' CHECK(order_status IN ('pending_confirmation', 'confirmed', 'preparing', 'ready_for_pickup', 'shipped', 'delivered', 'cancelled')),
      subtotal REAL NOT NULL,
      delivery_fee REAL DEFAULT 0,
      platform_fee REAL DEFAULT 0,
      total_amount REAL NOT NULL,
      payment_status TEXT DEFAULT 'pending' CHECK(payment_status IN ('pending', 'completed', 'failed', 'refunded')),
      delivery_type TEXT DEFAULT 'home_delivery' CHECK(delivery_type IN ('home_delivery', 'farmer_pickup')),
      delivery_address TEXT,
      delivery_partner_id TEXT,
      cancel_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (buyer_id) REFERENCES users(id),
      FOREIGN KEY (farmer_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      farmer_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      unit TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      item_total REAL NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      transaction_reference TEXT UNIQUE NOT NULL,
      payment_status TEXT NOT NULL,
      amount REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS deliveries (
      id TEXT PRIMARY KEY,
      order_id TEXT UNIQUE NOT NULL,
      delivery_partner_id TEXT,
      pickup_status TEXT DEFAULT 'pending',
      delivery_status TEXT DEFAULT 'assigned' CHECK(delivery_status IN ('assigned', 'picked_up', 'in_transit', 'delivered', 'failed')),
      pickup_address TEXT,
      dropoff_address TEXT,
      estimated_delivery TEXT,
      delivered_at DATETIME,
      tracking_notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      buyer_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      review_text TEXT,
      farmer_response TEXT,
      reported INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (buyer_id) REFERENCES users(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL,
      receiver_id TEXT NOT NULL,
      product_id TEXT,
      order_id TEXT,
      message_type TEXT DEFAULT 'inquiry',
      proposed_price REAL,
      message_text TEXT NOT NULL,
      read_status INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sender_id) REFERENCES users(id),
      FOREIGN KEY (receiver_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      notification_type TEXT NOT NULL,
      message TEXT NOT NULL,
      link TEXT,
      read_status INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS disputes (
      id TEXT PRIMARY KEY,
      reported_by TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT DEFAULT 'open' CHECK(status IN ('open', 'resolved', 'dismissed')),
      resolution_notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (reported_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      action TEXT NOT NULL,
      details TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// Database helper functions with parameter binding
function query(sql, params = []) {
  if (!dbInstance) throw new Error("Database not initialized yet.");
  const stmt = dbInstance.prepare(sql);
  if (params && params.length > 0) {
    stmt.bind(params);
  }
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function get(sql, params = []) {
  const rows = query(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function run(sql, params = []) {
  if (!dbInstance) throw new Error("Database not initialized yet.");
  const stmt = dbInstance.prepare(sql);
  if (params && params.length > 0) {
    stmt.bind(params);
  }
  stmt.step();
  stmt.free();
  saveDB();
  return true;
}

function runStatements(sqlStatements) {
  if (!dbInstance) throw new Error("Database not initialized yet.");
  dbInstance.run(sqlStatements);
  saveDB();
}

module.exports = {
  getDB,
  saveDB,
  query,
  get,
  run,
  runStatements
};

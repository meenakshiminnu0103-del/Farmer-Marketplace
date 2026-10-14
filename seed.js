const bcrypt = require('bcryptjs');
const { getDB, query, get, run, saveDB } = require('./database');

async function seedData() {
  await getDB();
  
  // Check if already seeded
  const userCount = get("SELECT COUNT(*) as cnt FROM users");
  if (userCount && userCount.cnt > 0) {
    console.log("Database already seeded with " + userCount.cnt + " users.");
    return;
  }

  console.log("Seeding fresh demonstration data for FarmDirect...");
  const salt = bcrypt.genSaltSync(10);
  const commonPasswordHash = bcrypt.hashSync("password123", salt);

  // 1. Categories
  const categories = [
    { id: 'cat-veg', name: 'Fresh Vegetables', desc: 'Farm-fresh leafy greens, root vegetables, gourds, and peppers', icon: 'Carrot' },
    { id: 'cat-fruit', name: 'Seasonal Fruits', desc: 'Naturally ripened mangoes, bananas, citrus, and seasonal picks', icon: 'Apple' },
    { id: 'cat-grain', name: 'Grains & Cereals', desc: 'Direct-from-field paddy, wheat, millets, and unpolished rice', icon: 'Wheat' },
    { id: 'cat-pulse', name: 'Pulses & Lentils', desc: 'Protein-rich lentils, chickpeas, moong dal, and pigeon peas', icon: 'Bean' },
    { id: 'cat-spice', name: 'Spices & Condiments', desc: 'Handpicked chillies, raw turmeric, coriander, and native spices', icon: 'Flame' },
    { id: 'cat-dairy', name: 'Organic & Farm Specialty', desc: 'Pure cold-pressed oils, raw honey, and farm-processed staples', icon: 'Droplets' }
  ];

  for (const c of categories) {
    run("INSERT INTO categories (id, category_name, description, icon) VALUES (?, ?, ?, ?)", [c.id, c.name, c.desc, c.icon]);
  }

  // 2. Users (Admin, Farmers, Buyers, Delivery Partners)
  const users = [
    // Admin
    { id: 'usr-admin', name: 'Platform Admin', email: 'admin@farmdirect.com', phone: '+91 98765 00001', role: 'admin' },
    
    // Farmers
    { id: 'usr-farmer-1', name: 'Lakshmi Devi', email: 'lakshmi@organicfarms.in', phone: '+91 98480 12345', role: 'farmer' },
    { id: 'usr-farmer-2', name: 'Rajesh Patel', email: 'rajesh@greenvalley.in', phone: '+91 94220 54321', role: 'farmer' },
    { id: 'usr-farmer-3', name: 'Ramesh Kumar', email: 'ramesh@sunriseargo.in', phone: '+91 99890 67890', role: 'farmer' },
    { id: 'usr-farmer-4', name: 'Anand Singh', email: 'anand@villageharvest.in', phone: '+91 97410 98765', role: 'farmer' },
    
    // Buyers (representing Household, Restaurant, Retailer, Wholesaler)
    { id: 'usr-buyer-consumer', name: 'Priya Sharma', email: 'priya@gmail.com', phone: '+91 98110 11223', role: 'buyer' },
    { id: 'usr-buyer-restaurant', name: 'Chef Vikram (Spice Route Bistro)', email: 'orders@spiceroute.in', phone: '+91 98450 33445', role: 'buyer' },
    { id: 'usr-buyer-retailer', name: 'Amit Gupta (FreshBazaar Mart)', email: 'procure@freshbazaar.in', phone: '+91 93220 77889', role: 'buyer' },
    { id: 'usr-buyer-wholesaler', name: 'R. K. Agarwal (Southern Agro Wholesale)', email: 'trade@southernagro.com', phone: '+91 94440 99001', role: 'buyer' },
    
    // Delivery Partner
    { id: 'usr-delivery-1', name: 'Suresh Varma', email: 'suresh@ecokisan.in', phone: '+91 99120 44556', role: 'delivery_partner' },
    { id: 'usr-delivery-2', name: 'Kiran Reddy', email: 'kiran@fastagro.in', phone: '+91 98660 77881', role: 'delivery_partner' }
  ];

  for (const u of users) {
    run(
      "INSERT INTO users (id, full_name, email, password_hash, phone, role, account_status) VALUES (?, ?, ?, ?, ?, ?, 'active')",
      [u.id, u.name, u.email, commonPasswordHash, u.phone, u.role]
    );
  }

  // 3. Farmer Profiles
  const farmerProfiles = [
    {
      id: 'prof-f1',
      userId: 'usr-farmer-1',
      name: 'Lakshmi Organic Farm',
      loc: 'Warangal Rural, Telangana',
      desc: 'Certified chemical-free natural farming since 2014. We specialize in desi heirloom tomatoes, chemical-free leafy greens, and native turmeric.',
      rating: 4.9,
      reviews: 38,
      sales: 124500
    },
    {
      id: 'prof-f2',
      userId: 'usr-farmer-2',
      name: 'Green Valley Farms',
      loc: 'Nashik, Maharashtra',
      desc: 'Family-run horticulture farm producing export-grade Nashik red onions, table grapes, and sweet capsicum with drip-irrigation precision.',
      rating: 4.8,
      reviews: 52,
      sales: 248900
    },
    {
      id: 'prof-f3',
      userId: 'usr-farmer-3',
      name: 'Sunrise Agricultural Farm',
      loc: 'Guntur & Krishna Delta, Andhra Pradesh',
      desc: 'Prime Krishna river basin farm growing authentic Sona Masoori raw rice and world-famous Guntur spicy red and green chillies.',
      rating: 4.7,
      reviews: 29,
      sales: 185000
    },
    {
      id: 'prof-f4',
      userId: 'usr-farmer-4',
      name: 'Village Harvest Collective',
      loc: 'Mandya, Karnataka',
      desc: 'A cooperative of 18 smallholder farmers cultivating traditional potatoes, high-protein pulses, and naturally processed millets.',
      rating: 4.9,
      reviews: 44,
      sales: 196300
    }
  ];

  for (const fp of farmerProfiles) {
    run(
      "INSERT INTO farmer_profiles (id, user_id, farm_name, farm_location, farm_description, verification_status, rating, reviews_count, total_sales) VALUES (?, ?, ?, ?, ?, 'verified', ?, ?, ?)",
      [fp.id, fp.userId, fp.name, fp.loc, fp.desc, fp.rating, fp.reviews, fp.sales]
    );
  }

  // 4. Buyer Profiles
  const buyerProfiles = [
    { id: 'prof-b1', userId: 'usr-buyer-consumer', type: 'consumer', name: 'Sharma Residence', addr: 'Flat 402, Green Meadows, Madhapur, Hyderabad, TS - 500081' },
    { id: 'prof-b2', userId: 'usr-buyer-restaurant', type: 'restaurant', name: 'Spice Route Bistro & Catering', addr: '12th Main, 100ft Road, Indiranagar, Bengaluru, KA - 560038' },
    { id: 'prof-b3', userId: 'usr-buyer-retailer', type: 'retailer', name: 'FreshBazaar Grocery Chain', addr: 'Shop 14-16, Commercial Complex, Kothrud, Pune, MH - 411038' },
    { id: 'prof-b4', userId: 'usr-buyer-wholesaler', type: 'wholesaler', name: 'Southern Agro Commodities', addr: 'Godown 8, APMC Market Yard, Koyambedu, Chennai, TN - 600092' }
  ];

  for (const bp of buyerProfiles) {
    run(
      "INSERT INTO buyer_profiles (id, user_id, buyer_type, business_name, delivery_address) VALUES (?, ?, ?, ?, ?)",
      [bp.id, bp.userId, bp.type, bp.name, bp.addr]
    );
  }

  // 5. Delivery Profiles
  run("INSERT INTO delivery_profiles (id, user_id, vehicle_type, vehicle_number, operating_area, availability_status) VALUES ('dp-1', 'usr-delivery-1', 'Refrigerated Mini Truck (Tata Ace)', 'TS-03-FA-9021', 'Warangal - Hyderabad Corridor', 'available')");
  run("INSERT INTO delivery_profiles (id, user_id, vehicle_type, vehicle_number, operating_area, availability_status) VALUES ('dp-2', 'usr-delivery-2', 'Cargo EV 3-Wheeler (Piaggio)', 'KA-05-EV-4412', 'Bengaluru Urban & Peri-Urban', 'available')");

  // 6. Products (Realistic farm crops from sample data)
  const products = [
    {
      id: 'prod-1',
      farmer_id: 'usr-farmer-1',
      name: 'Organic Country Tomatoes (Nattu Thakkali)',
      cat: 'cat-veg',
      desc: 'Naturally ripened, tangy desi variety harvested fresh early morning. Grown using Jeevamrutha and zero synthetic pesticides. Great for curries, salads, and soups.',
      img: 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=600&auto=format&fit=crop&q=80',
      price: 30,
      indicative: 38,
      unit: 'kg',
      qty: 450,
      moq: 5,
      bulk_pct: 10,
      bulk_min: 50,
      harvest: 'Harvested yesterday',
      is_organic: 1
    },
    {
      id: 'prod-2',
      farmer_id: 'usr-farmer-2',
      name: 'Nashik Grade-A Red Onions',
      cat: 'cat-veg',
      desc: 'Medium-to-large size, sun-cured Nashik onions with tight papery skins. Exceptional shelf life (up to 45 days in cool storage). High pungency and dry matter.',
      img: 'https://images.unsplash.com/photo-1618512496248-a07fe83aa8cb?w=600&auto=format&fit=crop&q=80',
      price: 25,
      indicative: 32,
      unit: 'kg',
      qty: 1800,
      moq: 10,
      bulk_pct: 8,
      bulk_min: 100,
      harvest: 'Harvested 3 days ago',
      is_organic: 0
    },
    {
      id: 'prod-3',
      farmer_id: 'usr-farmer-4',
      name: 'Mandya Farm Fresh Potatoes',
      cat: 'cat-veg',
      desc: 'Clean, thin-skinned table potatoes directly from Mandya soil. Low moisture, ideal for crisp frying, cooking, and institutional kitchens.',
      img: 'https://images.unsplash.com/photo-1518977676601-b53f82aba655?w=600&auto=format&fit=crop&q=80',
      price: 28,
      indicative: 34,
      unit: 'kg',
      qty: 1200,
      moq: 10,
      bulk_pct: 7,
      bulk_min: 75,
      harvest: 'Harvested 2 days ago',
      is_organic: 1
    },
    {
      id: 'prod-4',
      farmer_id: 'usr-farmer-2',
      name: 'Devgad Alphonso Mangoes (GI Tagged)',
      cat: 'cat-fruit',
      desc: 'Grass-ripened, golden-hued Alphonso mangoes with rich saffron pulp and unforgettable sweet aroma. Certified zero carbide usage.',
      img: 'https://images.unsplash.com/photo-1553279768-865429fa0078?w=600&auto=format&fit=crop&q=80',
      price: 70,
      indicative: 95,
      unit: 'kg',
      qty: 320,
      moq: 3,
      bulk_pct: 12,
      bulk_min: 20,
      harvest: 'Handpicked this morning',
      is_organic: 1
    },
    {
      id: 'prod-5',
      farmer_id: 'usr-farmer-3',
      name: 'Sona Masoori Raw Rice (Aged 12 Months)',
      cat: 'cat-grain',
      desc: 'Delicate, aromatic medium-grain rice cultivated in Krishna delta alluvial soil. Naturally aged for minimum 12 months for non-sticky fluffy cooking.',
      img: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=600&auto=format&fit=crop&q=80',
      price: 55,
      indicative: 68,
      unit: 'kg',
      qty: 3500,
      moq: 25,
      bulk_pct: 10,
      bulk_min: 250,
      harvest: 'Recent milling / aged crop',
      is_organic: 0
    },
    {
      id: 'prod-6',
      farmer_id: 'usr-farmer-3',
      name: 'Guntur G4 Spicy Green Chillies',
      cat: 'cat-spice',
      desc: 'Vibrant dark green, highly pungent G4 chillies known for authentic Indian cooking spice. Hand-sorted and stem-retained for prolonged freshness.',
      img: 'https://images.unsplash.com/photo-1597362925123-77861d3fbac7?w=600&auto=format&fit=crop&q=80',
      price: 40,
      indicative: 52,
      unit: 'kg',
      qty: 240,
      moq: 2,
      bulk_pct: 10,
      bulk_min: 30,
      harvest: 'Harvested yesterday',
      is_organic: 1
    },
    {
      id: 'prod-7',
      farmer_id: 'usr-farmer-2',
      name: 'Sweet Bell Peppers / Green Capsicum',
      cat: 'cat-veg',
      desc: 'Thick-walled, crisp polyhouse capsicums with vibrant green color and tender crunch. Popular with restaurants and salad bars.',
      img: 'https://images.unsplash.com/photo-1563565375-f3fdfdbefa83?w=600&auto=format&fit=crop&q=80',
      price: 45,
      indicative: 58,
      unit: 'kg',
      qty: 180,
      moq: 5,
      bulk_pct: 8,
      bulk_min: 40,
      harvest: 'Harvested yesterday',
      is_organic: 0
    },
    {
      id: 'prod-8',
      farmer_id: 'usr-farmer-1',
      name: 'Fresh Tender Palak (Spinach Bunches)',
      cat: 'cat-veg',
      desc: 'Crisp, nutrient-dense organic spinach harvested with tender stems. Washed with clean borewell water and bundled in jute strings.',
      img: 'https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=600&auto=format&fit=crop&q=80',
      price: 20,
      indicative: 28,
      unit: 'bunch',
      qty: 90,
      moq: 5,
      bulk_pct: 15,
      bulk_min: 30,
      harvest: 'Harvested 6 hours ago',
      is_organic: 1
    },
    {
      id: 'prod-9',
      farmer_id: 'usr-farmer-1',
      name: 'Pure Organic Lakadong Turmeric (High Curcumin)',
      cat: 'cat-spice',
      desc: 'Sun-dried raw turmeric rhizomes testing over 7% curcumin content. Exceptional medicinal and culinary value directly from farm fields.',
      img: 'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?w=600&auto=format&fit=crop&q=80',
      price: 120,
      indicative: 160,
      unit: 'kg',
      qty: 500,
      moq: 2,
      bulk_pct: 12,
      bulk_min: 25,
      harvest: 'Sun-cured seasonal harvest',
      is_organic: 1
    },
    {
      id: 'prod-10',
      farmer_id: 'usr-farmer-4',
      name: 'Traditional Moong Dal (Split Green Gram)',
      cat: 'cat-pulse',
      desc: 'Unpolished, pesticide-free split moong dal retaining natural dietary fiber and rich earthy taste. Quick to cook and highly digestible.',
      img: 'https://images.unsplash.com/photo-1585994192701-f1a505c817ee?w=600&auto=format&fit=crop&q=80',
      price: 95,
      indicative: 125,
      unit: 'kg',
      qty: 650,
      moq: 5,
      bulk_pct: 10,
      bulk_min: 50,
      harvest: 'Recent harvest & cleaned',
      is_organic: 1
    }
  ];

  for (const p of products) {
    run(
      `INSERT INTO products (
        id, farmer_id, product_name, category_id, description, image_url,
        price, indicative_market_price, unit, available_quantity, minimum_order_quantity,
        bulk_discount_pct, bulk_min_qty, harvest_date, availability_status, is_organic
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?)`,
      [p.id, p.farmer_id, p.name, p.cat, p.desc, p.img, p.price, p.indicative, p.unit, p.qty, p.moq, p.bulk_pct, p.bulk_min, p.harvest, p.is_organic]
    );
  }

  // 7. Demonstration Orders & Tracking Records
  // Order 1: Completed order with review (from Priya Sharma)
  const order1Id = 'ord-1001';
  run(
    `INSERT INTO orders (
      id, buyer_id, farmer_id, order_status, subtotal, delivery_fee, platform_fee, total_amount,
      payment_status, delivery_type, delivery_address, delivery_partner_id, created_at
    ) VALUES (?, 'usr-buyer-consumer', 'usr-farmer-1', 'delivered', 300, 40, 10, 350, 'completed', 'home_delivery', 'Flat 402, Green Meadows, Madhapur, Hyderabad, TS - 500081', 'usr-delivery-1', datetime('now', '-3 days'))`,
    [order1Id]
  );

  run(
    `INSERT INTO order_items (id, order_id, product_id, farmer_id, product_name, unit, quantity, unit_price, item_total)
     VALUES ('item-1', ?, 'prod-1', 'usr-farmer-1', 'Organic Country Tomatoes (Nattu Thakkali)', 'kg', 10, 30, 300)`,
    [order1Id]
  );

  run(
    `INSERT INTO payments (id, order_id, payment_method, transaction_reference, payment_status, amount, created_at)
     VALUES ('pay-1001', ?, 'upi', 'UPI-TXN-9847291038', 'completed', 350, datetime('now', '-3 days'))`,
    [order1Id]
  );

  run(
    `INSERT INTO deliveries (id, order_id, delivery_partner_id, pickup_status, delivery_status, pickup_address, dropoff_address, estimated_delivery, delivered_at, tracking_notes)
     VALUES ('del-1001', ?, 'usr-delivery-1', 'picked_up', 'delivered', 'Lakshmi Organic Farm, Warangal Rural', 'Flat 402, Green Meadows, Madhapur, Hyderabad', 'Delivered 2 days ago', datetime('now', '-2 days'), 'Package delivered safely with temperature-controlled handling.')`,
    [order1Id]
  );

  // Review for Order 1
  run(
    `INSERT INTO reviews (id, buyer_id, product_id, order_id, rating, review_text, farmer_response, created_at)
     VALUES ('rev-1', 'usr-buyer-consumer', 'prod-1', ?, 5, 'Exceptional sweetness and freshness! You can instantly tell these are real farm tomatoes without chemicals. Delivery was fast and well-crated.', 'Thank you so much Priya ji! We harvest tomatoes at sunrise and pack them immediately for direct delivery.', datetime('now', '-2 days'))`,
    [order1Id]
  );

  // Order 2: Active In-Transit Order (from Spice Route Bistro)
  const order2Id = 'ord-1002';
  run(
    `INSERT INTO orders (
      id, buyer_id, farmer_id, order_status, subtotal, delivery_fee, platform_fee, total_amount,
      payment_status, delivery_type, delivery_address, delivery_partner_id, created_at
    ) VALUES (?, 'usr-buyer-restaurant', 'usr-farmer-2', 'shipped', 2500, 150, 50, 2700, 'completed', 'home_delivery', '12th Main, 100ft Road, Indiranagar, Bengaluru, KA', 'usr-delivery-2', datetime('now', '-1 days'))`,
    [order2Id]
  );

  run(
    `INSERT INTO order_items (id, order_id, product_id, farmer_id, product_name, unit, quantity, unit_price, item_total)
     VALUES ('item-2', ?, 'prod-2', 'usr-farmer-2', 'Nashik Grade-A Red Onions', 'kg', 100, 25, 2500)`,
    [order2Id]
  );

  run(
    `INSERT INTO payments (id, order_id, payment_method, transaction_reference, payment_status, amount, created_at)
     VALUES ('pay-1002', ?, 'netbanking', 'NEFT-AGRO-7729104', 'completed', 2700, datetime('now', '-1 days'))`,
    [order2Id]
  );

  run(
    `INSERT INTO deliveries (id, order_id, delivery_partner_id, pickup_status, delivery_status, pickup_address, dropoff_address, estimated_delivery, tracking_notes)
     VALUES ('del-1002', ?, 'usr-delivery-2', 'picked_up', 'in_transit', 'Green Valley Farms, Nashik', '12th Main, 100ft Road, Indiranagar, Bengaluru', 'Estimated Today by 5:00 PM', 'Consignment loaded and transit underway via NH 48.')`,
    [order2Id]
  );

  // Order 3: Pending Confirmation (from FreshBazaar Mart)
  const order3Id = 'ord-1003';
  run(
    `INSERT INTO orders (
      id, buyer_id, farmer_id, order_status, subtotal, delivery_fee, platform_fee, total_amount,
      payment_status, delivery_type, delivery_address, created_at
    ) VALUES (?, 'usr-buyer-retailer', 'usr-farmer-3', 'pending_confirmation', 2750, 200, 50, 3000, 'completed', 'home_delivery', 'Shop 14-16, Commercial Complex, Kothrud, Pune', datetime('now', '-3 hours'))`,
    [order3Id]
  );

  run(
    `INSERT INTO order_items (id, order_id, product_id, farmer_id, product_name, unit, quantity, unit_price, item_total)
     VALUES ('item-3', ?, 'prod-5', 'usr-farmer-3', 'Sona Masoori Raw Rice (Aged 12 Months)', 'kg', 50, 55, 2750)`,
    [order3Id]
  );

  run(
    `INSERT INTO payments (id, order_id, payment_method, transaction_reference, payment_status, amount, created_at)
     VALUES ('pay-1003', ?, 'card', 'CARD-TXN-11928374', 'completed', 3000, datetime('now', '-3 hours'))`,
    [order3Id]
  );

  run(
    `INSERT INTO deliveries (id, order_id, pickup_status, delivery_status, pickup_address, dropoff_address, estimated_delivery, tracking_notes)
     VALUES ('del-1003', ?, 'pending', 'assigned', 'Sunrise Agricultural Farm, Krishna Delta, AP', 'Shop 14-16, Commercial Complex, Kothrud, Pune', 'Estimated in 2 days', 'Order awaiting farmer harvest confirmation.')`,
    [order3Id]
  );

  // 8. Sample Enquiries / Messages
  run(
    `INSERT INTO messages (id, sender_id, receiver_id, product_id, order_id, message_type, proposed_price, message_text, read_status, created_at)
     VALUES ('msg-1', 'usr-buyer-restaurant', 'usr-farmer-1', 'prod-1', NULL, 'negotiation', 27, 'Namaste Lakshmi ji! We require 120 kg of tomatoes every Tuesday and Friday for our Indiranagar restaurant. Can you support this at ₹27/kg for regular bi-weekly supply?', 1, datetime('now', '-1 days'))`
  );

  run(
    `INSERT INTO messages (id, sender_id, receiver_id, product_id, order_id, message_type, proposed_price, message_text, read_status, created_at)
     VALUES ('msg-2', 'usr-farmer-1', 'usr-buyer-restaurant', 'prod-1', NULL, 'negotiation', 28, 'Namaste Vikram ji! Yes, we can commit to 120 kg bi-weekly. We can offer ₹28/kg with crates included and same-day morning harvest dispatch.', 0, datetime('now', '-18 hours'))`
  );

  run(
    `INSERT INTO messages (id, sender_id, receiver_id, product_id, order_id, message_type, proposed_price, message_text, read_status, created_at)
     VALUES ('msg-3', 'usr-buyer-wholesaler', 'usr-farmer-3', 'prod-5', NULL, 'inquiry', NULL, 'Hello Ramesh ji, do you have 500 bags (25kg each) of aged Sona Masoori available for wholesale pickup next week?', 0, datetime('now', '-5 hours'))`
  );

  // 9. Notifications
  const sampleNotifications = [
    { uid: 'usr-farmer-1', type: 'order', msg: 'New order #ORD-1001 was delivered successfully to Priya Sharma.', link: '/farmer/orders' },
    { uid: 'usr-farmer-3', type: 'order', msg: 'New bulk order #ORD-1003 received for 50kg Sona Masoori Rice. Please confirm.', link: '/farmer/orders' },
    { uid: 'usr-buyer-consumer', type: 'delivery', msg: 'Your fresh produce from Lakshmi Organic Farm has been delivered!', link: '/buyer/orders' },
    { uid: 'usr-buyer-restaurant', type: 'delivery', msg: 'Order #ORD-1002 is out for delivery with partner Suresh Varma.', link: '/buyer/orders' },
    { uid: 'usr-delivery-1', type: 'delivery', msg: 'New delivery assignment available in Warangal-Hyderabad region.', link: '/delivery' },
    { uid: 'usr-admin', type: 'system', msg: 'Daily marketplace health report generated: 10 active products, ₹6,050 trading volume.', link: '/admin' }
  ];

  for (let i = 0; i < sampleNotifications.length; i++) {
    const n = sampleNotifications[i];
    run(
      "INSERT INTO notifications (id, user_id, notification_type, message, link, read_status, created_at) VALUES (?, ?, ?, ?, ?, 0, datetime('now', '-' || ? || ' hours'))",
      ['notif-' + (i + 1), n.uid, n.type, n.msg, n.link, i * 2]
    );
  }

  saveDB();
  console.log("FarmDirect sample database successfully initialized and seeded!");
}

module.exports = { seedData };

if (require.main === module) {
  seedData()
    .then(() => console.log("Seeding complete!"))
    .catch(console.error);
}

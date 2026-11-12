/**
 * ПК-МАСТЕР — Backend API (Express + PostgreSQL 18)
 * Run: cd backend && npm install && node server.js
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json({ limit: '200kb' }));

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'pcmaster',
});

// ---------- utils ----------
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function getSessionId(req) {
  return String(
    (req.query && req.query.sessionId) ||
    (req.body && req.body.sessionId) ||
    req.headers['x-session-id'] ||
    ''
  ).trim();
}

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[«»"'']/g, '')
    .replace(/[^a-zа-яё0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  if (!stored || !String(stored).includes(':')) return false;
  const [salt, hash] = String(stored).split(':');
  try {
    const buf = crypto.scryptSync(String(password), salt, 64);
    return crypto.timingSafeEqual(buf, Buffer.from(hash, 'hex'));
  } catch (_) {
    return false;
  }
}

// ---------- cart helpers ----------
async function getOrCreateCart(sessionId, userId) {
  if (!sessionId) throw Object.assign(new Error('sessionId обязателен'), { status: 400 });
  const found = await pool.query(
    'SELECT id, user_id FROM carts WHERE session_id = $1',
    [sessionId]
  );
  if (found.rows.length) {
    const cart = found.rows[0];
    if (userId && !cart.user_id) {
      await pool.query(
        'UPDATE carts SET user_id = $1, updated_at = now() WHERE id = $2',
        [userId, cart.id]
      );
    }
    return cart.id;
  }
  const created = await pool.query(
    'INSERT INTO carts (session_id, user_id) VALUES ($1, $2) RETURNING id',
    [sessionId, userId || null]
  );
  return created.rows[0].id;
}

async function getCartPayload(cartId) {
  const r = await pool.query(
    `SELECT
        ci.id,
        ci.qty,
        ci.price_snapshot,
        p.id   AS product_id,
        p.name AS product_name,
        p.slug AS product_slug,
        p.price AS current_price,
        p.image_url,
        p.stock
     FROM cart_items ci
     JOIN products p ON p.id = ci.product_id
     WHERE ci.cart_id = $1
     ORDER BY ci.id ASC`,
    [cartId]
  );

  const items = r.rows.map((row) => {
    const price = Number(row.current_price);
    const qty = Number(row.qty);
    return {
      id: row.id,                 // cart_item id (use for DELETE/PATCH)
      productId: row.product_id,
      name: row.product_name,
      slug: row.product_slug,
      price,
      qty,
      stock: Number(row.stock),
      imageUrl: row.image_url,
      lineTotal: Math.round(price * qty * 100) / 100,
    };
  });

  const total = Math.round(items.reduce((sum, i) => sum + i.price * i.qty, 0) * 100) / 100;
  const count = items.reduce((sum, i) => sum + i.qty, 0);

  return { cartId, items, total, count };
}

async function resolveProductId(body) {
  const b = body || {};
  let productId = Number.parseInt(b.productId, 10);
  if (Number.isInteger(productId) && productId > 0) return productId;

  const slug = b.productSlug || b.slug;
  if (slug) {
    const r = await pool.query(
      'SELECT id FROM products WHERE slug = $1 AND is_active = TRUE',
      [slugify(slug)]
    );
    if (r.rows.length) return Number(r.rows[0].id);
  }

  const name = String(b.productName || b.name || '').trim();
  if (name) {
    const r = await pool.query(
      'SELECT id FROM products WHERE lower(name) = lower($1) AND is_active = TRUE LIMIT 1',
      [name]
    );
    if (r.rows.length) return Number(r.rows[0].id);
  }
  return null;
}

// ---------- routes ----------
app.get('/health', asyncHandler(async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true });
}));

// GET /api/products — fetch all products (DB-driven catalog)
app.get('/api/products', asyncHandler(async (req, res) => {
  const r = await pool.query(
    `SELECT p.id, p.name, p.slug, p.price, p.image_url, p.description, p.stock, p.is_active,
            c.name AS category_name, c.slug AS category_slug
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.is_active = TRUE
      ORDER BY p.id ASC`
  );
  res.json(r.rows);
}));

// GET /api/products/:idOrSlug — fetch single product with specs
app.get('/api/products/:idOrSlug', asyncHandler(async (req, res) => {
  const key = String(req.params.idOrSlug || '').trim();
  const isId = /^\d+$/.test(key);

  const r = await pool.query(
    `SELECT p.id, p.name, p.slug, p.price, p.image_url, p.description, p.stock, p.is_active,
            c.name AS category_name, c.slug AS category_slug
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${isId ? 'p.id = $1' : 'p.slug = $1'} AND p.is_active = TRUE
      LIMIT 1`,
    [isId ? Number(key) : key]
  );
  if (!r.rows.length) return res.status(404).json({ error: 'Товар не найден' });

  const product = r.rows[0];
  let specs = [];
  try {
    const s = await pool.query(
      `SELECT spec_name AS name, spec_value AS value
         FROM product_specs
        WHERE product_id = $1
        ORDER BY sort_order ASC, id ASC`,
      [product.id]
    );
    specs = s.rows;
  } catch (_) {
    // product_specs table may not exist — fallback to empty
    specs = [];
  }

  // fallback specs from description/category if none in DB
  if (!specs.length) {
    if (product.category_name) specs.push({ name: 'Категория', value: product.category_name });
    if (product.stock != null) specs.push({ name: 'В наличии', value: String(product.stock) + ' шт.' });
  }

  res.json({ ...product, specs });
}));

// GET /api/cart — fetch current user's cart items and total sum
app.get('/api/cart', asyncHandler(async (req, res) => {
  const sessionId = getSessionId(req);
  if (!sessionId) return res.status(400).json({ error: 'sessionId обязателен' });
  const userId = req.query.userId || null;
  const cartId = await getOrCreateCart(sessionId, userId);
  const payload = await getCartPayload(cartId);
  res.json(payload);
}));

// POST /api/cart — add a product to the user's cart (or update quantity)
app.post('/api/cart', asyncHandler(async (req, res) => {
  const sessionId = getSessionId(req);
  if (!sessionId) return res.status(400).json({ error: 'sessionId обязателен' });

  const qtyToAdd = Math.max(1, Number.parseInt((req.body && req.body.qty) || 1, 10) || 1);
  const userId = (req.body && req.body.userId) || null;
  const productId = await resolveProductId(req.body);
  if (!productId) return res.status(400).json({ error: 'Не указан товар (productId или productSlug)' });

  const productRes = await pool.query(
    'SELECT id, name, price, stock, is_active FROM products WHERE id = $1',
    [productId]
  );
  if (!productRes.rows.length || !productRes.rows[0].is_active) {
    return res.status(404).json({ error: 'Товар не найден' });
  }
  const product = productRes.rows[0];
  const stock = Number(product.stock);

  const cartId = await getOrCreateCart(sessionId, userId);

  const existing = await pool.query(
    'SELECT id, qty FROM cart_items WHERE cart_id = $1 AND product_id = $2',
    [cartId, productId]
  );

  if (existing.rows.length) {
    const currentQty = Number(existing.rows[0].qty);
    const newQty = currentQty + qtyToAdd;
    if (newQty > stock) {
      return res.status(400).json({ error: `На складе осталось ${stock} шт. (в корзине уже ${currentQty})` });
    }
    await pool.query(
      'UPDATE cart_items SET qty = $1, updated_at = now() WHERE id = $2',
      [newQty, existing.rows[0].id]
    );
  } else {
    if (qtyToAdd > stock) {
      return res.status(400).json({ error: `На складе осталось ${stock} шт.` });
    }
    await pool.query(
      'INSERT INTO cart_items (cart_id, product_id, qty, price_snapshot) VALUES ($1, $2, $3, $4)',
      [cartId, productId, qtyToAdd, product.price]
    );
  }

  await pool.query('UPDATE carts SET updated_at = now() WHERE id = $1', [cartId]);
  const payload = await getCartPayload(cartId);
  res.status(201).json({ ok: true, ...payload });
}));

// PATCH /api/cart/:id — set quantity for a cart item
app.patch('/api/cart/:id', asyncHandler(async (req, res) => {
  const itemId = Number.parseInt(req.params.id, 10);
  const qty = Number.parseInt((req.body && req.body.qty) || 0, 10);
  if (!Number.isInteger(itemId)) return res.status(400).json({ error: 'Некорректный id' });
  if (!Number.isInteger(qty) || qty < 1) return res.status(400).json({ error: 'Некорректное количество' });

  const itemRes = await pool.query(
    `SELECT ci.id, ci.cart_id, p.stock
       FROM cart_items ci
       JOIN products p ON p.id = ci.product_id
      WHERE ci.id = $1`,
    [itemId]
  );
  if (!itemRes.rows.length) return res.status(404).json({ error: 'Позиция не найдена' });
  const item = itemRes.rows[0];

  if (qty > Number(item.stock)) {
    return res.status(400).json({ error: `На складе осталось ${item.stock} шт.` });
  }

  await pool.query('UPDATE cart_items SET qty = $1, updated_at = now() WHERE id = $2', [qty, itemId]);
  await pool.query('UPDATE carts SET updated_at = now() WHERE id = $1', [item.cart_id]);

  const payload = await getCartPayload(item.cart_id);
  res.json({ ok: true, ...payload });
}));

// DELETE /api/cart/:id — remove an item from the cart
app.delete('/api/cart/:id', asyncHandler(async (req, res) => {
  const itemId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(itemId)) return res.status(400).json({ error: 'Некорректный id' });

  const itemRes = await pool.query('SELECT cart_id FROM cart_items WHERE id = $1', [itemId]);
  if (!itemRes.rows.length) return res.status(404).json({ error: 'Позиция не найдена' });
  const cartId = itemRes.rows[0].cart_id;

  await pool.query('DELETE FROM cart_items WHERE id = $1', [itemId]);
  await pool.query('UPDATE carts SET updated_at = now() WHERE id = $1', [cartId]);

  const payload = await getCartPayload(cartId);
  res.json({ ok: true, ...payload });
}));

// GET /api/profile — fetch user details and their saved cart/orders
app.get('/api/profile', asyncHandler(async (req, res) => {
  const userId = String(req.query.userId || '').trim();
  const sessionId = String(req.query.sessionId || '').trim();

  let user = null;
  if (userId) {
    const u = await pool.query(
      `SELECT id, first_name, last_name, phone, email, address, created_at
         FROM users WHERE id = $1 AND is_active = TRUE`,
      [userId]
    );
    if (u.rows.length) user = u.rows[0];
  }

  let cart = { cartId: null, items: [], total: 0, count: 0 };
  if (sessionId) {
    const cartId = await getOrCreateCart(sessionId, userId || null);
    cart = await getCartPayload(cartId);
  } else if (userId) {
    const c = await pool.query(
      'SELECT id FROM carts WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1',
      [userId]
    );
    if (c.rows.length) cart = await getCartPayload(c.rows[0].id);
  }

  let orders = [];
  if (userId) {
    try {
      const o = await pool.query(
        `SELECT id, subtotal, total, status, created_at
           FROM orders WHERE user_id = $1
           ORDER BY created_at DESC LIMIT 20`,
        [userId]
      );
      orders = o.rows;
    } catch (_) {
      orders = [];
    }
  }

  res.json({ user, cart, orders });
}));

// ---------- Auth (login/register) ----------
app.post('/api/auth/register', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const firstName = String(b.firstName || '').trim();
  const lastName = String(b.lastName || '').trim();
  const email = String(b.email || '').trim().toLowerCase();
  const phone = String(b.phone || '').trim();
  const password = String(b.password || '');

  if (firstName.length < 2) return res.status(400).json({ error: 'Имя: минимум 2 символа' });
  if (lastName.length < 2) return res.status(400).json({ error: 'Фамилия: минимум 2 символа' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Некорректный email' });
  if (password.length < 6) return res.status(400).json({ error: 'Пароль: минимум 6 символов' });

  const exists = await pool.query('SELECT 1 FROM users WHERE email = $1', [email]);
  if (exists.rows.length) return res.status(409).json({ error: 'Пользователь с таким email уже существует' });

  const passwordHash = hashPassword(password);
  const r = await pool.query(
    `INSERT INTO users (first_name, last_name, phone, email, password_hash)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, first_name, last_name, phone, email, created_at`,
    [firstName, lastName, phone || null, email, passwordHash]
  );
  res.status(201).json({ ok: true, user: r.rows[0] });
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  const sessionId = String(b.sessionId || '').trim();

  const r = await pool.query(
    'SELECT id, first_name, last_name, phone, email, password_hash, is_active FROM users WHERE email = $1',
    [email]
  );
  if (!r.rows.length) return res.status(401).json({ error: 'Неверный email или пароль' });
  const u = r.rows[0];
  if (!u.is_active) return res.status(403).json({ error: 'Аккаунт отключён' });
  if (!verifyPassword(password, u.password_hash)) return res.status(401).json({ error: 'Неверный email или пароль' });

  await pool.query('UPDATE users SET updated_at = now() WHERE id = $1', [u.id]);
  if (sessionId) {
    await pool.query('UPDATE carts SET user_id = $1, updated_at = now() WHERE session_id = $2', [u.id, sessionId]);
  }

  res.json({
    ok: true,
    user: { id: u.id, firstName: u.first_name, lastName: u.last_name, phone: u.phone, email: u.email }
  });
}));

// ---------- Orders ----------
app.post('/api/orders', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const firstName = String(b.firstName || '').trim();
  const lastName = String(b.lastName || '').trim();
  const phone = String(b.phone || '').trim();
  const email = String(b.email || '').trim();
  const address = String(b.address || '').trim();
  const sessionId = String(b.sessionId || '').trim();
  const userId = b.userId || null;

  if (!firstName || !lastName || !phone || !email || !address) {
    return res.status(400).json({ error: 'Заполните обязательные поля' });
  }

  if (!sessionId) {
    return res.status(400).json({ error: 'Сессия не найдена. Обновите страницу и попробуйте снова.' });
  }

  const cartId = await getOrCreateCart(sessionId, userId);
  const cartRes = await pool.query(
    `SELECT ci.qty, p.id AS product_id, p.name, p.price, p.stock
       FROM cart_items ci
       JOIN products p ON p.id = ci.product_id
      WHERE ci.cart_id = $1`,
    [cartId]
  );
  const cartItems = cartRes.rows;
  if (!cartItems.length) {
    return res.status(400).json({ error: 'Корзина пуста' });
  }

  for (const it of cartItems) {
    if (Number(it.qty) > Number(it.stock)) {
      return res.status(400).json({ error: `Недостаточно товара «${it.name}» (осталось ${it.stock})` });
    }
  }

  const subtotal = Math.round(cartItems.reduce((s, i) => s + Number(i.price) * Number(i.qty), 0) * 100) / 100;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ensure tables exist (compat with init.sql / old schema)
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id UUID,
        customer_first_name VARCHAR(100),
        customer_last_name VARCHAR(100),
        phone VARCHAR(32),
        email VARCHAR(200),
        address TEXT,
        subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
        total NUMERIC(12,2) NOT NULL DEFAULT 0,
        status VARCHAR(30) NOT NULL DEFAULT 'new',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        order_id BIGINT NOT NULL,
        product_id BIGINT,
        product_name VARCHAR(200) NOT NULL,
        price NUMERIC(12,2) NOT NULL,
        qty INTEGER NOT NULL
      )
    `);
    // compat: старая таблица могла быть без product_id
    await client.query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_id BIGINT');
    // compat: некоторые старые схемы имели обязательные колонки — подстрахуемся
    await client.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id UUID');
    await client.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12,2) NOT NULL DEFAULT 0');
    await client.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS total NUMERIC(12,2) NOT NULL DEFAULT 0');
    await client.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT \'new\'');
    await client.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_code VARCHAR(50)');
    await client.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0');

    // promo
    await client.query(`
      CREATE TABLE IF NOT EXISTS promos (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        code VARCHAR(50) NOT NULL UNIQUE,
        discount_percent INTEGER NOT NULL CHECK (discount_percent > 0 AND discount_percent <= 100),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const promoCodeInput = String(b.promoCode || '').trim().toUpperCase();
    let discountAmount = 0;
    let appliedPromo = null;
    if (promoCodeInput) {
      const pr = await client.query('SELECT code, discount_percent FROM promos WHERE upper(code) = $1 AND is_active = TRUE', [promoCodeInput]);
      if (pr.rows.length) {
        appliedPromo = pr.rows[0].code;
        discountAmount = Math.round(subtotal * Number(pr.rows[0].discount_percent) / 100 * 100) / 100;
      }
    }
    const finalTotal = Math.max(0, Math.round((subtotal - discountAmount) * 100) / 100);

    const o = await client.query(
      `INSERT INTO orders (user_id, customer_first_name, customer_last_name, phone, email, address, subtotal, total, status, promo_code, discount_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'new',$9,$10) RETURNING id`,
      [userId, firstName, lastName, phone, email, address, subtotal, finalTotal, appliedPromo, discountAmount]
    );
    const orderId = o.rows[0].id;

    for (const it of cartItems) {
      await client.query(
        'INSERT INTO order_items (order_id, product_id, product_name, price, qty) VALUES ($1,$2,$3,$4,$5)',
        [orderId, it.product_id, it.name, it.price, it.qty]
      );
      await client.query(
        'UPDATE products SET stock = stock - $1, updated_at = now() WHERE id = $2',
        [it.qty, it.product_id]
      );
    }

    await client.query('DELETE FROM cart_items WHERE cart_id = $1', [cartId]);
    await client.query('COMMIT');

    res.status(201).json({ ok: true, orderId, total: finalTotal, subtotal, discountAmount, promoCode: appliedPromo });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

// ---------- Reviews ----------
// GET /api/reviews/products — список товаров с отзывами (для фильтров/звёзд)
app.get('/api/reviews/products', asyncHandler(async (req, res) => {
  const r = await pool.query(
    `SELECT product_slug, max(product_name) AS product_name,
            count(*)::int AS count, round(avg(rating)::numeric, 1) AS avg_rating
       FROM reviews
      WHERE is_approved = TRUE
      GROUP BY product_slug
      ORDER BY count DESC`
  );
  res.json(r.rows);
}));

// GET /api/reviews?productSlug=&limit=&offset= — отзывы (все или по товару)
app.get('/api/reviews', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const rawSlug = req.query.productSlug || req.query.productName;
  const slug = rawSlug ? slugify(rawSlug) : null;

  const where = slug ? 'WHERE product_slug = $1 AND is_approved = TRUE' : 'WHERE is_approved = TRUE';
  const params = slug ? [slug] : [];

  const rows = await pool.query(
    `SELECT id, product_slug, product_name, user_name, rating, comment, created_at
       FROM reviews ${where}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const stats = await pool.query(
    `SELECT count(*)::int AS total,
            COALESCE(round(avg(rating)::numeric, 1), 0) AS avg_rating
       FROM reviews ${where}`,
    params
  );

  res.json({
    items: rows.rows,
    total: stats.rows[0].total,
    avgRating: Number(stats.rows[0].avg_rating)
  });
}));

// POST /api/reviews — создать отзыв
app.post('/api/reviews', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const userName = String(body.userName || '').trim().replace(/\s+/g, ' ');
  const comment = String(body.comment || '').trim();
  const rating = parseInt(body.rating, 10);
  const productName = String(body.productName || '').trim();
  const productSlug = slugify(body.productSlug || productName);

  if (!productSlug || !productName) return res.status(400).json({ error: 'Не указан товар' });
  if (userName.length < 2 || userName.length > 100) return res.status(400).json({ error: 'Имя: от 2 до 100 символов' });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Оценка: от 1 до 5' });
  if (comment.length < 3 || comment.length > 2000) return res.status(400).json({ error: 'Отзыв: от 3 до 2000 символов' });

  const r = await pool.query(
    `INSERT INTO reviews (product_slug, product_name, user_name, rating, comment)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, product_slug, product_name, user_name, rating, comment, created_at`,
    [productSlug, productName, userName, rating, comment]
  );

  const stats = await pool.query(
    `SELECT count(*)::int AS total,
            COALESCE(round(avg(rating)::numeric, 1), 0) AS avg_rating
       FROM reviews WHERE product_slug = $1 AND is_approved = TRUE`,
    [productSlug]
  );

  res.status(201).json({
    ok: true,
    review: r.rows[0],
    total: stats.rows[0].total,
    avgRating: Number(stats.rows[0].avg_rating)
  });
}));

// ---------- Promo ----------
app.get('/api/promo', asyncHandler(async (req, res) => {
  const code = String(req.query.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Введите промокод' });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS promos (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      code VARCHAR(50) NOT NULL UNIQUE,
      discount_percent INTEGER NOT NULL CHECK (discount_percent > 0 AND discount_percent <= 100),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  // seed defaults if empty
  await pool.query(`
    INSERT INTO promos (code, discount_percent, is_active) VALUES
      ('MASTER10', 10, TRUE),
      ('PC10', 10, TRUE)
    ON CONFLICT (code) DO NOTHING
  `);

  const r = await pool.query(
    'SELECT code, discount_percent FROM promos WHERE upper(code) = $1 AND is_active = TRUE',
    [code]
  );
  if (!r.rows.length) return res.status(404).json({ error: 'Промокод не найден или неактивен' });

  res.json({ ok: true, code: r.rows[0].code, discountPercent: Number(r.rows[0].discount_percent) });
}));

// ---------- Contacts ----------
app.post('/api/contacts', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const email = String(b.email || '').trim();
  const message = String(b.message || '').trim();
  if (!name || !email || !message) return res.status(400).json({ error: 'Заполните все поля' });

  await pool.query(
    `CREATE TABLE IF NOT EXISTS contact_messages (
       id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
       name VARCHAR(150) NOT NULL,
       email VARCHAR(200) NOT NULL,
       message TEXT NOT NULL,
       is_read BOOLEAN NOT NULL DEFAULT FALSE,
       created_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`
  );
  await pool.query(
    'INSERT INTO contact_messages (name, email, message) VALUES ($1,$2,$3)',
    [name, email, message]
  );
  res.json({ ok: true });
}));

// ---------- error handler ----------
app.use((err, req, res, next) => {
  console.error(err);
  if (err && err.code === '42P01') {
    return res.status(500).json({ error: 'Таблица не найдена. Выполните db/init.sql в pgAdmin для базы pcmaster.' });
  }
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Ошибка сервера' });
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`Backend running: http://localhost:${PORT}`);
});

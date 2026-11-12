-- ПК-МАСТЕР: Cart + Profile migration & seed (PostgreSQL 18)
-- Run in pgAdmin Query Tool or:
--   psql -U postgres -d pcmaster -f db/cart-profile.sql
-- Safe to re-run (uses IF NOT EXISTS / ON CONFLICT where applicable).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1) USERS
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name VARCHAR(100) NOT NULL,
  last_name  VARCHAR(100) NOT NULL,
  phone      VARCHAR(32)  NOT NULL,
  email      VARCHAR(200) NOT NULL UNIQUE,
  address    TEXT,
  password_hash VARCHAR(255),
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- 2) CATEGORIES (minimal, for FK)
CREATE TABLE IF NOT EXISTS categories (
  id SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  sort_order SMALLINT NOT NULL DEFAULT 0
);
INSERT INTO categories (name, slug, sort_order) VALUES
  ('Готовые сборки','gotosbor',1),
  ('Видеокарты','videokarty',2),
  ('Процессоры','processory',3),
  ('Оперативная память','operativnaya-pamyat',4)
ON CONFLICT (slug) DO NOTHING;

-- 3) PRODUCTS
CREATE TABLE IF NOT EXISTS products (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_id SMALLINT REFERENCES categories(id),
  name VARCHAR(200) NOT NULL,
  slug VARCHAR(220) NOT NULL UNIQUE,
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  image_url TEXT,
  description TEXT,
  stock INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active) WHERE is_active = TRUE;

-- Seed the 4 requested products (prices in ₽)
INSERT INTO products (category_id, name, slug, price, image_url, description, stock, is_active)
SELECT c.id, v.name, v.slug, v.price, v.image_url, v.description, v.stock, TRUE
FROM (VALUES
  ('gotosbor',  'Игровой ПК ''Fury X''',  'fury-x',             1349990, 'https://images.unsplash.com/photo-1593640408182-31c70c8268f5?w=600&q=80', 'Флагманская игровая сборка под 4K', 5),
  ('videokarty','RTX 5090 ROG Matrix',     'rtx-5090-rog-matrix', 800990, 'https://images.unsplash.com/photo-1591488320449-011701bb6704?w=600&q=80', 'Топовая видеокарта ASUS ROG Matrix', 3),
  ('processory','Ryzen 9 9950X3D',         'ryzen-9-9950x3d',      63990, 'https://images.unsplash.com/photo-1555617981-dac3880eac6e?w=600&q=80', 'Флагманский процессор AMD с 3D V-Cache', 12),
  ('operativnaya-pamyat','Corsair 32GB DDR5','corsair-32gb-ddr5',   90990, 'https://images.unsplash.com/photo-1541029071515-84cc54f54dc5?w=600&q=80', 'Комплект памяти Corsair DDR5 32GB с подсветкой', 20)
) AS v(cat_slug, name, slug, price, image_url, description, stock)
JOIN categories c ON c.slug = v.cat_slug
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  price = EXCLUDED.price,
  image_url = EXCLUDED.image_url,
  description = EXCLUDED.description,
  stock = EXCLUDED.stock,
  category_id = EXCLUDED.category_id,
  is_active = TRUE,
  updated_at = now();

-- 4) CARTS (one per session or per user)
CREATE TABLE IF NOT EXISTS carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  session_id VARCHAR(150) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_carts_session ON carts(session_id);
CREATE INDEX IF NOT EXISTS idx_carts_user ON carts(user_id);

-- 5) CART_ITEMS
CREATE TABLE IF NOT EXISTS cart_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cart_id UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  price_snapshot NUMERIC(12,2) NOT NULL CHECK (price_snapshot >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cart_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_cart_items_cart ON cart_items(cart_id);

-- 6) ORDERS (for profile "saved cart/orders")
CREATE TABLE IF NOT EXISTS orders (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  customer_first_name VARCHAR(100),
  customer_last_name  VARCHAR(100),
  phone VARCHAR(32),
  email VARCHAR(200),
  address TEXT,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
  product_name VARCHAR(200) NOT NULL,
  price NUMERIC(12,2) NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0)
);

-- updated_at trigger helper
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_users_upd') THEN
    CREATE TRIGGER trg_users_upd BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_products_upd') THEN
    CREATE TRIGGER trg_products_upd BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_carts_upd') THEN
    CREATE TRIGGER trg_carts_upd BEFORE UPDATE ON carts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cart_items_upd') THEN
    CREATE TRIGGER trg_cart_items_upd BEFORE UPDATE ON cart_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- Verify
-- SELECT id, name, slug, price, stock FROM products WHERE slug IN ('fury-x','rtx-5090-rog-matrix','ryzen-9-9950x3d','corsair-32gb-ddr5');

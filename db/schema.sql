-- ПК-МАСТЕР: схема PostgreSQL v1.0
-- Запуск: psql -U postgres -d pcmaster -f schema.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Сброс при локальной разработке (раскомментировать при желании)
-- DROP TABLE IF EXISTS order_items, orders, cart_items, carts, contact_messages, product_specs, configurator_components, products, promos, categories, users CASCADE;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  email VARCHAR(200) NOT NULL UNIQUE,
  address TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_email ON users(email);

CREATE TABLE categories (
  id SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  sort_order SMALLINT NOT NULL DEFAULT 0
);

CREATE TABLE products (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_id SMALLINT NOT NULL REFERENCES categories(id),
  name VARCHAR(200) NOT NULL,
  slug VARCHAR(220) NOT NULL UNIQUE,
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  old_price NUMERIC(12,2) CHECK (old_price IS NULL OR old_price >= price),
  rating NUMERIC(3,1) NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
  reviews_count INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  description TEXT,
  stock INTEGER NOT NULL DEFAULT 0,
  is_hit BOOLEAN NOT NULL DEFAULT FALSE,
  is_new BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_active ON products(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_products_price ON products(price);
CREATE INDEX idx_products_hit ON products(is_hit) WHERE is_hit = TRUE;

CREATE TABLE product_specs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  spec_name VARCHAR(100) NOT NULL,
  spec_value VARCHAR(200) NOT NULL,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  UNIQUE (product_id, spec_name)
);
CREATE INDEX idx_specs_product ON product_specs(product_id);

CREATE TABLE configurator_components (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type VARCHAR(20) NOT NULL CHECK (type IN ('cpu','gpu','motherboard','ram','ssd')),
  name VARCHAR(200) NOT NULL,
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  UNIQUE (type, name)
);
CREATE INDEX idx_cfg_type ON configurator_components(type) WHERE is_active = TRUE;

CREATE TABLE promos (
  id SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  discount_percent NUMERIC(5,2) NOT NULL CHECK (discount_percent BETWEEN 0 AND 100),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ
);

CREATE TABLE carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  session_id VARCHAR(150) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_carts_session ON carts(session_id);
CREATE INDEX idx_carts_user ON carts(user_id);

CREATE TABLE cart_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cart_id UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id BIGINT REFERENCES products(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  price_snapshot NUMERIC(12,2) NOT NULL,
  CHECK (product_id IS NOT NULL)
);
CREATE UNIQUE INDEX idx_cart_items_unique ON cart_items(cart_id, product_id);

CREATE TABLE orders (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  customer_first_name VARCHAR(100) NOT NULL,
  customer_last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  email VARCHAR(200) NOT NULL,
  address TEXT NOT NULL,
  delivery_method VARCHAR(50) NOT NULL DEFAULT 'pickup',
  payment_method VARCHAR(50) NOT NULL DEFAULT 'card_online',
  promo_code VARCHAR(50),
  delivery_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  subtotal NUMERIC(12,2) NOT NULL,
  discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new','confirmed','assembling','shipped','done','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_created ON orders(created_at DESC);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_phone ON orders(phone);

CREATE TABLE order_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_name VARCHAR(200) NOT NULL,
  price NUMERIC(12,2) NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  sum NUMERIC(12,2) GENERATED ALWAYS AS (price * qty) STORED
);

CREATE TABLE contact_messages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Триггер updated_at
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_users_upd BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_products_upd BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_carts_upd BEFORE UPDATE ON carts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_orders_upd BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- v1.1: Отзывы
-- ============================================================
CREATE TABLE IF NOT EXISTS reviews (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_slug VARCHAR(220) NOT NULL,
  product_name VARCHAR(200) NOT NULL,
  user_name VARCHAR(100) NOT NULL CHECK (length(btrim(user_name)) BETWEEN 2 AND 100),
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL CHECK (length(btrim(comment)) BETWEEN 3 AND 2000),
  is_approved BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_slug, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_created ON reviews(created_at DESC);

CREATE OR REPLACE FUNCTION recalc_product_rating() RETURNS TRIGGER AS $$
DECLARE
  s TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    s := OLD.product_slug;
  ELSE
    s := NEW.product_slug;
  END IF;

  UPDATE products p
     SET reviews_count = sub.cnt,
         rating = COALESCE(sub.avg_rating, 0)
    FROM (
      SELECT count(*)::int AS cnt,
             round(avg(rating)::numeric, 1) AS avg_rating
        FROM reviews
       WHERE product_slug = s AND is_approved = TRUE
    ) sub
   WHERE p.slug = s;

  IF TG_OP = 'UPDATE' AND OLD.product_slug <> NEW.product_slug THEN
    UPDATE products p
       SET reviews_count = sub.cnt,
           rating = COALESCE(sub.avg_rating, 0)
      FROM (
        SELECT count(*)::int AS cnt,
               round(avg(rating)::numeric, 1) AS avg_rating
          FROM reviews
         WHERE product_slug = OLD.product_slug AND is_approved = TRUE
      ) sub
     WHERE p.slug = OLD.product_slug;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reviews_rating ON reviews;
CREATE TRIGGER trg_reviews_rating
AFTER INSERT OR UPDATE OR DELETE ON reviews
FOR EACH ROW EXECUTE FUNCTION recalc_product_rating();

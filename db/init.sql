-- ============================================================
-- ПК-МАСТЕР: полная инициализация БД (PostgreSQL 18 / pgAdmin)
-- ============================================================
-- 1) Создайте БД (один раз), если её нет:
--      CREATE DATABASE pcmaster;
-- 2) Выполните этот скрипт в Query Tool для базы pcmaster
--    или: psql -U postgres -d pcmaster -f db/init.sql
-- Скрипт идемпотентен: можно запускать повторно.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Чистый пересоздание таблиц корзины/профиля (безопасно для dev)
-- Раскомментируйте DROP, если нужно полностью сбросить корзины/заказы/пользователей:
-- DROP TABLE IF EXISTS order_items, orders, cart_items, carts CASCADE;

-- ---------- USERS ----------
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name    VARCHAR(100)  NOT NULL,
  last_name     VARCHAR(100)  NOT NULL,
  phone         VARCHAR(32),
  email         VARCHAR(200)  NOT NULL UNIQUE,
  address       TEXT,
  password_hash VARCHAR(255),
  is_active     BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ---------- CATEGORIES ----------
CREATE TABLE IF NOT EXISTS categories (
  id         SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  slug       VARCHAR(100) NOT NULL UNIQUE,
  sort_order SMALLINT     NOT NULL DEFAULT 0
);

INSERT INTO categories (name, slug, sort_order) VALUES
  ('Готовые сборки',    'builds', 1),
  ('Видеокарты',        'gpu',    2),
  ('Процессоры',        'cpu',    3),
  ('Оперативная память','ram',    4)
ON CONFLICT (slug) DO NOTHING;

-- ---------- PRODUCTS ----------
CREATE TABLE IF NOT EXISTS products (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_id SMALLINT REFERENCES categories(id),
  name        VARCHAR(200)    NOT NULL,
  slug        VARCHAR(220)    NOT NULL UNIQUE,
  price       NUMERIC(12,2)   NOT NULL CHECK (price >= 0),
  image_url   TEXT,
  description TEXT,
  stock       INTEGER         NOT NULL DEFAULT 0 CHECK (stock >= 0),
  is_active   BOOLEAN         NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ     NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);

-- Начальные товары (как на сайте)
INSERT INTO products (category_id, name, slug, price, image_url, description, stock, is_active)
SELECT c.id, v.name, v.slug, v.price, v.image_url, v.description, v.stock, TRUE
FROM (VALUES
  ('builds', 'Игровой ПК ''Fury X''', 'fury-x',
    1349990.00,
    'https://images.unsplash.com/photo-1593640408182-31c70c8268f5?w=800&q=80',
    'Флагманская игровая сборка под 4K. Топовая производительность для игр и стриминга.',
    5),

  ('gpu', 'RTX 5090 ROG Matrix', 'rtx-5090-rog-matrix',
    800990.00,
    'https://images.unsplash.com/photo-1591488320449-011701bb6704?w=800&q=80',
    'Топовая видеокарта ASUS ROG Matrix. Максимум FPS в 4K и трассировка лучей.',
    3),

  ('cpu', 'Ryzen 9 9950X3D', 'ryzen-9-9950x3d',
    63990.00,
    'https://images.unsplash.com/photo-1555617981-dac3880eac6e?w=800&q=80',
    'Флагманский процессор AMD с 3D V-Cache для игр и тяжёлых задач.',
    12),

  ('ram', 'Corsair 32GB DDR5', 'corsair-32gb-ddr5',
    90990.00,
    'https://images.unsplash.com/photo-1541029071515-84cc54f54dc5?w=800&q=80',
    'Высокоскоростной комплект памяти Corsair DDR5 32GB с RGB-подсветкой.',
    20)
) AS v(cat_slug, name, slug, price, image_url, description, stock)
JOIN categories c ON c.slug = v.cat_slug
ON CONFLICT (slug) DO UPDATE SET
  name        = EXCLUDED.name,
  price       = EXCLUDED.price,
  image_url   = EXCLUDED.image_url,
  description = EXCLUDED.description,
  stock       = EXCLUDED.stock,
  category_id = EXCLUDED.category_id,
  is_active   = TRUE,
  updated_at  = now();

-- ---------- CARTS ----------
-- Одна корзина на session_id (гость) с возможной привязкой к user_id после входа
CREATE TABLE IF NOT EXISTS carts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  session_id VARCHAR(150) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_carts_user ON carts(user_id);

-- ---------- CART ITEMS ----------
CREATE TABLE IF NOT EXISTS cart_items (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cart_id        UUID          NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id     BIGINT        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty            INTEGER       NOT NULL CHECK (qty > 0),
  price_snapshot NUMERIC(12,2) NOT NULL CHECK (price_snapshot >= 0),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (cart_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_cart_items_cart ON cart_items(cart_id);

-- ---------- ORDERS (для истории в профиле) ----------
CREATE TABLE IF NOT EXISTS orders (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
  customer_first_name VARCHAR(100),
  customer_last_name  VARCHAR(100),
  phone               VARCHAR(32),
  email               VARCHAR(200),
  address             TEXT,
  subtotal            NUMERIC(12,2) NOT NULL DEFAULT 0,
  total               NUMERIC(12,2) NOT NULL DEFAULT 0,
  status              VARCHAR(30)   NOT NULL DEFAULT 'new',
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id     BIGINT        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   BIGINT        REFERENCES products(id) ON DELETE SET NULL,
  product_name VARCHAR(200)  NOT NULL,
  price        NUMERIC(12,2) NOT NULL,
  qty          INTEGER       NOT NULL CHECK (qty > 0)
);

-- ---------- updated_at trigger ----------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_users_updated') THEN
    CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_products_updated') THEN
    CREATE TRIGGER trg_products_updated BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_carts_updated') THEN
    CREATE TRIGGER trg_carts_updated BEFORE UPDATE ON carts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cart_items_updated') THEN
    CREATE TRIGGER trg_cart_items_updated BEFORE UPDATE ON cart_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ---------- PROMOS ----------
CREATE TABLE IF NOT EXISTS promos (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code             VARCHAR(50)  NOT NULL UNIQUE,
  discount_percent INTEGER      NOT NULL CHECK (discount_percent > 0 AND discount_percent <= 100),
  is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

INSERT INTO promos (code, discount_percent, is_active) VALUES
  ('MASTER10', 10, TRUE),
  ('PC10',     10, TRUE)
ON CONFLICT (code) DO UPDATE SET
  discount_percent = EXCLUDED.discount_percent,
  is_active = EXCLUDED.is_active;

-- поля промокода в заказах (совместимость)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_code VARCHAR(50);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

-- ---------- Проверка ----------
-- SELECT id, name, slug, price, stock, image_url FROM products ORDER BY id;
-- SELECT code, discount_percent, is_active FROM promos;

-- ПК-МАСТЕР: отзывы (копия для папки БД)
-- Запуск: psql -U postgres -d pcmaster -f db/reviews.sql
-- Основной файл: C:\Users\VRTXSH\Desktop\PC-MASTER\pcmaster\db\reviews.sql

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

-- Демо-отзывы
INSERT INTO reviews (product_slug, product_name, user_name, rating, comment)
SELECT * FROM (VALUES
  ('tragg',            'Игровой ПК "Tragg"',      'Алексей',  5, 'Собрано аккуратно, провода уложены. В 4K тянет всё на ультрах.'),
  ('tragg',            'Игровой ПК "Tragg"',      'Марина',   5, 'Пришёл быстро, коробка целая. Очень тихий под нагрузкой.'),
  ('tragg',            'Игровой ПК "Tragg"',      'Дмитрий',  4, 'Отличная машина, но за такую цену хотелось бы SSD побольше.'),
  ('rtx-4070-ti-12gb', 'RTX 4070 Ti 12GB',        'Игорь',    5, 'Беру вторую такую, температуры низкие, под нагрузкой не слышно.'),
  ('rtx-4070-ti-12gb', 'RTX 4070 Ti 12GB',        'Сергей',   4, 'Хорошая карта за свои деньги, DLSS решает.'),
  ('ryzen-7-7800x3d',  'Ryzen 7 7800X3D',         'Павел',    5, 'Лучший выбор для игр. FPS вырос заметно по сравнению со старым i7.'),
  ('deepcool-ch560',   'Корпус DeepCool CH560',   'Никита',   5, 'Продув отличный, стекло красивое, собирать удобно.'),
  ('deepcool-ch560',   'Корпус DeepCool CH560',   'Ольга',    4, 'Всё хорошо, только пылевой фильтр снизу неудобно снимать.')
) AS d(product_slug, product_name, user_name, rating, comment)
WHERE NOT EXISTS (SELECT 1 FROM reviews);

-- ПК-МАСТЕР: тестовые данные (по макету Figma)
-- Запуск: psql -U postgres -d pcmaster -f seed.sql

INSERT INTO categories (name, slug, sort_order) VALUES
  ('Готовые сборки','gotosbor','1'),
  ('Видеокарты','videokarty','2'),
  ('Процессоры','processory','3'),
  ('Материнские платы','materinskie-platy','4'),
  ('Оперативная память','operativnaya-pamyat','5'),
  ('Корпуса','korpusa','6'),
  ('Накопители','nakopiteli','7'),
  ('Блоки питания','bloki-pitaniya','8')
ON CONFLICT (slug) DO NOTHING;

-- Каталог
INSERT INTO products (category_id, name, slug, price, rating, reviews_count, image_url, description, stock, is_hit, is_new) VALUES
(1,'Игровой ПК "Fury X"','fury-x',1349990,4.9,96,'https://images.unsplash.com/photo-1593640408182-31c70c8268f5','Флагманская сборка под 4K',5,TRUE,FALSE),
(2,'RTX 5090 ROG Matrix','rtx-5090-rog-matrix',800990,5.0,41,'https://images.unsplash.com/photo-1591488320449-011701bb6704','Топовая видеокарта ASUS',3,TRUE,FALSE),
(3,'Ryzen 9 9950X3D','ryzen-9-9950x3d',63990,4.9,58,'https://images.unsplash.com/photo-1555617981-dac3880eac6e','Флагман AMD',12,TRUE,FALSE),
(5,'Corsair 32GB DDR5','corsair-32gb-ddr5',90990,4.8,33,'https://images.unsplash.com/photo-1541029071515-84cc54f54dc5','Память с подсветкой',20,TRUE,FALSE),
(1,'Игровой ПК "Tragg"','tragg',449990,4.9,124,'https://images.unsplash.com/photo-1587202372775-e229f172b9d7','RTX 4080 + Ryzen 9 7900X',4,FALSE,FALSE),
(2,'RTX 4070 Ti 12GB','rtx-4070-ti-12gb',79990,4.9,87,'https://images.unsplash.com/photo-1591488320449-011701bb6704','Видеокарта для 2K/4K',15,FALSE,FALSE),
(3,'Ryzen 7 7800X3D','ryzen-7-7800x3d',52500,4.9,112,'https://images.unsplash.com/photo-1555617981-dac3880eac6e','Лучший игровой CPU',25,FALSE,FALSE),
(6,'Корпус DeepCool CH560','deepcool-ch560',8200,4.9,64,'https://images.unsplash.com/photo-1587302912306-cf1ed9c33146','Корпус с ARGB',18,FALSE,FALSE),
(2,'AMD RX 5070 XT','amd-rx-5070-xt',68990,4.7,29,'https://images.unsplash.com/photo-1593640408182-31c70c8268f5','Новинка AMD',10,FALSE,TRUE),
(5,'TRIDENT Z5 DDR5','trident-z5-ddr5',24990,4.8,21,'https://images.unsplash.com/photo-1541029071515-84cc54f54dc5','Память G.Skill',30,FALSE,TRUE),
(3,'INTEL ULTRA 9 285K','intel-ultra-9-285k',58990,4.9,18,'https://images.unsplash.com/photo-1555617981-dac3880eac6e','Процессор Intel',14,FALSE,TRUE),
(8,'ASUS ROG 1000W','asus-rog-1000w',73990,5.0,12,'https://images.unsplash.com/photo-1587302912306-cf1ed9c33146','Блок питания Gold',8,FALSE,TRUE)
ON CONFLICT (slug) DO NOTHING;

-- Характеристики Tragg
INSERT INTO product_specs (product_id, spec_name, spec_value, sort_order)
SELECT id, v.k, v.v, v.o FROM products p CROSS JOIN (VALUES
  ('Процессор','AMD Ryzen 9 7900X',1),
  ('Видеокарта','NVIDIA RTX 4080 16GB',2),
  ('ОЗУ','DDR5 32GB 6000MHz',3),
  ('Накопитель','SSD NVMe 2TB',4),
  ('Охлаждение','Жидкостное 360мм',5),
  ('Блок питания','1000W Gold',6)
) AS v(k,v,o) WHERE p.slug='tragg'
ON CONFLICT DO NOTHING;

-- Конфигуратор (цены из макета)
INSERT INTO configurator_components (type, name, price, sort_order) VALUES
('cpu','Ryzen 7 7800X3D',52500,1),('cpu','Ryzen 9 7900X',68900,2),('cpu','Intel i7-14700K',58200,3),
('gpu','RTX 4070 Ti 12GB',79990,1),('gpu','RTX 4080 16GB',119990,2),('gpu','RTX 4090 24GB',189990,3),
('motherboard','ASUS B650-Plus',18500,1),('motherboard','MSI X670E',32900,2),('motherboard','Gigabyte Z790',26800,3),
('ram','DDR5 32GB',15500,1),('ram','DDR5 64GB',32500,2),('ram','DDR5 128GB',65200,3),
('ssd','SSD NVMe 1TB',8800,1),('ssd','SSD NVMe 2TB',13200,2),('ssd','SSD NVMe 4TB',24900,3)
ON CONFLICT DO NOTHING;

INSERT INTO promos (code, discount_percent, is_active) VALUES ('MASTER10',10,TRUE),('PC10',10,TRUE) ON CONFLICT DO NOTHING;

INSERT INTO users (first_name,last_name,phone,email,address) VALUES
('Иван','Иванов','+7 (931) 419-67-99','ivanov@mail.ru','г. Кызыл')
ON CONFLICT (email) DO NOTHING;

-- Пример заказа из экрана Checkout
INSERT INTO orders (customer_first_name,customer_last_name,phone,email,address,delivery_method,payment_method,delivery_price,subtotal,total,status)
VALUES ('Иван','Иванов','+7 (931) 419-67-99','ivanov@mail.ru','г. Кызыл','pickup','card_online',350,229980,230330,'new')
RETURNING id;

INSERT INTO order_items (order_id, product_name, price, qty)
SELECT id, 'ПК "Fury X"', 149990, 1 FROM orders ORDER BY id DESC LIMIT 1;
INSERT INTO order_items (order_id, product_name, price, qty)
SELECT id, 'RTX 4070 Ti', 79990, 1 FROM orders ORDER BY id DESC LIMIT 1;

INSERT INTO contact_messages (name,email,message) VALUES
('Тест','test@mail.ru','Здравствуйте, хочу собрать ПК'),
('Гость','guest@mail.ru','Есть ли в наличии RTX 4070 Ti?');

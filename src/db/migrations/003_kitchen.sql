-- Jojo's Kitchen: cooked-to-order meals, delivery only. Regular orders follow the lead-time rules;
-- express orders need Jojo's approval first.

CREATE TABLE IF NOT EXISTS meals (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug                VARCHAR(80) NOT NULL,
  name                VARCHAR(120) NOT NULL,
  category            ENUM('rice','soups','swallow','proteins','small_chops','sides','party') NOT NULL,
  description         VARCHAR(600) NULL,
  illustration        VARCHAR(40) NULL,           -- built-in artwork key, used until Jojo uploads a photo
  image_url           VARCHAR(512) NULL,
  image_public_id     VARCHAR(255) NULL,
  allowed_exclusions  JSON NOT NULL,               -- e.g. ["no_garlic","no_ginger"]
  spice_levels        TINYINT(1) NOT NULL DEFAULT 1,
  contains            VARCHAR(255) NULL,           -- allergen/ingredient note shown to customers
  featured            TINYINT(1) NOT NULL DEFAULT 0,
  active              TINYINT(1) NOT NULL DEFAULT 1,
  sort                INT NOT NULL DEFAULT 0,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_meal_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- How a meal is sold: a plate, a litre of soup, a cooler for a party…
-- `portions` measures cooking effort; it drives daily capacity and bulk lead time.
CREATE TABLE IF NOT EXISTS meal_options (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  meal_id    INT UNSIGNED NOT NULL,
  label      VARCHAR(80) NOT NULL,
  serves     VARCHAR(40) NULL,                     -- "Serves 4–5"
  price      DECIMAL(12,2) NOT NULL,
  portions   DECIMAL(6,2) NOT NULL DEFAULT 1,
  is_bulk    TINYINT(1) NOT NULL DEFAULT 0,
  active     TINYINT(1) NOT NULL DEFAULT 1,
  sort       INT NOT NULL DEFAULT 0,
  KEY idx_mo_meal (meal_id, active),
  CONSTRAINT fk_mo_meal FOREIGN KEY (meal_id) REFERENCES meals(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kitchen_orders (
  id                     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference              VARCHAR(16) NOT NULL,
  customer_id            BIGINT UNSIGNED NOT NULL,
  order_type             ENUM('regular','express') NOT NULL,
  status                 VARCHAR(30) NOT NULL,
  delivery_date          DATE NOT NULL,
  delivery_window        VARCHAR(20) NULL,          -- regular: morning / afternoon / evening
  requested_delivery_at  DATETIME NULL,             -- express: the time the customer asked for (UTC)
  delivery_address_id    BIGINT UNSIGNED NULL,
  addr_label             VARCHAR(40) NULL,
  addr_recipient         VARCHAR(120) NULL,
  addr_phone             VARCHAR(32) NULL,
  addr_line              VARCHAR(255) NULL,
  addr_area              VARCHAR(80) NULL,
  addr_landmark          VARCHAR(160) NULL,
  addr_instructions      VARCHAR(500) NULL,
  addr_lat               DECIMAL(9,6) NULL,
  addr_lng               DECIMAL(9,6) NULL,
  portions               DECIMAL(8,2) NOT NULL DEFAULT 0,
  is_bulk                TINYINT(1) NOT NULL DEFAULT 0,
  subtotal               DECIMAL(12,2) NOT NULL DEFAULT 0,
  delivery_fee           DECIMAL(12,2) NOT NULL DEFAULT 0,
  express_fee            DECIMAL(12,2) NOT NULL DEFAULT 0,
  total                  DECIMAL(12,2) NOT NULL DEFAULT 0,
  customer_notes         VARCHAR(1000) NULL,
  allergy_notes          VARCHAR(500) NULL,
  operator_note          VARCHAR(1000) NULL,
  status_reason          VARCHAR(500) NULL,
  refund_due             DECIMAL(12,2) NOT NULL DEFAULT 0,
  refund_status          ENUM('none','refund_pending','refunded','credited') NOT NULL DEFAULT 'none',
  expires_at             DATETIME NULL,
  approved_at            DATETIME NULL,
  paid_at                DATETIME NULL,
  delivered_at           DATETIME NULL,
  cancelled_at           DATETIME NULL,
  created_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ko_ref (reference),
  KEY idx_ko_customer (customer_id, created_at),
  KEY idx_ko_date_status (delivery_date, status),
  KEY idx_ko_status (status),
  CONSTRAINT fk_ko_customer FOREIGN KEY (customer_id) REFERENCES users(id),
  CONSTRAINT fk_ko_addr FOREIGN KEY (delivery_address_id) REFERENCES customer_addresses(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kitchen_order_items (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id      BIGINT UNSIGNED NOT NULL,
  meal_id       INT UNSIGNED NULL,
  option_id     INT UNSIGNED NULL,
  meal_name     VARCHAR(120) NOT NULL,
  option_label  VARCHAR(80) NOT NULL,
  unit_price    DECIMAL(12,2) NOT NULL,
  quantity      INT UNSIGNED NOT NULL,
  portions      DECIMAL(8,2) NOT NULL,
  line_total    DECIMAL(12,2) NOT NULL,
  exclusions    JSON NOT NULL,
  spice_level   ENUM('mild','medium','hot') NULL,
  instructions  VARCHAR(500) NULL,
  sort          INT NOT NULL DEFAULT 0,
  KEY idx_koi_order (order_id),
  CONSTRAINT fk_koi_order FOREIGN KEY (order_id) REFERENCES kitchen_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_koi_meal FOREIGN KEY (meal_id) REFERENCES meals(id) ON DELETE SET NULL,
  CONSTRAINT fk_koi_option FOREIGN KEY (option_id) REFERENCES meal_options(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kitchen_order_events (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id      BIGINT UNSIGNED NOT NULL,
  from_status   VARCHAR(30) NULL,
  to_status     VARCHAR(30) NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  reason        VARCHAR(500) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_koe_order (order_id, created_at),
  CONSTRAINT fk_koe_order FOREIGN KEY (order_id) REFERENCES kitchen_orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Blocked cooking days or a different capacity for a day
CREATE TABLE IF NOT EXISTS kitchen_day_overrides (
  override_date     DATE PRIMARY KEY,
  override_type     ENUM('blocked','capacity') NOT NULL,
  capacity_portions SMALLINT UNSIGNED NULL,
  reason            VARCHAR(160) NULL,
  created_by        BIGINT UNSIGNED NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Payments for kitchen orders share the same ledger as market runs.
ALTER TABLE payment_transactions
  ADD COLUMN kitchen_order_id BIGINT UNSIGNED NULL AFTER booking_id,
  ADD KEY idx_pt_kitchen (kitchen_order_id),
  ADD CONSTRAINT fk_pt_kitchen FOREIGN KEY (kitchen_order_id) REFERENCES kitchen_orders(id);

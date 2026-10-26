-- Jojo Market: addresses, markets, catalogue, bookings, payments, shopping, reconciliation, lists, restocking
-- Money is DECIMAL(12,2) in naira. Never FLOAT.

ALTER TABLE customer_profiles
  ADD COLUMN household_size TINYINT UNSIGNED NULL AFTER notification_preferences,
  ADD COLUMN reminder_lead_days TINYINT UNSIGNED NOT NULL DEFAULT 3 AFTER household_size,
  ADD COLUMN restock_reminders_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER reminder_lead_days;

-- Key/value business settings (operations, pricing, base location, payments, restocking)
CREATE TABLE IF NOT EXISTS service_settings (
  setting_key  VARCHAR(60) PRIMARY KEY,
  value_json   JSON NOT NULL,
  updated_by   BIGINT UNSIGNED NULL,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_settings_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Lagos neighbourhoods with approximate centre points. Used for transport estimates,
-- so we never need a customer's exact GPS location.
CREATE TABLE IF NOT EXISTS areas (
  id      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name    VARCHAR(80) NOT NULL,
  lga     VARCHAR(80) NULL,
  state   VARCHAR(40) NOT NULL DEFAULT 'Lagos',
  lat     DECIMAL(9,6) NOT NULL,
  lng     DECIMAL(9,6) NOT NULL,
  active  TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_areas_name (name, state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_addresses (
  id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id           BIGINT UNSIGNED NOT NULL,
  label                 VARCHAR(40) NOT NULL,
  recipient_name        VARCHAR(120) NOT NULL,
  recipient_phone       VARCHAR(32) NOT NULL,
  address_line          VARCHAR(255) NOT NULL,
  area_id               INT UNSIGNED NOT NULL,
  landmark              VARCHAR(160) NULL,
  delivery_instructions VARCHAR(500) NULL,
  is_default            TINYINT(1) NOT NULL DEFAULT 0,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  archived_at           DATETIME NULL,
  KEY idx_addr_customer (customer_id, archived_at),
  CONSTRAINT fk_addr_customer FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_addr_area FOREIGN KEY (area_id) REFERENCES areas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS catalog_categories (
  id      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug    VARCHAR(60) NOT NULL,
  name    VARCHAR(80) NOT NULL,
  icon    VARCHAR(16) NULL,
  sort    INT NOT NULL DEFAULT 0,
  active  TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_cat_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS markets (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug               VARCHAR(80) NOT NULL,
  name               VARCHAR(120) NOT NULL,
  area               VARCHAR(80) NOT NULL,
  city               VARCHAR(60) NOT NULL DEFAULT 'Lagos',
  lat                DECIMAL(9,6) NOT NULL,
  lng                DECIMAL(9,6) NOT NULL,
  public_description VARCHAR(500) NULL,
  open_days          JSON NOT NULL,            -- [0..6], 0 = Sunday
  opens_at           TIME NOT NULL DEFAULT '07:00:00',
  closes_at          TIME NOT NULL DEFAULT '18:00:00',
  internal_notes     VARCHAR(500) NULL,
  active             TINYINT(1) NOT NULL DEFAULT 1,
  sort               INT NOT NULL DEFAULT 0,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_market_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS market_categories (
  market_id   INT UNSIGNED NOT NULL,
  category_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (market_id, category_id),
  CONSTRAINT fk_mc_market FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE,
  CONSTRAINT fk_mc_cat FOREIGN KEY (category_id) REFERENCES catalog_categories(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS catalog_items (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  category_id         INT UNSIGNED NOT NULL,
  name                VARCHAR(120) NOT NULL,
  description         VARCHAR(500) NULL,
  search_terms        VARCHAR(255) NULL,          -- local names, e.g. "tatashe, rodo"
  allow_open_amount   TINYINT(1) NOT NULL DEFAULT 1, -- customer may just say "₦7,000 worth"
  allow_substitutions TINYINT(1) NOT NULL DEFAULT 1,
  restock_days        SMALLINT UNSIGNED NULL,     -- how long ONE standard unit lasts a household of 4
  active              TINYINT(1) NOT NULL DEFAULT 1,
  sort                INT NOT NULL DEFAULT 0,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_items_cat (category_id, active),
  CONSTRAINT fk_items_cat FOREIGN KEY (category_id) REFERENCES catalog_categories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- How an item is bought. price_type:
--   fixed = one known price for the unit (Tomatoes · Basket · ₦20,000)
--   range = varies by type/brand (Rice · Bag · Basmati ₦80,000–₦95,000)
--   none  = no reliable price; customer enters the amount to spend
CREATE TABLE IF NOT EXISTS catalog_item_options (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  item_id        INT UNSIGNED NOT NULL,
  unit_label     VARCHAR(60) NOT NULL,      -- Basket, Bag (50kg), Cup, Paint bucket, Yard
  variant        VARCHAR(80) NULL,          -- Basmati, Thai, Ofada, Honey beans
  price_type     ENUM('fixed','range','none') NOT NULL,
  price          DECIMAL(12,2) NULL,
  price_min      DECIMAL(12,2) NULL,
  price_max      DECIMAL(12,2) NULL,
  allow_quantity TINYINT(1) NOT NULL DEFAULT 1,
  is_standard    TINYINT(1) NOT NULL DEFAULT 0, -- the unit restock_days refers to
  sort           INT NOT NULL DEFAULT 0,
  active         TINYINT(1) NOT NULL DEFAULT 1,
  price_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by     BIGINT UNSIGNED NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_opt_item (item_id, active),
  CONSTRAINT fk_opt_item FOREIGN KEY (item_id) REFERENCES catalog_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_opt_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every price change is kept so old quotes can always be explained.
CREATE TABLE IF NOT EXISTS option_price_history (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  option_id   INT UNSIGNED NOT NULL,
  price_type  ENUM('fixed','range','none') NOT NULL,
  price       DECIMAL(12,2) NULL,
  price_min   DECIMAL(12,2) NULL,
  price_max   DECIMAL(12,2) NULL,
  changed_by  BIGINT UNSIGNED NULL,
  changed_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_oph_option (option_id, changed_at),
  CONSTRAINT fk_oph_option FOREIGN KEY (option_id) REFERENCES catalog_item_options(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS availability_exceptions (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  exception_date DATE NOT NULL,
  exception_type ENUM('blocked','capacity') NOT NULL,
  capacity_units SMALLINT UNSIGNED NULL,
  reason         VARCHAR(160) NULL,
  created_by     BIGINT UNSIGNED NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_exception_date (exception_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per service date, locked FOR UPDATE while reserving capacity (prevents double-booking).
CREATE TABLE IF NOT EXISTS capacity_days (
  service_date DATE PRIMARY KEY
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS bookings (
  id                     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference              VARCHAR(16) NOT NULL,
  customer_id            BIGINT UNSIGNED NOT NULL,
  market_id              INT UNSIGNED NOT NULL,
  booking_type           ENUM('full_purchase','sample_run') NOT NULL,
  status                 VARCHAR(40) NOT NULL,
  service_date           DATE NOT NULL,
  time_window            ENUM('morning','midday','afternoon') NOT NULL DEFAULT 'morning',
  delivery_required      TINYINT(1) NOT NULL DEFAULT 1,
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
  goods_estimate_min     DECIMAL(12,2) NOT NULL DEFAULT 0,
  goods_estimate_max     DECIMAL(12,2) NOT NULL DEFAULT 0,
  intended_goods_budget  DECIMAL(12,2) NOT NULL DEFAULT 0,
  authorized_goods_limit DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency               CHAR(3) NOT NULL DEFAULT 'NGN',
  customer_notes         VARCHAR(1000) NULL,
  accepted_quote_id      BIGINT UNSIGNED NULL,
  source_booking_id      BIGINT UNSIGNED NULL,
  status_reason          VARCHAR(500) NULL,
  submitted_at           DATETIME NULL,
  quoted_at              DATETIME NULL,
  accepted_at            DATETIME NULL,
  paid_at                DATETIME NULL,
  completed_at           DATETIME NULL,
  cancelled_at           DATETIME NULL,
  expires_at             DATETIME NULL,
  created_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_booking_ref (reference),
  KEY idx_booking_customer (customer_id, created_at),
  KEY idx_booking_status_date (status, service_date),
  KEY idx_booking_date (service_date),
  CONSTRAINT fk_booking_customer FOREIGN KEY (customer_id) REFERENCES users(id),
  CONSTRAINT fk_booking_market FOREIGN KEY (market_id) REFERENCES markets(id),
  CONSTRAINT fk_booking_addr FOREIGN KEY (delivery_address_id) REFERENCES customer_addresses(id) ON DELETE SET NULL,
  CONSTRAINT fk_booking_source FOREIGN KEY (source_booking_id) REFERENCES bookings(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- What the customer ASKED for (snapshot of what they saw). Not what was bought.
CREATE TABLE IF NOT EXISTS booking_items (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_id          BIGINT UNSIGNED NOT NULL,
  catalog_item_id     INT UNSIGNED NULL,
  option_id           INT UNSIGNED NULL,
  item_name           VARCHAR(120) NOT NULL,
  option_label        VARCHAR(160) NULL,
  price_type          ENUM('fixed','range','none') NOT NULL DEFAULT 'none',
  price_snapshot      DECIMAL(12,2) NULL,
  price_min_snapshot  DECIMAL(12,2) NULL,
  price_max_snapshot  DECIMAL(12,2) NULL,
  request_method      ENUM('quantity','amount') NOT NULL,
  quantity            DECIMAL(10,2) NULL,
  amount              DECIMAL(12,2) NULL,
  estimate_min        DECIMAL(12,2) NOT NULL DEFAULT 0,
  estimate_max        DECIMAL(12,2) NOT NULL DEFAULT 0,
  preferences         VARCHAR(500) NULL,
  allow_substitution  TINYINT(1) NOT NULL DEFAULT 0,
  sort                INT NOT NULL DEFAULT 0,
  KEY idx_bi_booking (booking_id),
  CONSTRAINT fk_bi_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_bi_item FOREIGN KEY (catalog_item_id) REFERENCES catalog_items(id) ON DELETE SET NULL,
  CONSTRAINT fk_bi_option FOREIGN KEY (option_id) REFERENCES catalog_item_options(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS booking_quotes (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_id         BIGINT UNSIGNED NOT NULL,
  version_number     INT UNSIGNED NOT NULL,
  goods_amount       DECIMAL(12,2) NOT NULL DEFAULT 0,  -- goods money collected upfront
  service_fee        DECIMAL(12,2) NOT NULL DEFAULT 0,
  transport_cost     DECIMAL(12,2) NOT NULL DEFAULT 0,
  other_charges      DECIMAL(12,2) NOT NULL DEFAULT 0,
  other_label        VARCHAR(120) NULL,
  upfront_amount     DECIMAL(12,2) NOT NULL,
  distance_km        DECIMAL(7,1) NULL,
  distance_method    VARCHAR(30) NULL,
  assumptions        VARCHAR(1000) NULL,
  note_to_customer   VARCHAR(1000) NULL,
  status             ENUM('proposed','accepted','superseded','rejected','expired') NOT NULL DEFAULT 'proposed',
  valid_until        DATETIME NULL,
  created_by         BIGINT UNSIGNED NOT NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at         DATETIME NULL,
  UNIQUE KEY uq_quote_version (booking_id, version_number),
  CONSTRAINT fk_quote_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_quote_user FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS booking_status_events (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_id    BIGINT UNSIGNED NOT NULL,
  from_status   VARCHAR(40) NULL,
  to_status     VARCHAR(40) NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  reason        VARCHAR(500) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_bse_booking (booking_id, created_at),
  CONSTRAINT fk_bse_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_bse_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS capacity_holds (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_id     BIGINT UNSIGNED NOT NULL,
  service_date   DATE NOT NULL,
  capacity_units SMALLINT UNSIGNED NOT NULL,
  status         ENUM('active','consumed','released','expired') NOT NULL DEFAULT 'active',
  expires_at     DATETIME NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_hold_date_status (service_date, status),
  KEY idx_hold_booking (booking_id),
  CONSTRAINT fk_hold_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Charges, refunds and credits. Never edited to "make totals match".
-- Credit balance = sum(credit_issued) - sum(credit_applied), successful only.
CREATE TABLE IF NOT EXISTS payment_transactions (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_id         BIGINT UNSIGNED NULL,
  customer_id        BIGINT UNSIGNED NOT NULL,
  provider           ENUM('paystack','manual','credit') NOT NULL,
  provider_reference VARCHAR(100) NULL,
  transaction_type   ENUM('charge','additional_charge','refund','credit_issued','credit_applied') NOT NULL,
  amount             DECIMAL(12,2) NOT NULL,
  currency           CHAR(3) NOT NULL DEFAULT 'NGN',
  status             ENUM('initiated','pending','successful','failed','cancelled') NOT NULL,
  idempotency_key    VARCHAR(100) NULL,
  payer_note         VARCHAR(255) NULL,
  verified_at        DATETIME NULL,
  verified_by        BIGINT UNSIGNED NULL,
  metadata_json      JSON NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pt_provider_ref (provider, provider_reference),
  UNIQUE KEY uq_pt_idem (idempotency_key),
  KEY idx_pt_booking (booking_id),
  KEY idx_pt_customer (customer_id, created_at),
  KEY idx_pt_status (status, provider),
  CONSTRAINT fk_pt_booking FOREIGN KEY (booking_id) REFERENCES bookings(id),
  CONSTRAINT fk_pt_customer FOREIGN KEY (customer_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Mid-shop requests that need the customer's say-so: extra spending or a substitution.
CREATE TABLE IF NOT EXISTS booking_change_requests (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_id      BIGINT UNSIGNED NOT NULL,
  request_type    ENUM('extra_spend','substitution') NOT NULL,
  booking_item_id BIGINT UNSIGNED NULL,
  description     VARCHAR(500) NOT NULL,
  extra_amount    DECIMAL(12,2) NOT NULL DEFAULT 0,
  status          ENUM('pending','approved','rejected','withdrawn') NOT NULL DEFAULT 'pending',
  customer_note   VARCHAR(500) NULL,
  created_by      BIGINT UNSIGNED NOT NULL,
  decided_by      BIGINT UNSIGNED NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at      DATETIME NULL,
  KEY idx_bcr_booking (booking_id, status),
  CONSTRAINT fk_bcr_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_bcr_item FOREIGN KEY (booking_item_id) REFERENCES booking_items(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- What was ACTUALLY bought (or, for a sample run, what was found).
CREATE TABLE IF NOT EXISTS purchase_records (
  id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_id            BIGINT UNSIGNED NOT NULL,
  operator_id           BIGINT UNSIGNED NOT NULL,
  goods_total           DECIMAL(12,2) NOT NULL DEFAULT 0,
  service_fee_actual    DECIMAL(12,2) NOT NULL DEFAULT 0,
  transport_cost_actual DECIMAL(12,2) NOT NULL DEFAULT 0,
  other_costs           DECIMAL(12,2) NOT NULL DEFAULT 0,
  other_label           VARCHAR(120) NULL,
  final_total           DECIMAL(12,2) NOT NULL DEFAULT 0,
  summary_note          VARCHAR(1000) NULL,
  internal_notes        VARCHAR(1000) NULL,
  shopping_started_at   DATETIME NULL,
  shopping_completed_at DATETIME NULL,
  delivered_at          DATETIME NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pr_booking (booking_id),
  CONSTRAINT fk_pr_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_pr_operator FOREIGN KEY (operator_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS purchase_items (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  purchase_record_id BIGINT UNSIGNED NOT NULL,
  booking_item_id    BIGINT UNSIGNED NULL,
  catalog_item_id    INT UNSIGNED NULL,
  option_id          INT UNSIGNED NULL,
  item_name          VARCHAR(120) NOT NULL,
  option_label       VARCHAR(160) NULL,
  outcome            ENUM('bought','partly','unavailable','substituted','sampled') NOT NULL DEFAULT 'bought',
  actual_quantity    DECIMAL(10,2) NULL,
  quantity_note      VARCHAR(120) NULL,   -- "about 25 pieces", "1 small basket"
  actual_amount      DECIMAL(12,2) NOT NULL DEFAULT 0,
  observed_price     DECIMAL(12,2) NULL,  -- sample runs: the price seen in the market
  notes              VARCHAR(500) NULL,
  sort               INT NOT NULL DEFAULT 0,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pi_record (purchase_record_id),
  CONSTRAINT fk_pi_record FOREIGN KEY (purchase_record_id) REFERENCES purchase_records(id) ON DELETE CASCADE,
  CONSTRAINT fk_pi_bitem FOREIGN KEY (booking_item_id) REFERENCES booking_items(id) ON DELETE SET NULL,
  CONSTRAINT fk_pi_citem FOREIGN KEY (catalog_item_id) REFERENCES catalog_items(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Receipts and photos: stored privately on Cloudinary ("authenticated"), served via short-lived signed links.
CREATE TABLE IF NOT EXISTS booking_attachments (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_id  BIGINT UNSIGNED NOT NULL,
  uploaded_by BIGINT UNSIGNED NOT NULL,
  kind        ENUM('receipt','sample_photo','item_photo','other') NOT NULL,
  public_id   VARCHAR(255) NOT NULL,
  format      VARCHAR(10) NOT NULL,
  bytes       INT UNSIGNED NOT NULL,
  caption     VARCHAR(200) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_att_booking (booking_id),
  CONSTRAINT fk_att_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS financial_reconciliations (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_id         BIGINT UNSIGNED NOT NULL,
  purchase_record_id BIGINT UNSIGNED NULL,
  quoted_total       DECIMAL(12,2) NOT NULL,
  paid_total         DECIMAL(12,2) NOT NULL,
  actual_final_total DECIMAL(12,2) NOT NULL,
  refund_due         DECIMAL(12,2) NOT NULL DEFAULT 0,
  additional_due     DECIMAL(12,2) NOT NULL DEFAULT 0,
  customer_choice    ENUM('refund','credit') NULL,
  resolution_status  ENUM('awaiting_customer','refund_pending','refunded','credited','additional_due','settled','disputed') NOT NULL,
  notes              VARCHAR(500) NULL,
  created_by         BIGINT UNSIGNED NOT NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rec_booking (booking_id),
  CONSTRAINT fk_rec_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS saved_lists (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id BIGINT UNSIGNED NOT NULL,
  name        VARCHAR(80) NOT NULL,
  market_id   INT UNSIGNED NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_sl_customer (customer_id),
  CONSTRAINT fk_sl_customer FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_sl_market FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS saved_list_items (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  saved_list_id      BIGINT UNSIGNED NOT NULL,
  catalog_item_id    INT UNSIGNED NULL,
  option_id          INT UNSIGNED NULL,
  item_name          VARCHAR(120) NOT NULL,
  request_method     ENUM('quantity','amount') NOT NULL,
  quantity           DECIMAL(10,2) NULL,
  amount             DECIMAL(12,2) NULL,
  preferences        VARCHAR(500) NULL,
  allow_substitution TINYINT(1) NOT NULL DEFAULT 0,
  sort               INT NOT NULL DEFAULT 0,
  KEY idx_sli_list (saved_list_id),
  CONSTRAINT fk_sli_list FOREIGN KEY (saved_list_id) REFERENCES saved_lists(id) ON DELETE CASCADE,
  CONSTRAINT fk_sli_item FOREIGN KEY (catalog_item_id) REFERENCES catalog_items(id) ON DELETE SET NULL,
  CONSTRAINT fk_sli_option FOREIGN KEY (option_id) REFERENCES catalog_item_options(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Restocking ESTIMATES (not inventory). option_key = option_id or 0, so the unique key works.
CREATE TABLE IF NOT EXISTS customer_item_estimates (
  id                       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id              BIGINT UNSIGNED NOT NULL,
  catalog_item_id          INT UNSIGNED NOT NULL,
  option_key               INT UNSIGNED NOT NULL DEFAULT 0,
  item_label               VARCHAR(200) NOT NULL,
  last_purchase_item_id    BIGINT UNSIGNED NULL,
  last_booking_id          BIGINT UNSIGNED NULL,
  last_purchase_date       DATE NOT NULL,
  estimated_duration_days  SMALLINT UNSIGNED NOT NULL,
  customer_adjusted        TINYINT(1) NOT NULL DEFAULT 0,
  estimated_depletion_date DATE NOT NULL,
  remind_on                DATE NOT NULL,
  customer_status          ENUM('unknown','still_available','running_low','finished') NOT NULL DEFAULT 'unknown',
  reminders_enabled        TINYINT(1) NOT NULL DEFAULT 1,
  last_reminded_at         DATETIME NULL,
  last_confirmed_at        DATETIME NULL,
  created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cie (customer_id, catalog_item_id, option_key),
  KEY idx_cie_remind (remind_on, reminders_enabled),
  CONSTRAINT fk_cie_customer FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_cie_item FOREIGN KEY (catalog_item_id) REFERENCES catalog_items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS restocking_reminders (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id        BIGINT UNSIGNED NOT NULL,
  estimate_ids_json  JSON NOT NULL,
  dedup_key          VARCHAR(190) NOT NULL,
  status             ENUM('sent','failed') NOT NULL,
  provider_message_id VARCHAR(120) NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rr_dedup (dedup_key),
  CONSTRAINT fk_rr_customer FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notification_logs (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT UNSIGNED NULL,
  booking_id   BIGINT UNSIGNED NULL,
  channel      VARCHAR(20) NOT NULL DEFAULT 'email',
  template_key VARCHAR(60) NOT NULL,
  status       ENUM('sent','failed') NOT NULL,
  provider_reference VARCHAR(120) NULL,
  error_code   VARCHAR(60) NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_nl_user (user_id, created_at),
  KEY idx_nl_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

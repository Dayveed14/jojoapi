-- Jojo Market: identity, sessions, tokens, audit
CREATE TABLE IF NOT EXISTS users (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email             VARCHAR(255) NOT NULL,
  phone             VARCHAR(32) NULL,
  password_hash     VARCHAR(255) NOT NULL,
  role              ENUM('customer','operator','helper') NOT NULL DEFAULT 'customer',
  status            ENUM('active','suspended','pending_verification') NOT NULL DEFAULT 'active',
  avatar_url        VARCHAR(512) NULL,
  avatar_public_id  VARCHAR(255) NULL,
  email_verified_at DATETIME NULL,
  token_version     INT UNSIGNED NOT NULL DEFAULT 0,
  last_login_at     DATETIME NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_phone (phone),
  KEY idx_users_role_status (role, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_profiles (
  id                       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id                  BIGINT UNSIGNED NOT NULL,
  display_name             VARCHAR(120) NOT NULL,
  preferred_contact_method ENUM('email','phone','whatsapp') NOT NULL DEFAULT 'email',
  notification_preferences JSON NULL,
  created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_profiles_user (user_id),
  CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rotating refresh tokens. Only a SHA-256 hash is stored.
-- family_id groups a rotation chain so reuse of an old token revokes the whole chain.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT UNSIGNED NOT NULL,
  family_id    CHAR(36) NOT NULL,
  token_hash   CHAR(64) NOT NULL,
  expires_at   DATETIME NOT NULL,
  revoked_at   DATETIME NULL,
  replaced_by  BIGINT UNSIGNED NULL,
  user_agent   VARCHAR(255) NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_refresh_hash (token_hash),
  KEY idx_refresh_user (user_id),
  KEY idx_refresh_family (family_id),
  CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Single-use, expiring tokens for password reset and email verification.
CREATE TABLE IF NOT EXISTS user_tokens (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  purpose     ENUM('password_reset','email_verification') NOT NULL,
  token_hash  CHAR(64) NOT NULL,
  expires_at  DATETIME NOT NULL,
  used_at     DATETIME NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_tokens_hash (token_hash),
  KEY idx_user_tokens_user_purpose (user_id, purpose),
  CONSTRAINT fk_user_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id                     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_user_id          BIGINT UNSIGNED NULL,
  action                 VARCHAR(80) NOT NULL,
  entity_type            VARCHAR(60) NULL,
  entity_id              VARCHAR(64) NULL,
  reason                 VARCHAR(255) NULL,
  redacted_metadata_json JSON NULL,
  ip_hash                CHAR(64) NULL,
  created_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_actor (actor_user_id),
  KEY idx_audit_action_created (action, created_at),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

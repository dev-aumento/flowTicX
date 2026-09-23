CREATE TABLE IF NOT EXISTS employee_invites (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  token VARCHAR(64) NOT NULL UNIQUE,
  invitedBy BIGINT UNSIGNED NOT NULL,
  department VARCHAR(100) NULL,
  status ENUM('pending', 'accepted', 'expired', 'revoked') NOT NULL DEFAULT 'pending',
  acceptedUserId BIGINT UNSIGNED NULL,
  expiresAt TIMESTAMP NOT NULL,
  acceptedAt TIMESTAMP NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_employee_invites_token (token),
  INDEX idx_employee_invites_status (status)
);

ALTER TABLE notifications
  MODIFY COLUMN type ENUM(
    'task_assigned',
    'task_updated',
    'mention',
    'deadline_reminder',
    'time_approved',
    'employee_joined'
  ) NOT NULL;

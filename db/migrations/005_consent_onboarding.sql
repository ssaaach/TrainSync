-- v3 Phase C: consent ledger, health screen, onboarding progress and the
-- profile fields onboarding collects. Additive only.

-- Append-only record of every consent decision. No foreign key on purpose: a
-- minimal withdrawal record must survive account deletion (proof that the
-- user's choice was honoured). Nothing else about the user is kept here.
CREATE TABLE IF NOT EXISTS consent_ledger (
    ledger_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    purpose ENUM('body_metrics','health','personality','interests','location','matching') NOT NULL,
    granted TINYINT(1) NOT NULL,
    policy_version VARCHAR(20) NOT NULL,
    source ENUM('onboarding','settings','deletion','synthetic','migration') NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_consent_user (user_id, purpose, ledger_id)
);

CREATE TABLE IF NOT EXISTS health_screens (
    screen_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    answers JSON NOT NULL,
    flagged TINYINT(1) NOT NULL,
    version VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_health_user (user_id, created_at),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

ALTER TABLE users ADD COLUMN onboarding_step TINYINT NOT NULL DEFAULT 0;

ALTER TABLE trainees ADD COLUMN limitations JSON NULL;
ALTER TABLE trainees ADD COLUMN health_flagged TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE trainees ADD COLUMN hobbies VARCHAR(500) NULL;
ALTER TABLE trainees ADD COLUMN interests JSON NULL;
ALTER TABLE trainees ADD COLUMN cuisines JSON NULL;
ALTER TABLE trainees ADD COLUMN food_budget_inr_per_day INT NULL;

ALTER TABLE trainers ADD COLUMN hobbies VARCHAR(500) NULL;
ALTER TABLE trainers ADD COLUMN interests JSON NULL;

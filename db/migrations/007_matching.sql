-- v3 Phase G: shortlists and session requests (the trainee asks, the trainer
-- accepts or declines; contact details unlock only after acceptance).

CREATE TABLE IF NOT EXISTS shortlists (
    user_id INT NOT NULL,
    trainer_user_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, trainer_user_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (trainer_user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS session_requests (
    request_id INT AUTO_INCREMENT PRIMARY KEY,
    trainee_user_id INT NOT NULL,
    trainer_user_id INT NOT NULL,
    session_type ENUM('in_person_gym','home','online','outdoor') NOT NULL,
    slot VARCHAR(40) NOT NULL,
    message VARCHAR(500) NULL,
    price_inr INT NULL,
    score DECIMAL(5,2) NULL,
    score_breakdown JSON NULL,
    status ENUM('pending','accepted','declined','cancelled') NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    responded_at DATETIME NULL,
    KEY idx_req_trainer (trainer_user_id, status),
    KEY idx_req_trainee (trainee_user_id, status),
    FOREIGN KEY (trainee_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (trainer_user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

ALTER TABLE users ADD COLUMN phone VARCHAR(20) NULL;

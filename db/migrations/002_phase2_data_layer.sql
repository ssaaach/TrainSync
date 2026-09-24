-- Phase 2: data layer. Additive only; existing rows are preserved.
--
-- Geo convention: lat/lng DECIMAL(9,6) are the source of truth. `geo` is a
-- STORED generated POINT (SRID 4326, built as POINT(lng, lat)) so it can carry
-- a SPATIAL INDEX without application code keeping it in sync. Spatial indexes
-- need NOT NULL, so rows without coordinates get POINT(0 0); every radius
-- query also filters `lat IS NOT NULL`.

-- ---------------------------------------------------------------- users
ALTER TABLE users ADD COLUMN is_synthetic TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN onboarding_complete TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_active_at DATETIME NULL;
ALTER TABLE users ADD COLUMN is_admin TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE users ADD INDEX idx_users_synthetic (is_synthetic);

-- ---------------------------------------------------------------- trainees
ALTER TABLE trainees ADD COLUMN sex ENUM('male','female') NULL;
ALTER TABLE trainees ADD COLUMN height_cm DECIMAL(5,1) NULL;
ALTER TABLE trainees ADD COLUMN weight_kg DECIMAL(5,1) NULL;
ALTER TABLE trainees ADD COLUMN waist_cm DECIMAL(5,1) NULL;
ALTER TABLE trainees ADD COLUMN neck_cm DECIMAL(5,1) NULL;
ALTER TABLE trainees ADD COLUMN hip_cm DECIMAL(5,1) NULL;
ALTER TABLE trainees ADD COLUMN wrist_cm DECIMAL(4,1) NULL;
ALTER TABLE trainees ADD COLUMN activity_level ENUM('sedentary','light','moderate','active','very_active') NULL;
ALTER TABLE trainees ADD COLUMN experience_level ENUM('beginner','intermediate','advanced') NULL;
ALTER TABLE trainees ADD COLUMN goal ENUM('cut','bulk','lean-bulk','maintenance') NULL;
ALTER TABLE trainees ADD COLUMN goals JSON NULL;
ALTER TABLE trainees ADD COLUMN days_per_week TINYINT NULL;
ALTER TABLE trainees ADD COLUMN session_minutes SMALLINT NULL;
ALTER TABLE trainees ADD COLUMN equipment JSON NULL;
ALTER TABLE trainees ADD COLUMN diet_pref ENUM('veg','non-veg','eggetarian','vegan','jain') NULL;
ALTER TABLE trainees ADD COLUMN allergens JSON NULL;
ALTER TABLE trainees ADD COLUMN budget_per_session_inr INT NULL;
ALTER TABLE trainees ADD COLUMN body_type ENUM('ectomorph','mesomorph','endomorph') NULL;
ALTER TABLE trainees ADD COLUMN body_type_override ENUM('ectomorph','mesomorph','endomorph') NULL;
ALTER TABLE trainees ADD COLUMN geo POINT GENERATED ALWAYS AS (ST_SRID(POINT(COALESCE(lng, 0), COALESCE(lat, 0)), 4326)) STORED NOT NULL SRID 4326;
ALTER TABLE trainees ADD SPATIAL INDEX sp_trainees_geo (geo);
ALTER TABLE trainees ADD COLUMN search_radius_km DECIMAL(4,1) NOT NULL DEFAULT 8;
ALTER TABLE trainees ADD COLUMN modality JSON NULL;
ALTER TABLE trainees ADD COLUMN languages JSON NULL;
ALTER TABLE trainees ADD COLUMN trainer_gender_pref ENUM('male','female') NULL;
ALTER TABLE trainees ADD COLUMN big5 JSON NULL;
ALTER TABLE trainees ADD COLUMN style_pref JSON NULL;
ALTER TABLE trainees ADD COLUMN schedule JSON NULL;
ALTER TABLE trainees ADD COLUMN cluster_id SMALLINT NULL;
ALTER TABLE trainees ADD COLUMN cluster_version VARCHAR(32) NULL;
ALTER TABLE trainees ADD INDEX idx_trainees_city (city);

-- ---------------------------------------------------------------- gyms
ALTER TABLE gyms MODIFY address VARCHAR(255) NULL;
ALTER TABLE gyms ADD COLUMN osm_id VARCHAR(32) NULL;
ALTER TABLE gyms ADD UNIQUE KEY uq_gyms_osm (osm_id);
ALTER TABLE gyms ADD COLUMN locality VARCHAR(150) NULL;
ALTER TABLE gyms ADD COLUMN opening_hours VARCHAR(255) NULL;
ALTER TABLE gyms ADD COLUMN amenities JSON NULL;
ALTER TABLE gyms ADD COLUMN price_tier TINYINT NULL;
ALTER TABLE gyms ADD COLUMN source ENUM('manual','osm','synthetic') NOT NULL DEFAULT 'manual';
ALTER TABLE gyms ADD COLUMN is_synthetic TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE gyms ADD COLUMN updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
ALTER TABLE gyms ADD COLUMN geo POINT GENERATED ALWAYS AS (ST_SRID(POINT(COALESCE(lng, 0), COALESCE(lat, 0)), 4326)) STORED NOT NULL SRID 4326;
ALTER TABLE gyms ADD SPATIAL INDEX sp_gyms_geo (geo);
ALTER TABLE gyms ADD INDEX idx_gyms_city (city);

-- ---------------------------------------------------------------- trainers
ALTER TABLE trainers ADD COLUMN gender ENUM('male','female','other') NULL;
ALTER TABLE trainers ADD COLUMN years_experience TINYINT NULL;
ALTER TABLE trainers ADD COLUMN certifications JSON NULL;
ALTER TABLE trainers ADD COLUMN specializations JSON NULL;
ALTER TABLE trainers ADD COLUMN best_level ENUM('beginner','intermediate','advanced') NULL;
ALTER TABLE trainers ADD COLUMN price_per_session_inr INT NULL;
ALTER TABLE trainers ADD COLUMN max_clients TINYINT NOT NULL DEFAULT 15;
ALTER TABLE trainers ADD COLUMN active_clients TINYINT NOT NULL DEFAULT 0;
ALTER TABLE trainers ADD COLUMN rating_avg DECIMAL(3,2) NULL;
ALTER TABLE trainers ADD COLUMN rating_count INT NOT NULL DEFAULT 0;
ALTER TABLE trainers ADD COLUMN bio TEXT NULL;
ALTER TABLE trainers ADD COLUMN home_gym_id INT NULL;
ALTER TABLE trainers ADD CONSTRAINT fk_trainers_home_gym FOREIGN KEY (home_gym_id) REFERENCES gyms(gym_id) ON DELETE SET NULL;
ALTER TABLE trainers ADD COLUMN travel_radius_km DECIMAL(4,1) NOT NULL DEFAULT 5;
ALTER TABLE trainers ADD COLUMN coaching_style JSON NULL;
ALTER TABLE trainers ADD COLUMN big5 JSON NULL;
ALTER TABLE trainers ADD COLUMN schedule JSON NULL;
ALTER TABLE trainers ADD COLUMN languages JSON NULL;
ALTER TABLE trainers ADD COLUMN modality JSON NULL;
ALTER TABLE trainers ADD COLUMN geo POINT GENERATED ALWAYS AS (ST_SRID(POINT(COALESCE(lng, 0), COALESCE(lat, 0)), 4326)) STORED NOT NULL SRID 4326;
ALTER TABLE trainers ADD SPATIAL INDEX sp_trainers_geo (geo);
ALTER TABLE trainers ADD COLUMN cluster_id SMALLINT NULL;
ALTER TABLE trainers ADD COLUMN cluster_version VARCHAR(32) NULL;
ALTER TABLE trainers ADD INDEX idx_trainers_city (city);

-- ---------------------------------------------------------------- reference data
CREATE TABLE IF NOT EXISTS localities (
    locality_id INT AUTO_INCREMENT PRIMARY KEY,
    city VARCHAR(100) NOT NULL,
    name VARCHAR(150) NOT NULL,
    lat DECIMAL(9,6) NOT NULL,
    lng DECIMAL(9,6) NOT NULL,
    osm_id VARCHAR(32) NULL,
    source VARCHAR(40) NOT NULL,
    UNIQUE KEY uq_localities (city, name)
);

CREATE TABLE IF NOT EXISTS exercises (
    exercise_id INT AUTO_INCREMENT PRIMARY KEY,
    ext_id VARCHAR(120) NOT NULL,
    name VARCHAR(200) NOT NULL,
    force_type VARCHAR(20) NULL,
    level ENUM('beginner','intermediate','expert') NULL,
    mechanic ENUM('compound','isolation') NULL,
    equipment VARCHAR(40) NULL,
    category VARCHAR(40) NULL,
    primary_muscles JSON NULL,
    secondary_muscles JSON NULL,
    instructions JSON NULL,
    images JSON NULL,
    movement_pattern ENUM('squat','hinge','push-h','push-v','pull-h','pull-v','lunge','carry','core','cardio','isolation','mobility') NULL,
    is_compound TINYINT(1) NOT NULL DEFAULT 0,
    source VARCHAR(40) NOT NULL DEFAULT 'free-exercise-db',
    is_synthetic TINYINT(1) NOT NULL DEFAULT 0,
    UNIQUE KEY uq_exercises_ext (ext_id),
    KEY idx_exercises_pattern (movement_pattern, equipment, level)
);

-- Nutrients per 100 g.
CREATE TABLE IF NOT EXISTS foods (
    food_id INT AUTO_INCREMENT PRIMARY KEY,
    fdc_id INT NULL,
    ingredient_key VARCHAR(60) NULL,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NULL,
    kcal DECIMAL(6,1) NOT NULL,
    protein_g DECIMAL(5,2) NOT NULL,
    carbs_g DECIMAL(5,2) NOT NULL,
    fat_g DECIMAL(5,2) NOT NULL,
    fiber_g DECIMAL(5,2) NULL,
    source VARCHAR(40) NOT NULL,
    is_synthetic TINYINT(1) NOT NULL DEFAULT 0,
    UNIQUE KEY uq_foods_fdc (fdc_id),
    UNIQUE KEY uq_foods_key (ingredient_key)
);

-- Macros are computed from dish_ingredients x foods (never hand-entered).
CREATE TABLE IF NOT EXISTS dishes (
    dish_id INT AUTO_INCREMENT PRIMARY KEY,
    slug VARCHAR(80) NOT NULL,
    name VARCHAR(150) NOT NULL,
    diet_pref ENUM('veg','non-veg','eggetarian','vegan','jain') NOT NULL,
    meal_slots JSON NOT NULL,
    allergens JSON NOT NULL,
    prep_minutes SMALLINT NULL,
    serving_g DECIMAL(6,1) NULL,
    kcal DECIMAL(6,1) NULL,
    protein_g DECIMAL(5,1) NULL,
    carbs_g DECIMAL(5,1) NULL,
    fat_g DECIMAL(5,1) NULL,
    source VARCHAR(40) NOT NULL DEFAULT 'curated',
    is_synthetic TINYINT(1) NOT NULL DEFAULT 0,
    UNIQUE KEY uq_dishes_slug (slug)
);

CREATE TABLE IF NOT EXISTS dish_ingredients (
    dish_id INT NOT NULL,
    food_id INT NOT NULL,
    grams DECIMAL(6,1) NOT NULL,
    PRIMARY KEY (dish_id, food_id),
    FOREIGN KEY (dish_id) REFERENCES dishes(dish_id) ON DELETE CASCADE,
    FOREIGN KEY (food_id) REFERENCES foods(food_id) ON DELETE RESTRICT
);

-- ---------------------------------------------------------------- per-user history
CREATE TABLE IF NOT EXISTS body_assessments (
    assessment_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    method_version VARCHAR(32) NOT NULL,
    inputs JSON NOT NULL,
    outputs JSON NOT NULL,
    dominant_type ENUM('ectomorph','mesomorph','endomorph') NULL,
    chosen_type ENUM('ectomorph','mesomorph','endomorph') NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_body_user (user_id, created_at),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS progress_logs (
    log_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    date DATE NOT NULL,
    weight_kg DECIMAL(5,1) NULL,
    waist_cm DECIMAL(5,1) NULL,
    notes VARCHAR(500) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_progress_day (user_id, date),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_plans (
    plan_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    kind ENUM('workout','diet') NOT NULL,
    plan JSON NOT NULL,
    generator_version VARCHAR(32) NOT NULL,
    seed INT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_plans_user (user_id, kind, is_active),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workout_logs (
    log_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    plan_id INT NULL,
    exercise_id INT NULL,
    date DATE NOT NULL,
    sets TINYINT NULL,
    reps TINYINT NULL,
    load_kg DECIMAL(5,1) NULL,
    rpe DECIMAL(3,1) NULL,
    done TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_wlogs_user (user_id, date),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (plan_id) REFERENCES user_plans(plan_id) ON DELETE SET NULL,
    FOREIGN KEY (exercise_id) REFERENCES exercises(exercise_id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------- matching
CREATE TABLE IF NOT EXISTS match_interactions (
    interaction_id INT AUTO_INCREMENT PRIMARY KEY,
    actor_user_id INT NOT NULL,
    target_user_id INT NOT NULL,
    action ENUM('like','pass') NOT NULL,
    score DECIMAL(5,2) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_interaction (actor_user_id, target_user_id),
    KEY idx_interaction_target (target_user_id, action),
    FOREIGN KEY (actor_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (target_user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Old status values: pending -> pending_trainer (only trainees could request),
-- accepted -> matched, rejected -> declined. Widen, remap, then narrow.
ALTER TABLE matches MODIFY status ENUM('pending','accepted','rejected','pending_trainer','pending_trainee','matched','declined','unmatched','expired') DEFAULT 'pending_trainer';
UPDATE matches SET status = 'pending_trainer' WHERE status = 'pending';
UPDATE matches SET status = 'declined' WHERE status = 'rejected';
ALTER TABLE matches ADD COLUMN matched_at DATETIME NULL;
UPDATE matches SET matched_at = created_at, status = 'matched' WHERE status = 'accepted';
ALTER TABLE matches MODIFY status ENUM('pending_trainer','pending_trainee','matched','declined','unmatched','expired') NOT NULL DEFAULT 'pending_trainer';
ALTER TABLE matches ADD COLUMN score DECIMAL(5,2) NULL;
ALTER TABLE matches ADD COLUMN score_breakdown JSON NULL;
ALTER TABLE matches ADD COLUMN initiated_by ENUM('trainee','trainer') NULL;
ALTER TABLE matches ADD COLUMN updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
ALTER TABLE matches ADD UNIQUE KEY uq_matches_pair (trainee_id, trainer_id);
ALTER TABLE matches ADD INDEX idx_matches_status (status, updated_at);

CREATE TABLE IF NOT EXISTS notifications (
    notification_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    type VARCHAR(40) NOT NULL,
    payload JSON NULL,
    read_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_notifications_user (user_id, read_at),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS blocks (
    blocker_user_id INT NOT NULL,
    blocked_user_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (blocker_user_id, blocked_user_id),
    FOREIGN KEY (blocker_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (blocked_user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reports (
    report_id INT AUTO_INCREMENT PRIMARY KEY,
    reporter_user_id INT NOT NULL,
    reported_user_id INT NOT NULL,
    reason VARCHAR(60) NOT NULL,
    details VARCHAR(1000) NULL,
    status ENUM('open','reviewed','dismissed') NOT NULL DEFAULT 'open',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reporter_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (reported_user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Hidden generator state for synthetic users (planted archetype + latent
-- traits). Used only by ml/ evaluation; never read by the app.
CREATE TABLE IF NOT EXISTS synthetic_profiles (
    user_id INT PRIMARY KEY,
    archetype VARCHAR(64) NOT NULL,
    latent JSON NOT NULL,
    generator_version VARCHAR(32) NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

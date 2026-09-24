-- Phase 1: schema fixes. Additive only; existing rows are preserved.

-- Registration inserts only user_id into trainers/trainees, so location must
-- not block the insert in strict mode.
ALTER TABLE trainees MODIFY location VARCHAR(255) NULL DEFAULT 'Unknown';
ALTER TABLE trainers MODIFY location VARCHAR(255) NULL DEFAULT 'Unknown';

-- Geo columns (spatial POINT + index arrive in Phase 2).
ALTER TABLE trainees ADD COLUMN city VARCHAR(100) NULL;
ALTER TABLE trainees ADD COLUMN locality VARCHAR(150) NULL;
ALTER TABLE trainees ADD COLUMN lat DECIMAL(9,6) NULL;
ALTER TABLE trainees ADD COLUMN lng DECIMAL(9,6) NULL;
ALTER TABLE trainers ADD COLUMN city VARCHAR(100) NULL;
ALTER TABLE trainers ADD COLUMN locality VARCHAR(150) NULL;
ALTER TABLE trainers ADD COLUMN lat DECIMAL(9,6) NULL;
ALTER TABLE trainers ADD COLUMN lng DECIMAL(9,6) NULL;

-- The workout page renders workout.description.
ALTER TABLE workouts ADD COLUMN description TEXT NULL;

-- Reconcile gyms with what the API/UI expect. `address` stays as text;
-- links move to maps_url.
ALTER TABLE gyms ADD COLUMN email VARCHAR(255) NULL;
ALTER TABLE gyms ADD COLUMN website VARCHAR(255) NULL;
ALTER TABLE gyms ADD COLUMN maps_url VARCHAR(500) NULL;
ALTER TABLE gyms ADD COLUMN phone VARCHAR(50) NULL;
ALTER TABLE gyms ADD COLUMN lat DECIMAL(9,6) NULL;
ALTER TABLE gyms ADD COLUMN lng DECIMAL(9,6) NULL;

-- Manually entered gyms stored a Google Maps link in `address`.
UPDATE gyms SET maps_url = address WHERE maps_url IS NULL AND address LIKE 'http%';

-- TrainSync Database Schema
use TrainSync;

CREATE TABLE users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role ENUM('trainee', 'trainer') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE trainees (
    trainee_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNIQUE,
    age INT,
    gender ENUM('male', 'female', 'other'),
    fitness_goal TEXT,
    location VARCHAR(255) NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE trainers (
    trainer_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNIQUE,
    experience INT,
    certification VARCHAR(255),
    specialization TEXT,
    location VARCHAR(255) NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE matches (
    match_id INT AUTO_INCREMENT PRIMARY KEY,
    trainee_id INT,
    trainer_id INT,
    status ENUM('pending', 'accepted', 'rejected') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (trainee_id) REFERENCES trainees(trainee_id) ON DELETE CASCADE,
    FOREIGN KEY (trainer_id) REFERENCES trainers(trainer_id) ON DELETE CASCADE
);

CREATE TABLE gyms (
    gym_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    address VARCHAR(255) NOT NULL,
    city VARCHAR(100) NOT NULL,
    contact_info VARCHAR(100)
);
CREATE TABLE diets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(100) NOT NULL,
    goal ENUM('bulk', 'cut', 'lean-bulk', 'maintenance') NOT NULL,
    body_type ENUM('ectomorph', 'mesomorph', 'endomorph') NOT NULL,
    description TEXT,
    meals TEXT,
    calories INT,
    protein INT,
    carbs INT,
    fats INT
);
CREATE TABLE workouts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(100) NOT NULL,
    body_type ENUM('ectomorph', 'mesomorph', 'endomorph') NOT NULL,
    goal ENUM('cut', 'bulk', 'lean-bulk', 'maintenance') NOT NULL,
    monday TEXT,
    tuesday TEXT,
    wednesday TEXT,
    thursday TEXT,
    friday TEXT
);


-- ALTER TABLE trainers MODIFY location VARCHAR(255) DEFAULT 'Unknown'
-- ALTER TABLE trainees MODIFY location VARCHAR(255) DEFAULT 'Unknown'
-- ALTER TABLE gyms ADD COLUMN email VARCHAR(255) DEFAULT 'example@gym.com';
-- ALTER TABLE gyms ADD COLUMN website VARCHAR(255);
-- ALTER TABLE gyms ADD COLUMN image_url VARCHAR(500);



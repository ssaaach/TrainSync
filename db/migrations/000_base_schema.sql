-- Original TrainSync schema (as deployed), so a fresh database can be built
-- from migrations alone. Every statement is a no-op on the existing database.

CREATE TABLE IF NOT EXISTS users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role ENUM('trainee', 'trainer') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trainees (
    trainee_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNIQUE,
    age INT,
    gender ENUM('male', 'female', 'other'),
    fitness_goal TEXT,
    location VARCHAR(255) DEFAULT 'Unknown',
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS trainers (
    trainer_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNIQUE,
    experience INT,
    certification VARCHAR(255),
    specialization TEXT,
    location VARCHAR(255) DEFAULT 'Unknown',
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS matches (
    match_id INT AUTO_INCREMENT PRIMARY KEY,
    trainee_id INT,
    trainer_id INT,
    status ENUM('pending', 'accepted', 'rejected') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (trainee_id) REFERENCES trainees(trainee_id) ON DELETE CASCADE,
    FOREIGN KEY (trainer_id) REFERENCES trainers(trainer_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS gyms (
    gym_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    address VARCHAR(255) NOT NULL,
    city VARCHAR(100) NOT NULL,
    contact_info VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS diets (
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

CREATE TABLE IF NOT EXISTS workouts (
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

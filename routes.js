const express = require("express");
const bcrypt = require("bcrypt");
const db = require("./database");
const session = require("express-session");
const router = express.Router();

// User Registration
router.post("/register", async (req, res) => {
    const { email, name, role, password, confirmPassword } = req.body;

    if (password !== confirmPassword) {
        return res.status(400).json({ error: "Passwords do not match" });
    }

    try {
        const [rows] = await db.execute("SELECT * FROM users WHERE email = ?", [email]);
        if (rows.length > 0) {
            return res.status(400).json({ error: "Email already registered" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert into users table
        const [result] = await db.execute(
            "INSERT INTO users (email, name, role, password) VALUES (?, ?, ?, ?)", 
            [email, name, role, hashedPassword]
        );

        const userId = result.insertId;

        // Also insert into either trainers or trainees table
        if (role.toLowerCase() === "trainer") {
            await db.execute("INSERT INTO trainers (user_id) VALUES (?)", [userId]);
        } else if (role.toLowerCase() === "trainee") {
            await db.execute("INSERT INTO trainees (user_id) VALUES (?)", [userId]);
        }

        res.status(201).json({ message: "User registered successfully" });
    } catch (error) {
        console.error("❌ Error registering user:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// User Login
router.post("/login", async (req, res) => {
    const { email, password } = req.body;

    try {
        const [rows] = await db.execute("SELECT * FROM users WHERE email = ?", [email]);
        if (rows.length === 0) {
            return res.status(400).json({ error: "User not found" });
        }

        const user = rows[0];
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: "Invalid credentials" });
        }

        // Set session data
        req.session.user = { id: user.id, email: user.email, role: user.role };

        console.log("Session created:", req.session);  // Log session data

        res.status(200).json({ message: "Login successful", user: req.session.user });
    } catch (error) {
        console.error("Error during login:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// User Logout
router.get("/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error("❌ Logout Error:", err);
            return res.status(500).json({ error: "Failed to log out" });
        }
        res.clearCookie("session_cookie");
        res.status(200).json({ message: "Logged out successfully" });
    });
});

// Update the session route to:
router.get("/session", (req, res) => {
    if (req.session && req.session.user) {
        res.json({
            loggedIn: true,
            email: req.session.user.email,
            role: req.session.user.role,
            id: req.session.user.id
        });
    } else {
        res.json({ loggedIn: false });
    }
});
module.exports = router;
router.get("/gyms/:city", async (req, res) => {
    const city = req.params.city.toLowerCase(); // Normalize city name to lowercase
    console.log("Incoming Request:", req.originalUrl, "| City:", city); // better log

    try {
        const [gyms] = await db.execute("SELECT name, address, email, website FROM gyms WHERE city = ?", [city]);
        res.json(gyms);
    } catch (err) {
        console.error("Error fetching gyms:", err);
        res.status(500).json({ error: "Server error" });
    }
});
// Fetch Diet Plan based on body type and goal
router.get("/diets/:body_type/:goal", async (req, res) => {
    const { body_type, goal } = req.params;
    console.log("🔍 Diet Request:", body_type, goal);

    try {
        const [rows] = await db.execute(
            "SELECT * FROM diets WHERE body_type = ? AND goal = ?",
            [body_type.toLowerCase(), goal.toLowerCase()]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: "No diet plan found for selected criteria" });
        }

        res.json(rows[0]); // send the first matching plan
    } catch (err) {
        console.error("❌ Error fetching diet plan:", err);
        res.status(500).json({ error: "Server error while fetching diet plan" });
    }
});
// Get workout plan based on body type and goal
router.get("/workouts/:body_type/:goal", async (req, res) => {
    const { body_type, goal } = req.params;
    console.log("🔍 Workout Request:", body_type, goal);

    try {
        const [rows] = await db.execute(
            "SELECT * FROM workouts WHERE body_type = ? AND goal = ?",
            [body_type.toLowerCase(), goal.toLowerCase()]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: "No workout plan found." });
        }

        res.status(200).json(rows[0]); // Send the first match (or modify if you want multiple)
    } catch (error) {
        console.error("❌ Error fetching workout:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});
router.post("/update-profile", (req, res) => {
    const userId = req.session.userId;
    const role = req.session.role;
  
    if (!userId || !role) {
      return res.status(401).json({ message: "Not logged in" });
    }
  
    const {
      experience,
      certification,
      specialization,
      location,
      age,
      gender,
      goal
    } = req.body;
  
    if (role === "trainer") {
      const sql = `
        UPDATE trainers
        SET experience = ?, certification = ?, specialization = ?, location = ?
        WHERE user_id = ?
      `;
      db.query(sql, [experience, certification, specialization, location, userId], (err, result) => {
        if (err) {
          console.error("Trainer update error:", err);
          return res.status(500).json({ message: "Internal server error" });
        }
        res.json({ message: "Trainer profile updated successfully" });
      });
    } else if (role === "trainee") {
      const sql = `
        UPDATE trainees
        SET age = ?, gender = ?, goal = ?, location = ?
        WHERE user_id = ?
      `;
      db.query(sql, [age, gender, goal, location, userId], (err, result) => {
        if (err) {
          console.error("Trainee update error:", err);
          return res.status(500).json({ message: "Internal server error" });
        }
        res.json({ message: "Trainee profile updated successfully" });
      });
    } else {
      res.status(400).json({ message: "Invalid role" });
    }
  });
  

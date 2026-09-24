const express = require("express");
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const cors = require("cors");
const db = require("./database");
const path = require("path");
const authRoutes = require("./routes");

const app = express();
const PORT = process.env.PORT || 5000;

// ✅ CORS Configuration
app.use(cors({
  origin: ["http://localhost:5500", "http://127.0.0.1:5500"],
  credentials: true
}));

// ✅ Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Serve Static Files from `public/`
app.use(express.static(path.join(__dirname, "public")));  // 🔥 This ensures your frontend files load correctly

// ✅ Session Store
const sessionStore = new MySQLStore({}, db.pool);
app.use(session({
  secret: 'your-secret-key',  // Replace with a strong secret key
  resave: false,              // Don't resave session if it's not modified
  saveUninitialized: false,   // Don't create a session until something is stored
  cookie: {
      secure: false,          // Set to true for HTTPS
      httpOnly: true,         // Prevent JavaScript access to the cookie
      maxAge: 1000 * 60 * 60 * 24 // 1 day
  }
}));

// Debugging Requests
app.use((req, res, next) => {
  console.log(`📩 Incoming Request: ${req.method} ${req.url}`, req.body);
  next();
});

// ✅ Database Connection Test
(async () => {
  try {
    const [rows] = await db.execute("SELECT 1");
    console.log("✅ Database connected successfully!");
  } catch (err) {
    console.error("❌ Database connection error:", err);
  }
})();

// ✅ Authentication Routes
app.use("/auth", authRoutes);

// ✅ Default Route - Redirects to Home Page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "homepage.html"));
});

// ✅ Start Server
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});

app.post('/auth/session', (req, res) => {
  if (req.session && req.session.user) {
      res.json({ loggedIn: true });
  } else {
      res.json({ loggedIn: false });
  }
});
app.get("/home", (req, res) => {
  if (req.session && req.session.user) {
    res.sendFile(__dirname + "/public/homepage.html");  // ✅ serves static file through a dynamic route
  } else {
    res.redirect("/login.html");
  }
});



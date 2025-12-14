require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const QRCode = require("qrcode");

const app = express();

// ---------------- CORS ----------------
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

// ---------------- POSTGRESQL ----------------
const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});

// ---------------- JWT SECRET ----------------
const JWT_SECRET = process.env.JWT_SECRET;

// ---------------- ROOT ----------------
app.get("/", (req, res) => {
  res.json({ message: "Server is running 🚀" });
});

// ---------------- LOGIN ----------------
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1 AND password = $2",
      [email, password]
    );

    if (result.rows.length === 0)
      return res.status(401).json({ message: "Invalid email or password ❌" });

    const user = result.rows[0];
    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.json({ message: "Login successful ✅", user, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error ⚠️" });
  }
});

// ---------------- AUTH MIDDLEWARE ----------------
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token provided" });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: "Invalid token" });
    req.user = user;
    next();
  });
}

// ---------------- GET MEMBER BY ID (PUBLIC) ----------------
app.get("/members/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM members WHERE id = $1",
      [req.params.id]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ message: "Member not found" });

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error ⚠️" });
  }
});

// ---------------- REGISTER MEMBER ----------------
app.post("/register-member", authenticateToken, async (req, res) => {
  const { name, group_id, code, email } = req.body;
  if (!name || !group_id || !code || !email)
    return res.status(400).json({ message: "Missing required fields" });

  try {
    const result = await pool.query(
      `INSERT INTO members (name, group_id, code, email, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING *`,
      [name, group_id, code, email]
    );

    const member = result.rows[0];
    const qrData = JSON.stringify({
      id: member.id,
      name: member.name,
      group_id: member.group_id,
      code: member.code,
      created_at: member.created_at,
    });

    const qrCodeUrl = await QRCode.toDataURL(qrData);
    await pool.query(
      "UPDATE members SET qr_code = $1 WHERE id = $2",
      [qrCodeUrl, member.id]
    );

    res.json({ message: "Member registered ✅", member: { ...member, qr_code: qrCodeUrl } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error ⚠️" });
  }
});

// ---------------- GENERATE ALL QR ----------------
app.post("/generate-all-qr", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM members");

    for (const member of result.rows) {
      if (member.qr_code) continue;

      const qrData = JSON.stringify({
        id: member.id,
        name: member.name,
        access: member.access || false,
        group_id: member.group_id,
        code: member.code,
        created_at: member.created_at,
      });

      const qrCodeUrl = await QRCode.toDataURL(qrData);
      await pool.query(
        "UPDATE members SET qr_code = $1 WHERE id = $2",
        [qrCodeUrl, member.id]
      );
    }

    res.json({ message: "All QR codes generated ✅" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error ⚠️" });
  }
});

// ---------------- START SERVER ----------------
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

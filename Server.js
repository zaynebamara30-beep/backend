import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import QRCode from "qrcode";
import dotenv from "dotenv";
import { supabase } from "./supabaseClient.js";

dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const app = express();

/* ---------------- MIDDLEWARE ---------------- */
app.use(cors());
app.use(express.json());

/* ---------------- JWT ---------------- */
const JWT_SECRET = process.env.JWT_SECRET || "secret_key";

/* ---------------- ROOT ---------------- */
app.get("/", (req, res) => {
  res.json({ message: "Backend running  !!!!!!!!!!!!!!!!!!✅" });
});

/* ---------------- LOGIN ---------------- */
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ message: "Missing credentials" });

  try {
    const { data: users, error } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .eq("password", password)
      .limit(1);

    if (error) throw error;
    if (!users || users.length === 0)
      return res.status(401).json({ message: "Invalid login" });

    const user = users[0];
    const token = jwt.sign(
      { id: user.id, name: user.name, role: user.role },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.json({ user, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ---------------- AUTH MIDDLEWARE ---------------- */
function authenticateToken(req, res, next) {
  const auth = req.headers["authorization"];
  const token = auth && auth.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token" });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: "Invalid token" });
    req.user = user;
    next();
  });
}

/* ---------------- MEMBERS ---------------- */
app.get("/members", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("members")
      .select("id, name, group_id, has_access_today, qr_code, entered")
      .order("id");

    if (error) throw error;
    res.json(data);
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/members/:id/enter", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

  try {
    const { data, error } = await supabase
      .from("members")
      .select("has_access_today")
      .eq("id", id)
      .single();

    if (error || !data) return res.status(404).json({ message: "Member not found" });
    if (!data.has_access_today)
      return res.status(403).json({ message: "No access today" });

    await supabase.from("members").update({ entered: true }).eq("id", id);
    res.json({ success: true });
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/hisenter/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

  const { data, error } = await supabase
    .from("members")
    .select("entered")
    .eq("id", id)
    .single();

  if (error) return res.status(404).json({ message: "Member not found" });
  res.json({ entered: data.entered });
});

/* ---------------- ACCESS ---------------- */
app.post("/members/haveAccess/bulk", async (req, res) => {
  const { memberIds, accessStates } = req.body;
  if (!Array.isArray(memberIds) || memberIds.length !== accessStates.length)
    return res.status(400).json({ message: "Invalid data" });

  try {
    for (let i = 0; i < memberIds.length; i++) {
      await supabase
        .from("members")
        .update({ has_access_today: accessStates[i] })
        .eq("id", memberIds[i]);
    }
    res.json({ success: true });
  } catch {
    res.status(500).json({ message: "Bulk update failed" });
  }
});

/* ---------------- GROUPS ---------------- */
app.get("/groups", async (req, res) => {
  try {
    const { data: groups, error } = await supabase.from("groups").select("*");
    if (error) throw error;

    const result = await Promise.all(
      groups.map(async g => {
        const { data: members } = await supabase
          .from("members")
          .select("has_access_today, entered")
          .eq("group_id", g.id);

        return {
          ...g,
          membersCount: members.length,
          accessToday: members.filter(m => m.has_access_today).length,
          entered: members.filter(m => m.entered).length
        };
      })
    );

    res.json(result);
  } catch {
    res.status(500).json([]);
  }
});

/* ---------------- QR ---------------- */
app.post("/generate-all-qr", async (req, res) => {
  try {
    const { data: members } = await supabase.from("members").select("*");

    for (const m of members) {
      if (m.qr_code) continue;

      const qr = await QRCode.toDataURL(
        JSON.stringify({ id: m.id, name: m.name, group_id: m.group_id })
      );

      await supabase.from("members").update({ qr_code: qr }).eq("id", m.id);
    }

    res.json({ message: "QR generated ✅" });
  } catch {
    res.status(500).json({ message: "QR error" });
  }
});

/* ---------------- EXPORT (IMPORTANT) ---------------- */
export default app;

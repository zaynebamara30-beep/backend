// server.js
import 'dotenv/config';
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import QRCode from "qrcode";
import { createClient } from "@supabase/supabase-js";

const app = express();

/* ---------------- ENV ---------------- */
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "secret_key";

/* ---------------- SUPABASE ---------------- */
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL and SUPABASE_KEY are required in .env");
}

const supabase = createClient(supabaseUrl, supabaseKey);

/* ---------------- MIDDLEWARE ---------------- */
app.use(cors());
app.use(express.json());

/* ---------------- ROOT ---------------- */
app.get("/", (req, res) => {
  res.json({ message: "Server running 🚀" });
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

/* ---------------- AUTH ---------------- */
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/members/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

  try {
    const { data, error } = await supabase
      .from("members")
      .select("id, name, group_id, has_access_today, entered, qr_code")
      .eq("id", id)
      .single();
    if (error) return res.status(404).json({ message: "Member not found" });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/members/:id/enter", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

  try {
    const { data, error } = await supabase
      .from("members")
      .select("has_access_today")
      .eq("id", id)
      .single();

    if (error || !data) return res.status(404).json({ message: "Member not found" });
    if (!data.has_access_today) return res.status(403).json({ message: "No access today" });

    await supabase.from("members").update({ entered: true }).eq("id", id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/hisenter/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

  try {
    const { data, error } = await supabase
      .from("members")
      .select("entered")
      .eq("id", id)
      .single();

    if (error) return res.status(404).json({ message: "Member not found" });
    res.json({ entered: data.entered });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ---------------- ACCESS ---------------- */
// Bulk update
app.post("/members/haveAccess/bulk", async (req, res) => {
  const { memberIds, accessStates } = req.body;

  if (!Array.isArray(memberIds) || !Array.isArray(accessStates) || memberIds.length !== accessStates.length)
    return res.status(400).json({ message: "Invalid data" });

  try {
    await Promise.all(
      memberIds.map((id, i) =>
        supabase.from("members").update({ has_access_today: accessStates[i] }).eq("id", id)
      )
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Bulk update failed" });
  }
});

// Single toggle
app.post("/members/haveAccess/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

  try {
    const { data } = await supabase.from("members").select("has_access_today").eq("id", id).single();
    const newAccess = !data.has_access_today;

    await supabase.from("members").update({ has_access_today: newAccess }).eq("id", id);
    res.json({ success: true, has_access_today: newAccess });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Update failed" });
  }
});

/* ---------------- GROUPS ---------------- */
app.get("/groups", async (req, res) => {
  try {
    const { data: groups } = await supabase.from("groups").select("*").order("id");

    const result = await Promise.all(
      groups.map(async (g) => {
        const { data: members } = await supabase
          .from("members")
          .select("id, name, has_access_today, entered, qr_code")
          .eq("group_id", g.id);

        return {
          id: g.id,
          name: g.name,
          membersCount: members.length,
          accessToday: members.filter(m => m.has_access_today).length,
          entered: members.filter(m => m.entered).length,
          memberDetails: members
        };
      })
    );

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
});

app.get("/my-groups/:userId", async (req, res) => {
  const userId = parseInt(req.params.userId);
  if (isNaN(userId)) return res.status(400).json({ message: "Invalid userId" });

  try {
    const { data: groups } = await supabase.from("groups").select("*").eq("leader_id", userId);

    const result = await Promise.all(
      groups.map(async (g) => {
        const { data: members } = await supabase
          .from("members")
          .select("id, name, has_access_today, entered")
          .eq("group_id", g.id);
        return { ...g, members };
      })
    );

    res.json({ groups: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ---------------- ADD MEMBER TO GROUP ---------------- */
app.post("/groups/addmembers", async (req, res) => {
  const { groupId, name } = req.body;
  if (!name || !groupId) return res.status(400).json({ message: "Name and groupId required" });

  try {
    const { data: newMember } = await supabase
      .from("members")
      .insert({ name, group_id: groupId, has_access_today: false, entered: false })
      .select()
      .single();

    const qrCode = await QRCode.toDataURL(JSON.stringify({
      id: newMember.id,
      name: newMember.name,
      group_id: groupId,
      access: false
    }));

    await supabase.from("members").update({ qr_code: qrCode }).eq("id", newMember.id);

    res.json({ ...newMember, qr_code: qrCode });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to add member" });
  }
});

/* ---------------- DELETE MEMBER ---------------- */
app.delete("/members/delete/:memberId", async (req, res) => {
  const memberId = parseInt(req.params.memberId);
  if (isNaN(memberId)) return res.status(400).json({ message: "Invalid memberId" });

  try {
    await supabase.from("members").delete().eq("id", memberId);
    res.json({ message: "Member deleted ✅" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete member" });
  }
});

/* ---------------- GENERATE ALL QR ---------------- */
app.post("/generate-all-qr", async (req, res) => {
  try {
    const { data: members } = await supabase.from("members").select("*");

    await Promise.all(
      members.map(async (m) => {
        if (m.qr_code) return;

        const qrCode = await QRCode.toDataURL(JSON.stringify({
          id: m.id,
          name: m.name,
          group_id: m.group_id,
          access: m.has_access_today || false
        }));

        await supabase.from("members").update({ qr_code: qrCode }).eq("id", m.id);
      })
    );

    res.json({ message: "All QR codes generated ✅" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "QR generation failed" });
  }
});

/* ---------------- 404 ---------------- */
app.use((req, res) => res.status(404).json({ message: "Route not found" }));

/* ---------------- START ---------------- */
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

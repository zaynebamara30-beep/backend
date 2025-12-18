import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// test route
app.get("/", (req, res) => {
  res.json({ message: "Backend running ✅" });
});

// your routes
// app.use("/auth", authRoutes);
// app.use("/users", userRoutes);

export default app;

import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: ["http://127.0.0.1:5173", "http://localhost:5173"] }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "VeriDesk prototype API",
    timestamp: new Date().toISOString(),
    note: "Document processing currently runs in the browser; no uploaded document is stored by this server."
  });
});

app.get("/api/demo/checklist", (_req, res) => {
  res.json({
    disclaimer: "Generic prototype checks only; not official AICTE regulatory requirements.",
    checks: [
      { id: "institution-name", label: "Institution name detected", type: "presence" },
      { id: "application-id", label: "Application ID detected", type: "presence", documentType: "application" },
      { id: "certificate-number", label: "Certificate number detected", type: "presence", documentType: "institute" },
      { id: "expiry-date", label: "Expiry date parsed and checked", type: "date" },
      { id: "cross-document-name", label: "Institution name consistency", type: "cross-document" }
    ]
  });
});

app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`VeriDesk API listening at http://127.0.0.1:${PORT}`);
});

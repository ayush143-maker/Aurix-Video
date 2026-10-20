"use strict";
const { fetchPiped, setCommonHeaders } = require("../../lib/piped");

module.exports = async function handler(req, res) {
  setCommonHeaders(res);
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }
  const id = typeof req.query.id === "string" ? req.query.id.trim() : "";
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
    return res.status(400).json({ error: "A valid 11-character video ID is required." });
  }
  try {
    const result = await fetchPiped(`/streams/${encodeURIComponent(id)}`, {
      preferred: req.query.preferred,
      validator: (data) => data && Array.isArray(data.audioStreams) && Array.isArray(data.videoStreams)
    });
    return res.status(200).json(result);
  } catch (error) {
    return res.status(502).json({ error: error.message || "No public Piped instance returned stream metadata." });
  }
};

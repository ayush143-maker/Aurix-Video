"use strict";
const { fetchPiped, setCommonHeaders } = require("../../lib/piped");

module.exports = async function handler(req, res) {
  setCommonHeaders(res);
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }
  const query = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 180) : "";
  if (!query) return res.status(400).json({ error: "A song or artist query is required." });
  try {
    const encoded = encodeURIComponent(query);
    const result = await fetchPiped(`/search?q=${encoded}&filter=music_videos`, {
      preferred: req.query.preferred,
      validator: (data) => data && Array.isArray(data.items)
    });
    return res.status(200).json(result);
  } catch (error) {
    return res.status(502).json({ error: error.message || "All public Piped instances failed." });
  }
};

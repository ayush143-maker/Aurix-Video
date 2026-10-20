"use strict";

const INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.leptons.xyz",
  "https://pipedapi.nosebs.ru",
  "https://pipedapi-libre.kavin.rocks",
  "https://piped-api.privacy.com.de",
  "https://pipedapi.adminforge.de",
  "https://api.piped.yt",
  "https://pipedapi.drgns.space",
  "https://pipedapi.owo.si",
  "https://pipedapi.ducks.party",
  "https://piped-api.codespace.cz",
  "https://pipedapi.reallyaweso.me",
  "https://api.piped.private.coffee",
  "https://pipedapi.darkness.services",
  "https://pipedapi.orangenet.cc"
];

const INSTANCE_TIMEOUT_MS = 1600;
const BATCH_SIZE = 5;

function orderInstances(preferred) {
  const normalized = String(preferred || "").replace(/\/$/, "");
  if (!INSTANCES.includes(normalized)) return INSTANCES.slice();
  return [normalized, ...INSTANCES.filter((host) => host !== normalized)];
}

async function fetchPiped(path, options = {}) {
  const validator = options.validator || ((value) => value && typeof value === "object");
  const hosts = orderInstances(options.preferred);
  for (let offset = 0; offset < hosts.length; offset += BATCH_SIZE) {
    const batch = hosts.slice(offset, offset + BATCH_SIZE);
    const controllers = [];
    const attempts = batch.map(async (host) => {
      // Each request gets its own timeout controller; a winner aborts the remaining attempts.
      const controller = new AbortController();
      controllers.push(controller);
      const timeout = setTimeout(() => controller.abort(), INSTANCE_TIMEOUT_MS);
      try {
        const response = await fetch(host + path, {
          method: "GET",
          signal: controller.signal,
          headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 AurixPlayer/1.0" }
        });
        if (!response.ok) throw new Error(`Upstream returned HTTP ${response.status}`);
        const data = await response.json();
        if (!validator(data)) throw new Error("Unexpected Piped response format");
        return { data, host };
      } finally {
        clearTimeout(timeout);
      }
    });
    try {
      const winner = await Promise.any(attempts);
      controllers.forEach((controller) => controller.abort());
      return winner;
    } catch (_) {
      controllers.forEach((controller) => controller.abort());
    }
  }
  throw new Error("No public Piped instance responded. Instances may be down, rate-limited, or blocking requests from Vercel.");
}

function setCommonHeaders(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

module.exports = { fetchPiped, setCommonHeaders, INSTANCES };

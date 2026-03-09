function send(res, status, payload) {
  res.status(status).json(payload);
}

export default function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "GET") {
    return send(res, 405, { error: "Method not allowed" });
  }
  return send(res, 200, {
    ok: true,
    service: "dragon-pet-api",
    hasDeepseekKey: Boolean(process.env.DEEPSEEK_API_KEY),
    timestamp: new Date().toISOString(),
  });
}

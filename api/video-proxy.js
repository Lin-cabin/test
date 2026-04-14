function send(res, status, payload) {
  res.status(status).json(payload);
}

function normalizeTasksEndpoint(url) {
  const raw = String(url || "").trim();
  if (!raw) return "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks";
  if (raw.includes("/contents/generations/tasks")) return raw.replace(/\/+$/, "");
  if (raw.endsWith("/api/v3")) return `${raw}/contents/generations/tasks`;
  return `${raw.replace(/\/+$/, "")}/api/v3/contents/generations/tasks`;
}

function buildTaskStatusUrl(endpoint, taskId) {
  return `${normalizeTasksEndpoint(endpoint)}/${encodeURIComponent(taskId)}`;
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function parseInteger(value, fallback) {
  const num = Number.parseInt(value, 10);
  return Number.isFinite(num) ? num : fallback;
}

function collectVideoUrls(input, acc = []) {
  if (!input) return acc;

  if (typeof input === "string") {
    const text = input.trim();
    if (/^https?:\/\//i.test(text) && /(\.mp4|\.mov|\.webm)(\?|$)/i.test(text)) {
      acc.push(text);
    }
    return acc;
  }

  if (Array.isArray(input)) {
    input.forEach((item) => collectVideoUrls(item, acc));
    return acc;
  }

  if (typeof input === "object") {
    for (const [key, value] of Object.entries(input)) {
      if (typeof value === "string") {
        const text = value.trim();
        if (/^https?:\/\//i.test(text) && (key.toLowerCase().includes("video") || /(\.mp4|\.mov|\.webm)(\?|$)/i.test(text))) {
          acc.push(text);
        }
      } else {
        collectVideoUrls(value, acc);
      }
    }
  }

  return acc;
}

function normalizeTaskResult(data) {
  const payload = data && typeof data === "object" && data.data && typeof data.data === "object" ? data.data : data;
  const urls = collectVideoUrls(payload);

  return {
    taskId: String(payload?.id || payload?.task_id || "").trim(),
    status: String(payload?.status || payload?.task_status || payload?.state || "").trim(),
    videoUrl: urls[0] || "",
    raw: data,
  };
}

function buildCreatePayload(body) {
  const prompt = String(body.prompt || "").trim();
  const imageUrl = String(body.imageUrl || body.referenceImageUrl || "").trim();
  const content = [];

  if (prompt) {
    content.push({ type: "text", text: prompt });
  }

  if (imageUrl) {
    content.push({
      type: "image_url",
      image_url: {
        url: imageUrl,
      },
    });
  }

  if (content.length === 0) {
    throw new Error("至少需要提供提示词或首帧图片");
  }

  const payload = {
    model: String(body.model || "").trim() || "doubao-seedance-1-5-pro-251215",
    content,
    duration: parseInteger(body.duration, 5),
    generate_audio: parseBoolean(body.generateAudio, true),
    watermark: parseBoolean(body.watermark, false),
    return_last_frame: parseBoolean(body.returnLastFrame, false),
  };

  if (typeof body.draft === "boolean") {
    payload.draft = body.draft;
  }

  // 图生视频时通常不支持设置分辨率和比例等参数，仅在文生视频时添加
  if (!imageUrl) {
    const resolution = String(body.resolution || "").trim();
    if (resolution) payload.resolution = resolution;
    
    const ratio = String(body.ratio || "").trim();
    if (ratio && ratio !== "adaptive") {
      payload.ratio = ratio;
    }
    if (typeof body.cameraFixed === "boolean") {
      payload.camera_fixed = body.cameraFixed;
    }
  }

  const callbackUrl = String(body.callbackUrl || "").trim();
  if (callbackUrl) payload.callback_url = callbackUrl;

  const serviceTier = String(body.serviceTier || "").trim();
  if (serviceTier) payload.service_tier = serviceTier;

  const safetyIdentifier = String(body.safetyIdentifier || "").trim();
  if (safetyIdentifier) payload.safety_identifier = safetyIdentifier;

  return payload;
}

async function parseJsonResponse(resp) {
  const raw = await resp.text();
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    data = {};
  }
  return { raw, data };
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return send(res, 405, { error: "Method not allowed" });
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const provider = String(body.provider || "ark").trim();
  const action = String(body.action || "create").trim();
  const endpoint = normalizeTasksEndpoint(body.endpoint || process.env.ARK_VIDEO_API_URL || "");
  const apiKey = String(body.apiKey || process.env.ARK_API_KEY || "").trim();

  if (provider !== "ark") {
    return send(res, 400, { error: "当前代理仅支持火山方舟视频任务接口" });
  }

  if (!apiKey) {
    return send(res, 400, { error: "缺少 ARK API Key" });
  }

  try {
    if (action === "create") {
      const payload = buildCreatePayload(body);
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      const { raw, data } = await parseJsonResponse(resp);
      if (!resp.ok) {
        let errorText = data?.error?.message || data?.message || data?.error || raw.slice(0, 500);
        const errorCode = data?.error?.code || data?.code;
        if (errorCode === "InputTextSensitiveContentDetected") {
          errorText = `输入文本包含敏感内容，请修改文案 (${errorText})`;
        }
        return send(res, resp.status, { error: `火山方舟创建任务失败：${errorText}` });
      }

      const taskId = String(data?.id || data?.data?.id || "").trim();
      if (!taskId) {
        return send(res, 502, { error: "创建任务成功，但未返回任务 ID", raw: data });
      }

      return send(res, 200, { taskId, raw: data });
    }

    if (action === "status") {
      const taskId = String(body.taskId || "").trim();
      if (!taskId) {
        return send(res, 400, { error: "缺少 taskId" });
      }

      const resp = await fetch(buildTaskStatusUrl(endpoint, taskId), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      const { raw, data } = await parseJsonResponse(resp);
      if (!resp.ok) {
        const errorText = data?.error?.message || data?.message || data?.error || raw.slice(0, 500);
        return send(res, resp.status, { error: `火山方舟查询任务失败：${errorText}` });
      }

      return send(res, 200, normalizeTaskResult(data));
    }

    return send(res, 400, { error: `不支持的 action：${action}` });
  } catch (error) {
    return send(res, 502, { error: `代理请求失败：${error?.message || String(error)}` });
  }
}
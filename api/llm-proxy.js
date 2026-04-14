function send(res, status, payload) {
  res.status(status).json(payload);
}

function buildChatCompletionsUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "https://api.deepseek.com/chat/completions";
  if (raw.endsWith("/chat/completions")) return raw;
  if (raw.endsWith("/v1")) return `${raw}/chat/completions`;
  return `${raw.replace(/\/+$/, "")}/chat/completions`;
}

function buildAnthropicUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "https://api.anthropic.com/v1/messages";
  if (raw.endsWith("/messages")) return raw;
  return `${raw.replace(/\/+$/, "")}/v1/messages`;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return send(res, 405, { error: "Method not allowed" });
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const provider = String(body.provider || "").trim();
  const apiKey = String(body.apiKey || "").trim();
  const endpoint = String(body.endpoint || "").trim();
  const model = String(body.model || "").trim();
  const prompt = String(body.prompt || "").trim();

  if (!apiKey) {
    return send(res, 400, { error: "缺少 API Key" });
  }

  if (!prompt) {
    return send(res, 400, { error: "缺少 prompt" });
  }

  try {
    // OpenAI 兼容接口（OpenAI、DeepSeek 等）
    if (provider === "openai" || provider === "deepseek" || provider === "custom") {
      const modelName = model || (provider === "deepseek" ? "deepseek-chat" : "gpt-3.5-turbo");
      const endpointUrl = endpoint || (provider === "deepseek" ? "https://api.deepseek.com" : "https://api.openai.com/v1");

      const payload = {
        model: modelName,
        messages: [
          { role: "system", content: "你是一个专门生成短视频文案的AI。请严格遵守用户的全部要求（特别是字数限制和条数），直接输出最终文案。不要包含任何废话、问候、解释或复杂的格式前缀。" },
          { role: "user", content: prompt }
        ],
        stream: false,
      };

      const resp = await fetch(buildChatCompletionsUrl(endpointUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      const raw = await resp.text();
      let data = {};
      try {
        data = JSON.parse(raw);
      } catch {
        data = {};
      }

      if (!resp.ok) {
        const errorText = data?.error?.message || data?.error || raw.slice(0, 500);
        return send(res, resp.status, { error: `${provider} 接口返回错误：${errorText}` });
      }

      const content = String(data?.choices?.[0]?.message?.content || "").trim();
      if (!content) {
        return send(res, 502, { error: `${provider} 返回内容为空` });
      }

      return send(res, 200, { content, raw: data });
    }

    // Claude 接口
    if (provider === "claude") {
      const modelName = model || "claude-3-5-sonnet-latest";
      const endpointUrl = endpoint || "https://api.anthropic.com/v1/messages";

      const payload = {
        model: modelName,
        system: "你是一个专门生成短视频文案的AI。请严格遵守用户的全部要求（特别是字数限制和条数），直接输出最终文案。不要包含任何废话、问候、解释或复杂的格式前缀。",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1024,
      };

      const resp = await fetch(buildAnthropicUrl(endpointUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(payload),
      });

      const raw = await resp.text();
      let data = {};
      try {
        data = JSON.parse(raw);
      } catch {
        data = {};
      }

      if (!resp.ok) {
        const errorText = data?.error?.message || data?.error || raw.slice(0, 500);
        return send(res, resp.status, { error: `Claude 接口返回错误：${errorText}` });
      }

      const content = String(data?.content?.[0]?.text || "").trim();
      if (!content) {
        return send(res, 502, { error: "Claude 返回内容为空" });
      }

      return send(res, 200, { content, raw: data });
    }

    return send(res, 400, { error: `不支持的 provider：${provider}` });
  } catch (error) {
    return send(res, 502, { error: `代理请求失败：${error?.message || String(error)}` });
  }
}

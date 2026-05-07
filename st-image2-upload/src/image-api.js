const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-image-2";
const SIZE_BY_RESOLUTION = {
  "1k": {
    square: "1024x1024",
    landscape: "1536x1024",
    portrait: "1024x1536",
  },
  "2k": {
    square: "2048x2048",
    landscape: "2560x1440",
    portrait: "1440x2560",
  },
  "4k": {
    landscape: "3840x2160",
    portrait: "2160x3840",
  },
};
const STREAM_MAX_WAIT_MS = 8 * 60 * 1000;
const STREAM_HEARTBEAT_MS = 10 * 1000;
const STREAM_RETRY_DELAY_MS = 2 * 1000;
const STREAM_MAX_ATTEMPTS = 3;

class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function cleanBaseUrl(baseUrl) {
  const raw = String(baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(raw)) {
    throw new AppError("接口地址必须以 http:// 或 https:// 开头");
  }
  return raw;
}

function pickSize(input) {
  if (input.size) return String(input.size);
  const resolution = String(input.resolution || "1k").toLowerCase();
  const aspect = String(input.aspect || "landscape");
  return SIZE_BY_RESOLUTION[resolution]?.[aspect] || SIZE_BY_RESOLUTION["1k"].landscape;
}

function imageToDataUrl(image) {
  if (!image?.buffer) return "";
  const buffer = Buffer.isBuffer(image.buffer) ? image.buffer : Buffer.from(image.buffer);
  const mime = image.type || "image/png";
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

function buildOpenAIRequest(input) {
  const prompt = String(input.prompt || "").trim();
  if (!prompt) throw new AppError("请输入提示词");

  const body = {
    model: String(input.model || DEFAULT_MODEL).trim(),
    prompt,
    size: pickSize(input),
    quality: String(input.quality || "high"),
    output_format: String(input.outputFormat || input.output_format || "png"),
    background: String(input.background || "auto"),
  };

  return {
    apiKey: String(input.apiKey || "").trim(),
    baseUrl: cleanBaseUrl(input.baseUrl),
    mode: String(input.mode || "text"),
    image: input.image || null,
    body,
  };
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function normalizeImages(payload) {
  return Array.isArray(payload.data)
    ? payload.data.map((item) => ({
        b64Json: item.b64_json,
        url: item.url,
        revisedPrompt: item.revised_prompt,
      }))
    : [];
}

function resultFromPayload(payload, body) {
  const images = normalizeImages(payload);
  if (images.length === 0) throw new AppError("接口已返回，但没有图片数据", 502);

  return {
    images,
    model: body.model,
    size: body.size,
    quality: body.quality,
    outputFormat: body.output_format,
    usage: payload.usage || null,
  };
}

async function readSseEvents(response, onEvent) {
  const reader = response.body?.getReader?.();
  if (!reader) return [];

  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const chunks = buffer.split(/\r?\n\r?\n/);
    buffer = chunks.pop() || "";
    for (const chunk of chunks) {
      for (const event of parseSseChunk(chunk)) {
        events.push(event);
        if (event.type === "image_generation.partial_image" && event.b64_json) {
          onEvent?.({
            type: "partial",
            image: { b64Json: event.b64_json },
            partialImageIndex: event.partial_image_index ?? null,
          });
        }
      }
    }
    if (done) break;
  }
  if (buffer.trim()) {
    for (const event of parseSseChunk(buffer)) {
      events.push(event);
      if (event.type === "image_generation.partial_image" && event.b64_json) {
        onEvent?.({
          type: "partial",
          image: { b64Json: event.b64_json },
          partialImageIndex: event.partial_image_index ?? null,
        });
      }
    }
  }
  return events;
}

function parseSseChunk(chunk) {
  const data = chunk
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  if (!data || data === "[DONE]") return [];
  return [JSON.parse(data)];
}

function resultFromStreamingEvents(events, body) {
  const candidates = [...events].reverse();
  let completed = null;
  let fallbackUsed = null;
  for (const event of candidates) {
    if (event.type === "image_generation.partial_image") continue;
    completed = extractImageCandidate(event);
    if (completed) break;
  }
  if (!completed) {
    const partial = candidates.find((event) => event.type === "image_generation.partial_image");
    completed = extractImageCandidate(partial);
    fallbackUsed = completed ? "partial" : null;
  }
  if (!completed) throw new AppError("上游没有返回最终图片，也没有可用的预览图。请重试一次。", 502);

  const result = {
    images: [
      {
        b64Json: completed.b64_json,
        url: completed.url,
        revisedPrompt: completed.revised_prompt,
      },
    ],
    model: body.model,
    size: body.size,
    quality: body.quality,
    outputFormat: body.output_format,
    usage: completed.usage || null,
  };
  if (fallbackUsed) result.fallbackUsed = fallbackUsed;
  return result;
}

function extractImageCandidate(event) {
  if (!event) return null;
  if (event.b64_json || event.url) return event;
  if (event.image?.b64_json || event.image?.url) return event.image;
  if (event.result?.b64_json || event.result?.url) return event.result;
  if (Array.isArray(event.data) && event.data[0]?.b64_json) return event.data[0];
  if (event.data?.b64_json || event.data?.url) return event.data;
  if (event.output?.b64_json || event.output?.url) return event.output;
  return null;
}

async function handleGenerateImage(input, options = {}) {
  const { apiKey, baseUrl, mode, image, body } = buildOpenAIRequest(input || {});
  if (!apiKey) throw new AppError("请输入 API 密钥", 400);

  const fetchImpl = options.fetchImpl || fetch;
  const signal = options.signal;
  const requestBody = { ...body };
  if (mode === "image") {
    if (!image?.buffer) throw new AppError("请上传参考图片", 400);
    requestBody.image = imageToDataUrl(image);
  }
  const response = await fetchImpl(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
    signal,
  });

  const payload = await readJson(response);
  if (!response.ok) {
    const message = payload.error?.message || payload.error || `OpenAI 请求失败，HTTP ${response.status}`;
    throw new AppError(message, response.status || 500);
  }

  return resultFromPayload(payload, body);
}

async function handleGenerateImageStreaming(input, options = {}) {
  const { apiKey, baseUrl, mode, body } = buildOpenAIRequest(input || {});
  if (!apiKey) throw new AppError("请输入 API 密钥", 400);
  if (mode === "image") return handleGenerateImage(input, options);

  const response = await (options.fetchImpl || fetch)(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...body,
      stream: true,
      partial_images: 1,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const payload = await readJson(response);
    const message = payload.error?.message || payload.error || `OpenAI 请求失败，HTTP ${response.status}`;
    throw new AppError(message, response.status || 500);
  }

  const contentType = response.headers?.get?.("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    const events = await readSseEvents(response, options.onEvent);
    return resultFromStreamingEvents(events, body);
  }

  return resultFromPayload(await readJson(response), body);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function streamGenerateImage(input, options = {}) {
  const onEvent = options.onEvent;
  if (typeof onEvent !== "function") throw new AppError("缺少流式输出处理器", 500);

  const maxWaitMs = options.maxWaitMs ?? STREAM_MAX_WAIT_MS;
  const heartbeatMs = options.heartbeatMs ?? STREAM_HEARTBEAT_MS;
  const retryDelayMs = options.retryDelayMs ?? STREAM_RETRY_DELAY_MS;
  const maxAttempts = options.maxAttempts ?? STREAM_MAX_ATTEMPTS;
  const sleepImpl = options.sleep || sleep;
  const now = options.now || Date.now;
  const startedAt = now();
  let attempt = 1;
  let abortController = new AbortController();

  onEvent({ type: "progress", elapsedMs: 0 });

  let task = handleGenerateImageStreaming(input, {
    ...options,
    signal: abortController.signal,
    onEvent,
  })
    .then((data) => ({ ok: true, data }))
    .catch((error) => ({ ok: false, error }));

  while (now() - startedAt < maxWaitMs) {
    const waitMs = Math.min(heartbeatMs, Math.max(0, maxWaitMs - (now() - startedAt)));
    const outcome = await Promise.race([task, sleepImpl(waitMs).then(() => null)]);
    const elapsedMs = now() - startedAt;

    if (outcome?.ok) {
      onEvent({ type: "done", data: { ...outcome.data, durationMs: Math.max(0, elapsedMs) } });
      return;
    }

    if (outcome && !outcome.ok) {
      const status = outcome.error.status || 500;
      const retryable = status === 408 || status === 429 || status === 524 || status >= 500;
      if (retryable && attempt < maxAttempts && elapsedMs < maxWaitMs) {
        attempt += 1;
        onEvent({
          type: "retry",
          attempt,
          elapsedMs,
          error: "连接中途断开，正在自动重试。",
        });
        await sleepImpl(retryDelayMs);
        abortController = new AbortController();
        task = handleGenerateImageStreaming(input, {
          ...options,
          signal: abortController.signal,
          onEvent,
        })
          .then((data) => ({ ok: true, data }))
          .catch((error) => ({ ok: false, error }));
        continue;
      }

      const message =
        status === 524
          ? "生成时间较长，连接被中途断开。系统已自动重试，仍未成功。"
          : outcome.error.message || "生成失败";
      onEvent({ type: "error", status, error: message, durationMs: Math.max(0, elapsedMs) });
      return;
    }

    if (elapsedMs < maxWaitMs) {
      onEvent({ type: "progress", elapsedMs });
    }
  }

  const durationMs = Math.max(0, now() - startedAt);
  onEvent({
    type: "error",
    status: 504,
    error: "生成超过 8 分钟仍未完成，请稍后重试或降低画面复杂度。",
    durationMs,
  });
  abortController.abort();
}

async function getPublicSettings() {
  return {
    baseUrl: DEFAULT_BASE_URL,
    model: DEFAULT_MODEL,
  };
}

module.exports = {
  AppError,
  buildOpenAIRequest,
  getPublicSettings,
  handleGenerateImage,
  streamGenerateImage,
};

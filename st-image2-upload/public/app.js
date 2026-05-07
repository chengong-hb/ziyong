const $ = (id) => document.getElementById(id);

function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem("image2-history") || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    localStorage.removeItem("image2-history");
    return [];
  }
}

const state = {
  currentImage: null,
  currentRecord: null,
  history: loadHistory(),
};

const aspectLabels = {
  square: "方图",
  landscape: "横图",
  portrait: "竖图",
};

const sizeByResolution = {
  "1k": {
    square: [1024, 1024],
    landscape: [1536, 1024],
    portrait: [1024, 1536],
  },
  "2k": {
    square: [2048, 2048],
    landscape: [2560, 1440],
    portrait: [1440, 2560],
  },
  "4k": {
    landscape: [3840, 2160],
    portrait: [2160, 3840],
  },
};

const fileFormats = {
  png: { mime: "image/png", extension: "png", label: "png" },
  jpeg: { mime: "image/jpeg", extension: "jpg", label: "jpeg" },
  webp: { mime: "image/webp", extension: "webp", label: "webp" },
};

function showError(message) {
  $("error").hidden = !message;
  $("error").textContent = message || "";
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return `${minutes}分${String(seconds).padStart(2, "0")}秒`;
  return `${seconds}秒`;
}

function setSettingsStatus(message) {
  $("settingsStatus").textContent = message;
}

function openLightbox(src) {
  if (!src) return;
  $("lightboxImage").src = src;
  $("lightbox").hidden = false;
  document.body.classList.add("lightboxOpen");
}

function closeLightbox() {
  $("lightbox").hidden = true;
  $("lightboxImage").removeAttribute("src");
  document.body.classList.remove("lightboxOpen");
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    if (/^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text)) {
      throw new Error("服务器返回了网页，不是生图接口结果。请关闭旧窗口，重新双击 ST 启动，并使用最新外网链接。");
    }
    throw new Error("服务器返回内容不是 JSON，请重新启动 ST 后再试。");
  }
}

async function loadServerSettings() {
  try {
    const response = await fetch("/api/settings");
    const settings = await readJsonResponse(response);
    if (!response.ok) throw new Error(settings.error || "读取配置失败");
    $("baseUrl").value = settings.baseUrl || $("baseUrl").value;
    $("model").value = settings.model || $("model").value;
    const savedKey = localStorage.getItem("image2-api-key") || "";
    if (savedKey) {
      $("apiKey").value = savedKey;
      $("rememberApiKey").checked = true;
      setSettingsStatus("已从本机浏览器读取 API 密钥");
    } else {
      setSettingsStatus("API 密钥只用于本次请求；勾选后只保存在当前浏览器。");
    }
  } catch (error) {
    setSettingsStatus(error.message || "读取配置失败");
  }
}

function syncRememberedApiKey() {
  if ($("rememberApiKey").checked) {
    localStorage.setItem("image2-api-key", $("apiKey").value.trim());
    setSettingsStatus("API 密钥已保存在当前浏览器");
  } else {
    localStorage.removeItem("image2-api-key");
    setSettingsStatus("API 密钥只用于本次请求；勾选后只保存在当前浏览器。");
  }
}

function setBusy(busy) {
  $("generate").disabled = busy;
  document.querySelectorAll("[data-lock]").forEach((element) => {
    element.disabled = busy;
  });
  if (busy) $("status").textContent = "正在生成...";
}

function imageSrc(image, outputFormat = "png") {
  if (!image) return "";
  const format = fileFormats[outputFormat] || fileFormats.png;
  if (image.b64Json) return `data:${format.mime};base64,${image.b64Json}`;
  return image.url || "";
}

function sizeFor(aspect, resolution) {
  return sizeByResolution[resolution]?.[aspect] || sizeByResolution["1k"].landscape;
}

function sizeTextFor(aspect, resolution) {
  return sizeFor(aspect, resolution).join("x");
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取参考图片失败，请重新选择图片"));
    reader.readAsDataURL(file);
  });
}

function createThumbnail(src, outputFormat = "png") {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const maxSide = 320;
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || maxSide, image.naturalHeight || maxSide));
      const width = Math.max(1, Math.round((image.naturalWidth || maxSide) * scale));
      const height = Math.max(1, Math.round((image.naturalHeight || maxSide) * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0, width, height);
      const format = fileFormats[outputFormat] || fileFormats.png;
      resolve(canvas.toDataURL(format.mime, 0.78));
    };
    image.onerror = () => resolve("");
    image.src = src;
  });
}

function compactHistoryRecord(record) {
  const { src, ...stored } = record;
  return stored;
}

function saveHistory() {
  try {
    const compact = state.history.slice(0, 20).map(compactHistoryRecord);
    localStorage.setItem("image2-history", JSON.stringify(compact));
    return true;
  } catch (error) {
    if (error?.name === "QuotaExceededError") {
      localStorage.removeItem("image2-history");
      showError("历史记录空间已满，已跳过本次历史保存；当前图片仍可正常保存。");
      return false;
    }
    throw error;
  }
}

function renderHistory() {
  const list = $("historyList");
  list.innerHTML = "";
  if (state.history.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "还没有记录";
    list.append(empty);
    return;
  }

  for (const record of state.history) {
    const item = document.createElement("article");
    item.className = "record";

    const image = document.createElement("img");
    image.alt = "";
    image.src = record.thumbnailSrc || record.src || "";
    image.addEventListener("dblclick", () => openLightbox(record.src || record.thumbnailSrc));
    item.append(image);

    const prompt = document.createElement("p");
    prompt.textContent = record.prompt;
    item.append(prompt);

    const actions = document.createElement("div");
    actions.className = "recordActions";
    const reuse = document.createElement("button");
    reuse.type = "button";
    reuse.textContent = "复用";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "删除";
    actions.append(reuse, remove);
    item.append(actions);

    reuse.addEventListener("click", () => {
      $("prompt").value = record.prompt;
      $("aspect").value = record.aspect;
      $("resolution").value = record.resolution || "1k";
      $("outputFormat").value = record.outputFormat || "png";
      if (record.src) {
        showImage(record.src, record);
      } else {
        showError("历史记录只保留缩略图，不能恢复原图；请重新生成或保存当前图片。");
      }
    });
    remove.addEventListener("click", () => {
      state.history = state.history.filter((entry) => entry.id !== record.id);
      saveHistory();
      renderHistory();
    });
    list.append(item);
  }
}

function showMeta(record) {
  const resolution = record.resolution || "1k";
  const outputFormat = record.outputFormat || "png";
  const target = sizeFor(record.aspect, resolution);
  $("meta").innerHTML = `
    <dt>模型</dt><dd>${record.model}</dd>
    <dt>比例</dt><dd>${aspectLabels[record.aspect] || record.aspect}</dd>
    <dt>分辨率</dt><dd>${String(resolution).toUpperCase()}</dd>
    <dt>质量</dt><dd>high</dd>
    <dt>格式</dt><dd>${outputFormat}</dd>
    <dt>预计图片尺寸</dt><dd>${target.join("x")}</dd>
    <dt>耗时</dt><dd>${formatDuration(record.durationMs)}</dd>
  `;
}

function showImage(src, record) {
  state.currentImage = src;
  state.currentRecord = record;
  $("empty").hidden = true;
  $("resultImage").hidden = false;
  $("resultImage").src = src;
  $("saveImage").hidden = false;
  showMeta(record);
}

function downloadBlob(blob, fileName) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function canvasToBlob(canvas, mime) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("保存失败，浏览器没有生成图片文件"));
      },
      mime,
      mime === "image/jpeg" ? 0.95 : undefined,
    );
  });
}

async function saveBlob(blob, fileName, format) {
  if (window.showSaveFilePicker) {
    const handle = await window.showSaveFilePicker({
      suggestedName: fileName,
      types: [
        {
          description: `${format.label.toUpperCase()} 图片`,
          accept: { [format.mime]: [`.${format.extension}`] },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }
  downloadBlob(blob, fileName);
}

async function saveCurrentImage() {
  if (!state.currentImage || !state.currentRecord) return;
  const resolution = state.currentRecord.resolution || "1k";
  const outputFormat = state.currentRecord.outputFormat || "png";
  const format = fileFormats[outputFormat] || fileFormats.png;
  const [width, height] = sizeFor(state.currentRecord.aspect, resolution);
  const image = new Image();
  image.src = state.currentImage;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (format.mime === "image/jpeg") {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, width, height);
  const blob = await canvasToBlob(canvas, format.mime);
  await saveBlob(blob, `image2-${String(resolution).toUpperCase()}-${width}x${height}.${format.extension}`, format);
}

function imageFromProxyPayload(image) {
  if (!image) return null;
  if (image.b64Json || image.url) return image;
  if (image.b64_json || image.url) return { b64Json: image.b64_json, url: image.url, revisedPrompt: image.revised_prompt };
  return null;
}

function cleanBaseUrl(baseUrl) {
  return String(baseUrl || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
}

function imageFromEvent(event) {
  if (!event) return null;
  if (event.b64_json || event.url) return { b64Json: event.b64_json, url: event.url, revisedPrompt: event.revised_prompt };
  if (event.image?.b64_json || event.image?.url) return imageFromEvent(event.image);
  if (event.result?.b64_json || event.result?.url) return imageFromEvent(event.result);
  if (Array.isArray(event.data) && event.data[0]) return imageFromEvent(event.data[0]);
  if (event.data?.b64_json || event.data?.url) return imageFromEvent(event.data);
  if (event.output?.b64_json || event.output?.url) return imageFromEvent(event.output);
  return null;
}

async function readDirectImageStream(response, onEvent) {
  if (!response.ok) {
    const text = await response.text();
    if (/^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text)) {
      throw openAIError("服务器返回了网页，不是生图接口结果。请检查接口地址是否正确。", response.status);
    }
    let errorPayload = {};
    try {
      errorPayload = text ? JSON.parse(text) : {};
    } catch {}
    throw openAIError(errorPayload.error?.message || errorPayload.error || `OpenAI 请求失败，HTTP ${response.status}`, response.status);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      if (/^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text)) {
        throw new Error("服务器返回了网页，不是生图接口结果。请检查接口地址是否正确。");
      }
      throw new Error("服务器返回内容不是 JSON，请检查接口地址后再试。");
    }
    return {
      images: Array.isArray(payload.data) ? payload.data.map(imageFromEvent).filter(Boolean) : [],
      usage: payload.usage || null,
    };
  }

  const reader = response.body.getReader();
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
        if (event.type === "image_generation.partial_image") {
          const image = imageFromEvent(event);
          if (image) onEvent({ type: "partial", image });
        }
      }
    }
    if (done) break;
  }
  if (buffer.trim()) {
    for (const event of parseSseChunk(buffer)) {
      events.push(event);
      if (event.type === "image_generation.partial_image") {
        const image = imageFromEvent(event);
        if (image) onEvent({ type: "partial", image });
      }
    }
  }

  const candidates = [...events].reverse();
  let finalImage = null;
  let fallbackUsed = null;
  for (const event of candidates) {
    if (event.type === "image_generation.partial_image") continue;
    finalImage = imageFromEvent(event);
    if (finalImage) break;
  }
  if (!finalImage) {
    const partial = candidates.find((event) => event.type === "image_generation.partial_image");
    finalImage = imageFromEvent(partial);
    fallbackUsed = finalImage ? "partial" : null;
  }
  return finalImage ? { images: [finalImage], fallbackUsed } : { images: [] };
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

function retryableStatus(status) {
  return status === 408 || status === 429 || status === 524 || status >= 500;
}

function retryableError(error) {
  if (error.message === "Failed to fetch") return true;
  const match = String(error.message || "").match(/HTTP\s+(\d+)/i);
  const status = error.status || (match ? Number(match[1]) : 0);
  return retryableStatus(status);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function openAIError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function makeJobRequestOptions(requestInput, referenceFile) {
  const options = { method: "POST" };
  if (requestInput.mode === "image") {
    const form = new FormData();
    for (const [key, value] of Object.entries(requestInput)) {
      form.set(key, value);
    }
    form.set("referenceImage", referenceFile);
    options.body = form;
  } else {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(requestInput);
  }
  return options;
}

async function createGenerationJob(requestInput, referenceFile) {
  const response = await fetch("/api/jobs", makeJobRequestOptions(requestInput, referenceFile));
  const payload = await readJsonResponse(response);
  if (!response.ok) throw openAIError(payload.error || `???????HTTP ${response.status}`, response.status);
  return payload;
}

async function pollGenerationJob(jobId, onEvent) {
  const startedAt = Date.now();
  const maxWaitMs = 10 * 60 * 1000;
  while (Date.now() - startedAt < maxWaitMs) {
    const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
      headers: { Accept: "application/json" },
    });
    const job = await readJsonResponse(response);
    if (!response.ok) throw openAIError(job.error || `???????HTTP ${response.status}`, response.status);
    if (job.status === "succeeded") {
      return {
        ...job.result,
        durationMs: job.result?.durationMs ?? job.durationMs ?? Date.now() - startedAt,
      };
    }
    if (job.status === "failed" || job.status === "cancelled") {
      throw openAIError(job.error || "??????", 500);
    }
    onEvent({
      type: job.attempts > 1 ? "retry" : "progress",
      attempt: job.attempts,
      elapsedMs: Date.now() - startedAt,
      status: job.status,
      error: job.error,
    });
    await wait(3000);
  }
  throw new Error("???? 10 ?????????????");
}

async function generate() {
  const apiKey = $("apiKey").value.trim();
  const prompt = $("prompt").value.trim();
  const aspect = $("aspect").value;
  const mode = $("mode").value;
  const resolution = $("resolution").value;
  const outputFormat = $("outputFormat").value;
  const background = $("background").value;
  const referenceFile = $("referenceImage").files[0];
  showError("");
  if (!apiKey) {
    showError("请输入 API 密钥");
    return;
  }
  if (!prompt) {
    showError("请输入提示词");
    return;
  }
  if (mode === "image" && !referenceFile) {
    showError("请上传参考图片");
    return;
  }
  if (resolution === "4k" && aspect === "square") {
    showError("4K 暂不支持方图，请选择横图/竖图，或把分辨率改成 2K。");
    return;
  }

  syncRememberedApiKey();
  setBusy(true);
  try {
    const baseUrl = cleanBaseUrl($("baseUrl").value);
    const model = $("model").value.trim();
    const size = sizeTextFor(aspect, resolution);
    const requestInput = {
      apiKey,
      baseUrl,
      model,
      prompt,
      aspect,
      resolution,
      quality: "high",
      outputFormat,
      background,
      mode,
    };
    const handleEvent = (event) => {
      if (event.type === "progress") {
        $("status").textContent = `????????? ${formatDuration(event.elapsedMs)}`;
      }
      if (event.type === "retry") {
        $("status").textContent = `???????????????? ${event.attempt} ?`;
      }
    };
    $("status").textContent = "??????????????...";
    const job = await createGenerationJob(requestInput, referenceFile);
    const payload = await pollGenerationJob(job.jobId, handleEvent);
    if (!payload) throw new Error("生成失败，服务器没有返回图片结果");
    if (!payload.images?.length) throw new Error("生成失败，上游没有返回图片结果");

    const src = imageSrc(imageFromProxyPayload(payload.images[0]), outputFormat);
    const thumbnailSrc = await createThumbnail(src, outputFormat);
    const record = {
      id: crypto.randomUUID(),
      prompt,
      src,
      thumbnailSrc,
      aspect,
      resolution,
      outputFormat,
      model,
      size,
      durationMs: payload.durationMs,
      createdAt: new Date().toISOString(),
    };
    state.history = [record, ...state.history.filter((entry) => entry.id !== record.id)].slice(0, 20);
    saveHistory();
    renderHistory();
    showImage(src, record);
    $("status").textContent =
      payload.fallbackUsed === "partial"
        ? `上游未返回最终原图，已使用最后一张预览图，用时 ${formatDuration(payload.durationMs)}`
        : `生成完成，用时 ${formatDuration(payload.durationMs)}`;
  } catch (error) {
    const message =
      error.message === "Failed to fetch"
        ? "浏览器无法直连接口。可能是接口地址不通、跨域被拦截，或网络中断。"
        : error.message || "生成失败";
    showError(message);
    $("status").textContent = "生成失败";
  } finally {
    setBusy(false);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadServerSettings();
  $("generate").addEventListener("click", generate);
  $("rememberApiKey").addEventListener("change", syncRememberedApiKey);
  $("apiKey").addEventListener("input", () => {
    if ($("rememberApiKey").checked) syncRememberedApiKey();
  });
  $("saveImage").addEventListener("click", () => {
    saveCurrentImage().catch((error) => showError(error.message || "保存失败"));
  });
  $("resultImage").addEventListener("dblclick", () => openLightbox(state.currentImage));
  $("closeLightbox").addEventListener("click", closeLightbox);
  $("lightbox").addEventListener("click", (event) => {
    if (event.target === $("lightbox")) closeLightbox();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("lightbox").hidden) closeLightbox();
  });
  $("mode").addEventListener("change", () => {
    $("referenceImageRow").hidden = $("mode").value !== "image";
  });
  $("clearHistory").addEventListener("click", () => {
    state.history = [];
    saveHistory();
    renderHistory();
  });
  renderHistory();
});

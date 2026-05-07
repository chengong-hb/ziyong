const http = require("http");
const fs = require("fs");
const path = require("path");
const {
  AppError,
  buildOpenAIRequest,
  getPublicSettings,
  handleGenerateImage,
  streamGenerateImage,
} = require("./src/image-api");
const { cancelImageJob, createImageJob, getImageJob } = require("./src/image-jobs");

const PUBLIC_DIR = path.join(__dirname, "public");

function diagnosticLogger(event) {
  console.info("[image2-diagnostic]", JSON.stringify(event));
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function sendNdjsonEvent(res, event) {
  res.write(`${JSON.stringify(event)}\n`);
}

function readRequestJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new AppError("请求太大", 413));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new AppError("请求 JSON 格式不正确", 400));
      }
    });
    req.on("error", reject);
  });
}

function parseMultipart(body, boundary) {
  const parts = {};
  const marker = Buffer.from(`--${boundary}`);
  let start = body.indexOf(marker);
  while (start !== -1) {
    start += marker.length;
    if (body[start] === 45 && body[start + 1] === 45) break;
    if (body[start] === 13 && body[start + 1] === 10) start += 2;
    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), start);
    if (headerEnd === -1) break;
    const header = body.slice(start, headerEnd).toString("utf8");
    const next = body.indexOf(marker, headerEnd + 4);
    if (next === -1) break;
    let content = body.slice(headerEnd + 4, next);
    if (content.length >= 2 && content[content.length - 2] === 13 && content[content.length - 1] === 10) {
      content = content.slice(0, -2);
    }
    const name = header.match(/name="([^"]+)"/)?.[1];
    if (name) {
      const fileName = header.match(/filename="([^"]*)"/)?.[1];
      const type = header.match(/Content-Type:\s*([^\r\n]+)/i)?.[1];
      parts[name] = fileName !== undefined ? { buffer: content, name: fileName, type } : content.toString("utf8");
    }
    start = next;
  }
  return parts;
}

function readRequestInput(req) {
  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) return readRequestJson(req);
  const boundary = contentType.match(/boundary=([^;]+)/)?.[1];
  if (!boundary) return Promise.reject(new AppError("图生图请求缺少 boundary", 400));
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size > 20 * 1024 * 1024) {
        reject(new AppError("请求太大", 413));
        req.destroy();
      }
    });
    req.on("end", () => {
      const parts = parseMultipart(Buffer.concat(chunks), boundary);
      resolve({
        ...parts,
        image: parts.referenceImage,
      });
    });
    req.on("error", reject);
  });
}

function contentType(filePath) {
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "text/html; charset=utf-8";
}

async function requestListener(req, res) {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "POST" && url.pathname === "/api/generate") {
      const input = await readRequestInput(req);
      sendJson(res, 200, await handleGenerateImage(input, { logger: diagnosticLogger }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/generate/stream") {
      const input = await readRequestInput(req);
      res.writeHead(200, {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      });
      await streamGenerateImage(input, {
        logger: diagnosticLogger,
        onEvent: (event) => sendNdjsonEvent(res, event),
      });
      res.end();
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/jobs") {
      const input = await readRequestInput(req);
      sendJson(res, 202, createImageJob(input, { logger: diagnosticLogger }));
      return;
    }

    const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (jobMatch && req.method === "GET") {
      const job = getImageJob(jobMatch[1]);
      if (!job) {
        sendJson(res, 404, { error: "任务不存在或已过期" });
        return;
      }
      sendJson(res, 200, job);
      return;
    }

    if (jobMatch && req.method === "DELETE") {
      const job = cancelImageJob(jobMatch[1]);
      if (!job) {
        sendJson(res, 404, { error: "任务不存在或已过期" });
        return;
      }
      sendJson(res, 200, job);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/settings") {
      sendJson(res, 200, await getPublicSettings());
      return;
    }

    if (req.method !== "GET") {
      sendJson(res, 405, { error: "方法不支持" });
      return;
    }

    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
    if (!filePath.startsWith(PUBLIC_DIR)) {
      sendJson(res, 403, { error: "路径不允许" });
      return;
    }
    fs.readFile(filePath, (error, data) => {
      if (error) {
        sendJson(res, 404, { error: "文件不存在" });
        return;
      }
      res.writeHead(200, { "Content-Type": contentType(filePath) });
      res.end(data);
    });
  } catch (error) {
    const status = error.status || 500;
    sendJson(res, status, { error: error.message || "服务异常" });
  }
}

function createServer() {
  return http.createServer(requestListener);
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "0.0.0.0";
  createServer().listen(port, host, () => {
    console.log(`Image2 local workspace: http://${host}:${port}`);
  });
}

module.exports = {
  AppError,
  buildOpenAIRequest,
  cancelImageJob,
  createServer,
  createImageJob,
  diagnosticLogger,
  getImageJob,
  getPublicSettings,
  handleGenerateImage,
  streamGenerateImage,
};

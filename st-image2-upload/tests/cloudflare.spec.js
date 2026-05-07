const { test, expect } = require("@playwright/test");

test("cloudflare settings function returns public defaults", async () => {
  const { onRequestGet } = await import("../functions/api/settings.js");

  const response = await onRequestGet();
  const payload = await response.json();

  expect(response.status).toBe(200);
  expect(payload).toEqual({
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-image-2",
  });
});

test("cloudflare generate function forwards request API key to OpenAI", async () => {
  const { onRequestPost } = await import("../functions/api/generate.js");
  const requests = [];

  const response = await onRequestPost({
    request: new Request("https://st.hbst.com/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: "request-key",
        prompt: "a quiet cyberpunk desk",
        model: "gpt-image-2",
        aspect: "landscape",
        resolution: "4k",
        quality: "high",
        outputFormat: "png",
        background: "auto",
        baseUrl: "https://api.openai.com/v1",
      }),
    }),
    env: {},
    fetch: async (url, options) => {
      requests.push({ url, options });
      return new Response(
        JSON.stringify({
          data: [{ b64_json: "aW1hZ2UtZGF0YQ==" }],
          usage: { total_tokens: 42 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    },
  });

  const payload = await response.json();

  expect(response.status).toBe(200);
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe("https://api.openai.com/v1/images/generations");
  expect(requests[0].options.headers.Authorization).toBe("Bearer request-key");
  const body = JSON.parse(requests[0].options.body);
  expect(body).toMatchObject({
    size: "3840x2160",
    quality: "high",
  });
  expect(body).not.toHaveProperty("resolution");
  expect(payload.images[0].b64Json).toBe("aW1hZ2UtZGF0YQ==");
});

test("cloudflare generate function returns json errors for bad requests", async () => {
  const { onRequestPost } = await import("../functions/api/generate.js");

  const response = await onRequestPost({
    request: new Request("https://st.hbst.com/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "", prompt: "test prompt" }),
    }),
    env: {},
    fetch: async () => {
      throw new Error("should not call OpenAI");
    },
  });
  const payload = await response.json();

  expect(response.status).toBe(400);
  expect(payload.error).toBe("请输入 API 密钥");
});

test("cloudflare stream generate function returns ndjson events", async () => {
  const { onRequestPost } = await import("../functions/api/generate/stream.js");

  const response = await onRequestPost({
    request: new Request("https://st-image2.pages.dev/api/generate/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: "request-key",
        prompt: "a quiet cyberpunk desk",
        model: "gpt-image-2",
        aspect: "landscape",
        resolution: "2k",
        baseUrl: "https://api.openai.com/v1",
      }),
    }),
    env: {},
    fetch: async () =>
      new Response(
        JSON.stringify({
          data: [{ b64_json: "aW1hZ2UtZGF0YQ==" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ),
  });

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toContain("application/x-ndjson");
  const text = await response.text();
  expect(text).toContain('"type":"progress"');
  expect(text).toContain('"type":"done"');
  expect(text).toContain('"durationMs"');
});

test("cloudflare stream generate function supports image mode with data URL generation", async () => {
  const { onRequestPost } = await import("../functions/api/generate/stream.js");
  const form = new FormData();
  const requests = [];
  form.set("apiKey", "request-key");
  form.set("mode", "image");
  form.set("prompt", "turn it into watercolor");
  form.set("model", "gpt-image-2");
  form.set("aspect", "landscape");
  form.set("resolution", "2k");
  form.set("quality", "high");
  form.set("baseUrl", "https://api.openai.com/v1");
  form.set("referenceImage", new Blob([Buffer.from("fake-image")], { type: "image/png" }), "source.png");

  const response = await onRequestPost({
    request: new Request("https://st-image2.pages.dev/api/generate/stream", {
      method: "POST",
      body: form,
    }),
    env: {},
    fetch: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ data: [{ b64_json: "ZWRpdGVkLWltYWdl" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  const text = await response.text();

  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe("https://api.openai.com/v1/images/generations");
  expect(requests[0].options.headers.Authorization).toBe("Bearer request-key");
  const requestBody = JSON.parse(requests[0].options.body);
  expect(requestBody.size).toBe("2560x1440");
  expect(requestBody).not.toHaveProperty("resolution");
  expect(requestBody.quality).toBe("high");
  expect(requestBody.image).toMatch(/^data:image\/png;base64,/);
  expect(text).toContain('"type":"done"');
});

test("cloudflare jobs function forwards short job requests to the long backend", async () => {
  const { onRequestPost } = await import("../functions/api/jobs.js");
  const requests = [];

  const response = await onRequestPost({
    request: new Request("https://st-image2.pages.dev/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "long prompt", apiKey: "request-key" }),
    }),
    env: { JOBS_API_URL: "https://st-image2-api.onrender.com" },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ jobId: "job_cloud", status: "queued" }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  expect(response.status).toBe(202);
  expect(requests[0].url).toBe("https://st-image2-api.onrender.com/api/jobs");
  expect(requests[0].options.method).toBe("POST");
  expect(await response.json()).toEqual({ jobId: "job_cloud", status: "queued" });
});

test("cloudflare job status function forwards polling to the long backend", async () => {
  const { onRequestGet } = await import("../functions/api/jobs/[jobId].js");
  const requests = [];

  const response = await onRequestGet({
    params: { jobId: "job_cloud" },
    env: { JOBS_API_URL: "https://st-image2-api.onrender.com" },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ jobId: "job_cloud", status: "running" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  expect(response.status).toBe(200);
  expect(requests[0].url).toBe("https://st-image2-api.onrender.com/api/jobs/job_cloud");
  expect(requests[0].options.method).toBe("GET");
  expect(await response.json()).toEqual({ jobId: "job_cloud", status: "running" });
});

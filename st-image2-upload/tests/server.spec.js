const { test, expect } = require("@playwright/test");

test("image API forwards the request API key to OpenAI and returns generated image data", async () => {
  delete process.env.OPENAI_API_KEY;
  delete require.cache[require.resolve("../server")];

  const { handleGenerateImage } = require("../server");
  const requests = [];
  const response = await handleGenerateImage(
    {
      apiKey: "request-key",
      prompt: "a quiet cyberpunk desk",
      model: "gpt-image-2",
      aspect: "landscape",
      resolution: "4k",
      quality: "high",
      outputFormat: "png",
      background: "auto",
      baseUrl: "https://api.openai.com/v1",
    },
    {
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ b64_json: "aW1hZ2UtZGF0YQ==" }],
            usage: { total_tokens: 42 },
          }),
        };
      },
    }
  );

  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe("https://api.openai.com/v1/images/generations");
  expect(requests[0].options.headers.Authorization).toBe("Bearer request-key");
  expect(JSON.parse(requests[0].options.body)).toMatchObject({
    model: "gpt-image-2",
    prompt: "a quiet cyberpunk desk",
    size: "3840x2160",
    quality: "high",
    output_format: "png",
    background: "auto",
  });
  expect(JSON.parse(requests[0].options.body)).not.toHaveProperty("resolution");
  expect(response.images[0].b64Json).toBe("aW1hZ2UtZGF0YQ==");
  expect(response.usage.total_tokens).toBe(42);
});

test("image mode API forwards uploaded image data through OpenAI-compatible generations", async () => {
  delete process.env.OPENAI_API_KEY;
  delete require.cache[require.resolve("../server")];

  const { handleGenerateImage } = require("../server");
  const requests = [];
  const response = await handleGenerateImage(
    {
      apiKey: "request-key",
      mode: "image",
      prompt: "turn it into watercolor",
      model: "gpt-image-2",
      aspect: "landscape",
      resolution: "2k",
      quality: "high",
      outputFormat: "png",
      background: "auto",
      baseUrl: "https://api.openai.com/v1",
      image: {
        buffer: Buffer.from("fake-image"),
        type: "image/png",
        name: "source.png",
      },
    },
    {
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ b64_json: "ZWRpdGVkLWltYWdl" }],
          }),
        };
      },
    }
  );

  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe("https://api.openai.com/v1/images/generations");
  expect(requests[0].options.headers.Authorization).toBe("Bearer request-key");
  const body = JSON.parse(requests[0].options.body);
  expect(body.size).toBe("2560x1440");
  expect(body).not.toHaveProperty("resolution");
  expect(body.quality).toBe("high");
  expect(body.image).toMatch(/^data:image\/png;base64,/);
  expect(response.images[0].b64Json).toBe("ZWRpdGVkLWltYWdl");
});

test("image API rejects missing API keys before calling OpenAI", async () => {
  delete process.env.OPENAI_API_KEY;
  delete require.cache[require.resolve("../server")];

  const { handleGenerateImage } = require("../server");
  let called = false;

  await expect(
    handleGenerateImage(
      { prompt: "test prompt" },
      {
        fetchImpl: async () => {
          called = true;
          return { ok: true, json: async () => ({}) };
        },
      }
    )
  ).rejects.toThrow("请输入 API 密钥");
  expect(called).toBe(false);
});

test("image API rejects missing prompts before calling OpenAI", async () => {
  delete require.cache[require.resolve("../server")];

  const { handleGenerateImage } = require("../server");
  let called = false;

  await expect(
    handleGenerateImage(
      { apiKey: "request-key", prompt: "   " },
      {
        fetchImpl: async () => {
          called = true;
          return { ok: true, json: async () => ({}) };
        },
      }
    )
  ).rejects.toThrow("请输入提示词");
  expect(called).toBe(false);
});

test("public settings return defaults without exposing or requiring an API key", async () => {
  delete require.cache[require.resolve("../server")];

  const { getPublicSettings } = require("../server");

  expect(await getPublicSettings()).toEqual({
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-image-2",
  });
});

test("image stream sends progress events before the final image", async () => {
  delete require.cache[require.resolve("../server")];

  const { streamGenerateImage } = require("../server");
  const events = [];

  await streamGenerateImage(
    {
      apiKey: "request-key",
      prompt: "a slow but successful image",
      model: "gpt-image-2",
      size: "1536x1024",
      baseUrl: "https://api.openai.com/v1",
    },
    {
      maxWaitMs: 1000,
      heartbeatMs: 10,
      now: (() => {
        let current = 0;
        return () => current += 25;
      })(),
      sleep: async () => {},
      onEvent: (event) => events.push(event),
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ b64_json: "aW1hZ2UtZGF0YQ==" }],
        }),
      }),
    }
  );

  expect(events[0]).toMatchObject({ type: "progress" });
  expect(events.at(-1)).toMatchObject({ type: "done" });
  expect(events.at(-1).data.durationMs).toBeGreaterThan(0);
});

test("image stream requests OpenAI image streaming and returns the final completed image", async () => {
  delete require.cache[require.resolve("../server")];

  const { streamGenerateImage } = require("../server");
  const events = [];
  const requests = [];

  await streamGenerateImage(
    {
      apiKey: "request-key",
      prompt: "a streaming image",
      model: "gpt-image-2",
      size: "1536x1024",
      baseUrl: "https://api.openai.com/v1",
    },
    {
      maxWaitMs: 1000,
      heartbeatMs: 10,
      now: (() => {
        let current = 0;
        return () => current += 25;
      })(),
      sleep: async () => {},
      onEvent: (event) => events.push(event),
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        const encoder = new TextEncoder();
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('data: {"type":"image_generation.partial_image","b64_json":"cGFydGlhbA==","partial_image_index":0}\n\n'));
              controller.enqueue(encoder.encode('data: {"type":"image_generation.completed","b64_json":"ZmluYWwtaW1hZ2U="}\n\n'));
              controller.close();
            },
          }),
          { status: 200, headers: { "Content-Type": "text/event-stream" } }
        );
      },
    }
  );

  expect(requests).toHaveLength(1);
  expect(JSON.parse(requests[0].options.body)).toMatchObject({
    stream: true,
    partial_images: 1,
  });
  expect(events).toContainEqual(expect.objectContaining({ type: "partial" }));
  expect(events.at(-1)).toMatchObject({
    type: "done",
    data: { images: [{ b64Json: "ZmluYWwtaW1hZ2U=" }] },
  });
});

test("image stream retries a 524 response within the wait window", async () => {
  delete require.cache[require.resolve("../server")];

  const { streamGenerateImage } = require("../server");
  const events = [];
  let attempts = 0;

  await streamGenerateImage(
    {
      apiKey: "request-key",
      prompt: "retry after 524",
      model: "gpt-image-2",
      size: "1536x1024",
      baseUrl: "https://api.openai.com/v1",
    },
    {
      maxWaitMs: 1000,
      heartbeatMs: 10,
      retryDelayMs: 10,
      now: (() => {
        let current = 0;
        return () => current += 25;
      })(),
      sleep: async () => {},
      onEvent: (event) => events.push(event),
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) {
          return new Response(JSON.stringify({ error: "timeout" }), { status: 524 });
        }
        return new Response(
          JSON.stringify({
            data: [{ b64_json: "cmV0cmllZC1pbWFnZQ==" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      },
    }
  );

  expect(attempts).toBe(2);
  expect(events).toContainEqual(expect.objectContaining({ type: "retry", attempt: 2 }));
  expect(events.at(-1)).toMatchObject({
    type: "done",
    data: { images: [{ b64Json: "cmV0cmllZC1pbWFnZQ==" }] },
  });
});

test("image stream accepts nested completed image payloads", async () => {
  delete require.cache[require.resolve("../server")];

  const { streamGenerateImage } = require("../server");
  const events = [];

  await streamGenerateImage(
    {
      apiKey: "request-key",
      prompt: "nested completed image",
      model: "gpt-image-2",
      size: "1536x1024",
      baseUrl: "https://api.openai.com/v1",
    },
    {
      maxWaitMs: 1000,
      heartbeatMs: 10,
      now: (() => {
        let current = 0;
        return () => current += 25;
      })(),
      sleep: async () => {},
      onEvent: (event) => events.push(event),
      fetchImpl: async () => {
        const encoder = new TextEncoder();
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('data: {"type":"image_generation.completed","image":{"b64_json":"bmVzdGVkLWltYWdl"}}\n\n'));
              controller.close();
            },
          }),
          { status: 200, headers: { "Content-Type": "text/event-stream" } }
        );
      },
    }
  );

  expect(events.at(-1)).toMatchObject({
    type: "done",
    data: { images: [{ b64Json: "bmVzdGVkLWltYWdl" }] },
  });
});

test("image stream falls back to the last partial image when completed is missing", async () => {
  delete require.cache[require.resolve("../server")];

  const { streamGenerateImage } = require("../server");
  const events = [];

  await streamGenerateImage(
    {
      apiKey: "request-key",
      prompt: "partial fallback",
      model: "gpt-image-2",
      size: "1536x1024",
      baseUrl: "https://api.openai.com/v1",
    },
    {
      maxWaitMs: 1000,
      heartbeatMs: 10,
      now: (() => {
        let current = 0;
        return () => current += 25;
      })(),
      sleep: async () => {},
      onEvent: (event) => events.push(event),
      fetchImpl: async () => {
        const encoder = new TextEncoder();
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('data: {"type":"image_generation.partial_image","b64_json":"Zmlyc3QtcGFydGlhbA=="}\n\n'));
              controller.enqueue(encoder.encode('data: {"type":"image_generation.partial_image","b64_json":"bGFzdC1wYXJ0aWFs"}\n\n'));
              controller.close();
            },
          }),
          { status: 200, headers: { "Content-Type": "text/event-stream" } }
        );
      },
    }
  );

  expect(events.at(-1)).toMatchObject({
    type: "done",
    data: {
      images: [{ b64Json: "bGFzdC1wYXJ0aWFs" }],
      fallbackUsed: "partial",
    },
  });
});

test("image stream parses a final SSE event without a trailing blank line", async () => {
  delete require.cache[require.resolve("../server")];

  const { streamGenerateImage } = require("../server");
  const events = [];

  await streamGenerateImage(
    {
      apiKey: "request-key",
      prompt: "partial without trailing blank line",
      model: "gpt-image-2",
      size: "1536x1024",
      baseUrl: "https://api.openai.com/v1",
    },
    {
      maxWaitMs: 1000,
      heartbeatMs: 10,
      now: (() => {
        let current = 0;
        return () => current += 25;
      })(),
      sleep: async () => {},
      onEvent: (event) => events.push(event),
      fetchImpl: async () => {
        const encoder = new TextEncoder();
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('data: {"type":"image_generation.partial_image","b64_json":"dHJhaWxpbmctcGFydGlhbA=="}'));
              controller.close();
            },
          }),
          { status: 200, headers: { "Content-Type": "text/event-stream" } }
        );
      },
    }
  );

  expect(events.at(-1)).toMatchObject({
    type: "done",
    data: {
      images: [{ b64Json: "dHJhaWxpbmctcGFydGlhbA==" }],
      fallbackUsed: "partial",
    },
  });
});

test("image stream times out after the configured wait", async () => {
  delete require.cache[require.resolve("../server")];

  const { streamGenerateImage } = require("../server");
  const events = [];

  await streamGenerateImage(
    {
      apiKey: "request-key",
      prompt: "a very slow image",
      model: "gpt-image-2",
      size: "1536x1024",
      baseUrl: "https://api.openai.com/v1",
    },
    {
      maxWaitMs: 50,
      heartbeatMs: 10,
      now: (() => {
        let current = 0;
        return () => current += 25;
      })(),
      sleep: async () => {},
      onEvent: (event) => events.push(event),
      fetchImpl: async () => new Promise(() => {}),
    }
  );

  expect(events.at(-1)).toMatchObject({
    type: "error",
    status: 504,
  });
  expect(events.at(-1).error).toContain("8 分钟");
});

test("image stream aborts the upstream request after timeout", async () => {
  delete require.cache[require.resolve("../server")];

  const { streamGenerateImage } = require("../server");
  let signal;

  await streamGenerateImage(
    {
      apiKey: "request-key",
      prompt: "a request that should be aborted",
      model: "gpt-image-2",
      size: "1536x1024",
      baseUrl: "https://api.openai.com/v1",
    },
    {
      maxWaitMs: 50,
      heartbeatMs: 10,
      now: (() => {
        let current = 0;
        return () => current += 25;
      })(),
      sleep: async () => {},
      onEvent: () => {},
      fetchImpl: async (_url, options) => {
        signal = options.signal;
        return new Promise(() => {});
      },
    }
  );

  expect(signal).toBeDefined();
  expect(signal.aborted).toBe(true);
});

test("image jobs return immediately and can be polled until completion", async () => {
  delete require.cache[require.resolve("../server")];

  const { createImageJob, getImageJob } = require("../server");
  let calls = 0;

  const job = createImageJob(
    {
      apiKey: "request-key",
      prompt: "a long prompt that should run in the background",
      model: "gpt-image-2",
      aspect: "landscape",
      resolution: "2k",
      outputFormat: "jpeg",
      baseUrl: "https://api.openai.com/v1",
    },
    {
      retryDelayMs: 1,
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({ data: [{ b64_json: "am9iLWltYWdl" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    }
  );

  expect(job.jobId).toMatch(/^job_/);
  expect(["queued", "running"]).toContain(job.status);

  await expect
    .poll(() => getImageJob(job.jobId).status)
    .toBe("succeeded");

  const completed = getImageJob(job.jobId);
  expect(calls).toBe(1);
  expect(completed.result.images[0].b64Json).toBe("am9iLWltYWdl");
  expect(completed.result.size).toBe("2560x1440");
  expect(completed.durationMs).toBeGreaterThanOrEqual(0);
  expect(completed.result).not.toHaveProperty("apiKey");
});

test("image jobs retry retryable upstream failures before succeeding", async () => {
  delete require.cache[require.resolve("../server")];

  const { createImageJob, getImageJob } = require("../server");
  let calls = 0;

  const job = createImageJob(
    {
      apiKey: "request-key",
      prompt: "retry this background job",
      model: "gpt-image-2",
      aspect: "landscape",
      resolution: "2k",
      baseUrl: "https://api.openai.com/v1",
    },
    {
      retryDelayMs: 1,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(JSON.stringify({ error: "bad gateway" }), { status: 502 });
        }
        return new Response(JSON.stringify({ data: [{ b64_json: "cmV0cmllZC1qb2I=" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    }
  );

  await expect
    .poll(() => getImageJob(job.jobId).status)
    .toBe("succeeded");

  expect(calls).toBe(2);
  expect(getImageJob(job.jobId).attempts).toBe(2);
});

test("image jobs can be cancelled", async () => {
  delete require.cache[require.resolve("../server")];

  const { cancelImageJob, createImageJob, getImageJob } = require("../server");
  const job = createImageJob(
    {
      apiKey: "request-key",
      prompt: "cancel this background job",
      model: "gpt-image-2",
      baseUrl: "https://api.openai.com/v1",
    },
    {
      fetchImpl: async (_url, options) => {
        await new Promise((resolve) => options.signal.addEventListener("abort", resolve, { once: true }));
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      },
    }
  );

  expect(cancelImageJob(job.jobId).status).toBe("cancelled");
  expect(getImageJob(job.jobId).status).toBe("cancelled");
});

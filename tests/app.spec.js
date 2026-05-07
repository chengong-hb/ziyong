const { test, expect } = require("@playwright/test");

const tinyPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lzS8JwAAAABJRU5ErkJggg==";

function jsonImagePayload(extra = {}) {
  return {
    images: [{ b64Json: tinyPng }],
    model: "gpt-image-2",
    size: "1536x1024",
    durationMs: 363000,
    ...extra,
  };
}

async function fulfillDirectImage(route, extra = {}) {
  await route.fulfill({
    contentType: "text/event-stream",
    body: `data: {"type":"image_generation.completed","b64_json":"${tinyPng}"}\n\n`,
    ...extra,
  });
}

async function mockSuccessfulJob(page, payload = jsonImagePayload()) {
  await page.route("**/api/jobs", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ jobId: "job_mock", status: "queued" }),
    });
  });
  await page.route("**/api/jobs/job_mock", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        jobId: "job_mock",
        status: "succeeded",
        durationMs: payload.durationMs || 1200,
        result: payload,
      }),
    });
  });
}

test("image workspace opens directly without a family password", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("家庭访问密码")).toHaveCount(0);
  await expect(page.locator("#apiKey")).toBeVisible();
  await expect(page.locator("#baseUrl")).toBeVisible();
  await expect(page.locator("#model")).toHaveValue("gpt-image-2");
  await expect(page.locator("#resolution")).toHaveValue("1k");
  await expect(page.getByText("分辨率")).toBeVisible();
  await expect(page.locator("#mode")).toHaveValue("text");
  await expect(page.locator("#generate")).toBeEnabled();
});

test("image workspace requires an API key before generating", async ({ page }) => {
  await page.goto("/");
  await page.locator("#prompt").fill("a test image");
  await page.locator("#generate").click();

  await expect(page.getByRole("alert")).toContainText("请输入 API 密钥");
});

test("image workspace submits a background job and renders the generated image", async ({ page }) => {
  let jobBody;
  await page.route("**/images/generations", async (route) => {
    throw new Error("browser should not call the upstream image API directly");
  });
  await page.route("**/api/jobs", async (route) => {
    jobBody = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ jobId: "job_test", status: "queued" }),
    });
  });
  await page.route("**/api/jobs/job_test", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        jobId: "job_test",
        status: "succeeded",
        durationMs: 363000,
        result: jsonImagePayload(),
      }),
    });
  });

  await page.goto("/");
  await page.locator("#apiKey").fill("sk-page-key");
  await page.locator("#prompt").fill("neon library, cinematic light");
  await page.locator("#aspect").selectOption("landscape");
  await page.locator("#generate").click();

  await expect(page.locator("#resultImage")).toBeVisible();
  expect(jobBody).toMatchObject({
    apiKey: "sk-page-key",
    prompt: "neon library, cinematic light",
    model: "gpt-image-2",
    aspect: "landscape",
    resolution: "1k",
    quality: "high",
    outputFormat: "png",
    mode: "text",
  });
  await expect(page.locator("#saveImage")).toBeVisible();
  await expect(page.locator("#saveImage")).toHaveText("保存图片");
  await expect(page.locator("#downloadOriginal")).toHaveCount(0);
  await expect(page.locator("#downloadUpscaled")).toHaveCount(0);
  await expect(page.locator("#meta")).toContainText("耗时");
  await expect(page.locator("#meta")).toContainText("分辨率");
  await expect(page.locator("#meta")).toContainText("质量");
  await expect(page.locator("#meta")).toContainText("格式");
  await expect(page.getByText("neon library, cinematic light")).toBeVisible();
});

test("image workspace uploads reference images through the background job API", async ({ page }) => {
  let jobContentType;
  let jobBody;
  await page.route("**/api/jobs", async (route) => {
    jobContentType = route.request().headers()["content-type"];
    jobBody = route.request().postDataBuffer().toString("utf8");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ jobId: "job_image", status: "queued" }),
    });
  });
  await page.route("**/api/jobs/job_image", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        jobId: "job_image",
        status: "succeeded",
        durationMs: 91000,
        result: jsonImagePayload({ size: "2560x1440", outputFormat: "webp" }),
      }),
    });
  });
  await page.route("**/images/generations", async () => {
    throw new Error("browser should not call upstream directly");
  });

  await page.goto("/");
  await page.locator("#mode").selectOption("image");
  await page.locator("#apiKey").fill("sk-page-key");
  await page.locator("#prompt").fill("edit this image as webp");
  await page.locator("#resolution").selectOption("2k");
  await page.locator("#outputFormat").selectOption("webp");
  await page.setInputFiles("#referenceImage", {
    name: "source.png",
    mimeType: "image/png",
    buffer: Buffer.from(tinyPng, "base64"),
  });
  await page.locator("#generate").click();

  await expect(page.locator("#resultImage")).toBeVisible();
  expect(jobContentType).toContain("multipart/form-data");
  expect(jobBody).toContain('name="referenceImage"');
  expect(jobBody).toContain("source.png");
  expect(jobBody).toContain('name="mode"');
  expect(jobBody).toContain("image");
});

test("image workspace sends 4K generation through the background job API", async ({ page }) => {
  let directCalls = 0;
  let jobBody;
  await page.route("**/images/generations", async (route) => {
    directCalls += 1;
    await route.abort("failed");
  });
  await page.route("**/api/jobs", async (route) => {
    jobBody = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ jobId: "job_4k", status: "queued" }),
    });
  });
  await page.route("**/api/jobs/job_4k", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        jobId: "job_4k",
        status: "succeeded",
        durationMs: 118000,
        result: jsonImagePayload({ size: "3840x2160", outputFormat: "jpeg" }),
      }),
    });
  });

  await page.goto("/");
  await page.locator("#baseUrl").fill("https://www.msutools.cn/v1");
  await page.locator("#apiKey").fill("sk-page-key");
  await page.locator("#prompt").fill("a long 4k prompt should use jobs");
  await page.locator("#resolution").selectOption("4k");
  await page.locator("#outputFormat").selectOption("jpeg");
  await page.locator("#generate").click();

  await expect(page.locator("#resultImage")).toBeVisible();
  expect(directCalls).toBe(0);
  expect(jobBody).toMatchObject({
    apiKey: "sk-page-key",
    baseUrl: "https://www.msutools.cn/v1",
    model: "gpt-image-2",
    prompt: "a long 4k prompt should use jobs",
    aspect: "landscape",
    resolution: "4k",
    quality: "high",
    outputFormat: "jpeg",
    background: "auto",
    mode: "text",
  });
  expect(jobBody).not.toHaveProperty("size");
});

test("image workspace sends 2K long prompts through the background job API", async ({ page }) => {
  let directCalls = 0;
  let jobBody;
  await page.route("**/images/generations", async (route) => {
    directCalls += 1;
    await route.abort("failed");
  });
  await page.route("**/api/jobs", async (route) => {
    jobBody = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ jobId: "job_2k", status: "queued" }),
    });
  });
  await page.route("**/api/jobs/job_2k", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        jobId: "job_2k",
        status: "succeeded",
        durationMs: 61000,
        result: jsonImagePayload({ size: "2560x1440" }),
      }),
    });
  });

  await page.goto("/");
  await page.locator("#apiKey").fill("sk-page-key");
  await page.locator("#prompt").fill("??????".repeat(90));
  await page.locator("#resolution").selectOption("2k");
  await page.locator("#generate").click();

  await expect(page.locator("#resultImage")).toBeVisible();
  expect(directCalls).toBe(0);
  expect(jobBody.resolution).toBe("2k");
});

test("image workspace sends reference image to background jobs for 4K image prompts", async ({ page }) => {
  let directCalls = 0;
  let jobBody;
  let jobContentType;
  await page.route("**/images/generations", async (route) => {
    directCalls += 1;
    await route.abort("failed");
  });
  await page.route("**/api/jobs", async (route) => {
    jobContentType = route.request().headers()["content-type"];
    jobBody = route.request().postDataBuffer().toString("utf8");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ jobId: "job_image_4k", status: "queued" }),
    });
  });
  await page.route("**/api/jobs/job_image_4k", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        jobId: "job_image_4k",
        status: "succeeded",
        durationMs: 118000,
        result: jsonImagePayload({ size: "3840x2160" }),
      }),
    });
  });

  await page.goto("/");
  await page.locator("#mode").selectOption("image");
  await page.locator("#apiKey").fill("sk-page-key");
  await page.locator("#prompt").fill("4k image prompt");
  await page.locator("#resolution").selectOption("4k");
  await page.setInputFiles("#referenceImage", {
    name: "source.png",
    mimeType: "image/png",
    buffer: Buffer.from(tinyPng, "base64"),
  });
  await page.locator("#generate").click();

  await expect(page.locator("#resultImage")).toBeVisible();
  expect(directCalls).toBe(0);
  expect(jobContentType).toContain("multipart/form-data");
  expect(jobBody).toContain('name="referenceImage"');
  expect(jobBody).toContain("source.png");
  expect(jobBody).toContain('name="mode"');
  expect(jobBody).toContain("image");
});

test("image workspace keeps aspect labels simple and removes prompt shortcuts", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("#aspect option")).toHaveText(["横图", "竖图", "方图"]);
  await expect(page.getByText("产品摄影")).toHaveCount(0);
  await expect(page.getByText("科技壁纸")).toHaveCount(0);
  await expect(page.getByText("氛围空间")).toHaveCount(0);
  await expect(page.locator("[data-prompt]")).toHaveCount(0);
});

test("image workspace sends selected quality and output format to background jobs", async ({ page }) => {
  await page.route("**/api/jobs", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.resolution).toBe("4k");
    expect(body.quality).toBe("high");
    expect(body.outputFormat).toBe("jpeg");
    expect(body.aspect).toBe("portrait");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ jobId: "job_params", status: "queued" }),
    });
  });
  await page.route("**/api/jobs/job_params", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        jobId: "job_params",
        status: "succeeded",
        durationMs: 1500,
        result: jsonImagePayload({ size: "2160x3840", outputFormat: "jpeg" }),
      }),
    });
  });

  await page.goto("/");
  await page.locator("#apiKey").fill("sk-page-key");
  await page.locator("#prompt").fill("parameter alignment test");
  await page.locator("#aspect").selectOption("portrait");
  await page.locator("#resolution").selectOption("4k");
  await page.locator("#outputFormat").selectOption("jpeg");
  await page.locator("#generate").click();

  await expect(page.locator("#resultImage")).toBeVisible();
  await expect(page.locator("#meta")).toContainText("竖图");
  await expect(page.locator("#meta")).toContainText("4K");
  await expect(page.locator("#meta")).toContainText("jpeg");
});

test("image workspace reports background job failures without direct browser calls", async ({ page }) => {
  let directCalls = 0;
  await page.route("**/images/generations", async (route) => {
    directCalls += 1;
    await route.abort("failed");
  });
  await page.route("**/api/jobs", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ jobId: "job_failed", status: "queued" }),
    });
  });
  await page.route("**/api/jobs/job_failed", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        jobId: "job_failed",
        status: "failed",
        attempts: 3,
        error: "???? 502????????????",
      }),
    });
  });

  await page.goto("/");
  await page.locator("#apiKey").fill("sk-page-key");
  await page.locator("#prompt").fill("fallback through backend job");
  await page.locator("#aspect").selectOption("portrait");
  await page.locator("#resolution").selectOption("2k");
  await page.locator("#outputFormat").selectOption("webp");
  await page.locator("#generate").click();

  await expect(page.getByRole("alert")).toContainText("???? 502");
  expect(directCalls).toBe(0);
});

test("image workspace shows retry status from background jobs before succeeding", async ({ page }) => {
  let polls = 0;
  await page.route("**/images/generations", async () => {
    throw new Error("browser should not call upstream directly");
  });
  await page.route("**/api/jobs", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ jobId: "job_retry", status: "queued" }),
    });
  });
  await page.route("**/api/jobs/job_retry", async (route) => {
    polls += 1;
    if (polls === 1) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          jobId: "job_retry",
          status: "running",
          attempts: 2,
          error: "?????????????",
        }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        jobId: "job_retry",
        status: "succeeded",
        durationMs: 61000,
        result: jsonImagePayload(),
      }),
    });
  });

  await page.goto("/");
  await page.locator("#apiKey").fill("sk-page-key");
  await page.locator("#prompt").fill("retry status");
  await page.locator("#generate").click();

  await expect(page.locator("#status")).toContainText("????");
  await expect(page.locator("#resultImage")).toBeVisible();
});

test("image workspace sends image mode requests through multipart background jobs", async ({ page }) => {
  let jobBody;
  let jobContentType;
  await page.route("**/images/edits", async () => {
    throw new Error("image mode should not use edits");
  });
  await page.route("**/images/generations", async () => {
    throw new Error("browser should not call upstream directly");
  });
  await page.route("**/api/jobs", async (route) => {
    jobContentType = route.request().headers()["content-type"];
    jobBody = route.request().postDataBuffer().toString("utf8");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ jobId: "job_image_mode", status: "queued" }),
    });
  });
  await page.route("**/api/jobs/job_image_mode", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        jobId: "job_image_mode",
        status: "succeeded",
        durationMs: 91000,
        result: jsonImagePayload({ size: "2560x1440", outputFormat: "webp" }),
      }),
    });
  });

  await page.goto("/");
  await page.locator("#mode").selectOption("image");
  await page.locator("#apiKey").fill("sk-page-key");
  await page.locator("#prompt").fill("edit this image as webp");
  await page.locator("#resolution").selectOption("2k");
  await page.locator("#outputFormat").selectOption("webp");
  await page.setInputFiles("#referenceImage", {
    name: "source.png",
    mimeType: "image/png",
    buffer: Buffer.from(tinyPng, "base64"),
  });
  await page.locator("#generate").click();

  await expect(page.locator("#resultImage")).toBeVisible();
  expect(jobContentType).toContain("multipart/form-data");
  expect(jobBody).toContain('name="referenceImage"');
  expect(jobBody).toContain("source.png");
  await expect(page.locator("#meta")).toContainText("2K");
  await expect(page.locator("#meta")).toContainText("webp");
});

test("image workspace blocks unsupported 4K square generation before sending a request", async ({ page }) => {
  let calls = 0;
  await page.route("**/images/generations", async (route) => {
    calls += 1;
    await fulfillDirectImage(route);
  });

  await page.goto("/");
  await page.locator("#apiKey").fill("sk-page-key");
  await page.locator("#prompt").fill("square 4k should be blocked");
  await page.locator("#aspect").selectOption("square");
  await page.locator("#resolution").selectOption("4k");
  await page.locator("#generate").click();

  await expect(page.getByRole("alert")).toContainText("4K 暂不支持方图");
  expect(calls).toBe(0);
});

test("image workspace saves with the selected file format and extension", async ({ page }) => {
  await page.route("**/api/jobs", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.outputFormat).toBe("jpeg");
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ jobId: "job_save", status: "queued" }) });
  });
  await page.route("**/api/jobs/job_save", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ jobId: "job_save", status: "succeeded", durationMs: 1200, result: jsonImagePayload({ outputFormat: "jpeg" }) }),
    });
  });

  await page.goto("/");
  await page.addInitScript(() => {});
  await page.evaluate(() => {
    window.__savedFile = null;
    window.showSaveFilePicker = async (options) => {
      window.__savePickerOptions = options;
      return {
        async createWritable() {
          return {
            async write(blob) {
              window.__savedFile = { type: blob.type, size: blob.size };
            },
            async close() {},
          };
        },
      };
    };
  });
  await page.locator("#apiKey").fill("sk-page-key");
  await page.locator("#prompt").fill("jpeg save test");
  await page.locator("#outputFormat").selectOption("jpeg");
  await page.locator("#generate").click();
  await page.locator("#saveImage").click();

  await expect
    .poll(() => page.evaluate(() => window.__savedFile && window.__savePickerOptions))
    .toBeTruthy();
  const saved = await page.evaluate(() => ({ file: window.__savedFile, options: window.__savePickerOptions }));
  expect(saved.file.type).toBe("image/jpeg");
  expect(saved.options.suggestedName).toMatch(/\.jpg$/);
});

test("image workspace explains timeout errors in Chinese", async ({ page }) => {
  await page.route("**/api/jobs", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ jobId: "job_timeout", status: "queued" }) });
  });
  await page.route("**/api/jobs/job_timeout", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ jobId: "job_timeout", status: "failed", error: "???? 10 ??????" }),
    });
  });

  await page.goto("/");
  await page.locator("#apiKey").fill("sk-page-key");
  await page.locator("#prompt").fill("a slow image");
  await page.locator("#generate").click();

  await expect(page.getByRole("alert")).toContainText("10 ??");
});

test("image workspace locks editing controls while generating and restores them", async ({ page }) => {
  let release;
  await page.route("**/api/jobs", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ jobId: "job_lock", status: "queued" }),
    });
  });
  await page.route("**/api/jobs/job_lock", async (route) => {
    await new Promise((resolve) => {
      release = resolve;
    });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ jobId: "job_lock", status: "succeeded", durationMs: 1200, result: jsonImagePayload() }),
    });
  });

  await page.goto("/");
  await page.locator("#apiKey").fill("sk-page-key");
  await page.locator("#prompt").fill("locking test");
  const generateClick = page.locator("#generate").click();

  await expect(page.locator("#apiKey")).toBeDisabled();
  await expect(page.locator("#baseUrl")).toBeDisabled();
  await expect(page.locator("#model")).toBeDisabled();
  await expect(page.locator("#aspect")).toBeDisabled();
  await expect(page.locator("#resolution")).toBeDisabled();
  await expect(page.locator("#mode")).toBeDisabled();
  await expect(page.locator("#prompt")).toBeDisabled();

  release();
  await generateClick;
  await expect(page.locator("#apiKey")).toBeEnabled();
  await expect(page.locator("#model")).toBeEnabled();
});

test("image workspace keeps the generated image inside the preview stage", async ({ page }) => {
  await mockSuccessfulJob(page);

  await page.goto("/");
  await page.locator("#apiKey").fill("sk-page-key");
  await page.locator("#prompt").fill("preview placement test");
  await page.locator("#generate").click();

  const stage = page.locator(".imageStage");
  const image = page.locator("#resultImage");
  await expect(stage).toBeVisible();
  await expect(image).toBeVisible();
  await expect(page.getByText("图片会出现在这里")).toBeHidden();

  const stageBox = await stage.boundingBox();
  const imageBox = await image.boundingBox();
  expect(stageBox).not.toBeNull();
  expect(imageBox).not.toBeNull();
  expect(imageBox.y).toBeGreaterThanOrEqual(stageBox.y);
  expect(imageBox.y + imageBox.height).toBeLessThanOrEqual(stageBox.y + stageBox.height + 1);
});

test("image workspace opens and closes the lightbox from the result image", async ({ page }) => {
  await mockSuccessfulJob(page);

  await page.goto("/");
  await page.locator("#apiKey").fill("sk-page-key");
  await page.locator("#prompt").fill("lightbox test");
  await page.locator("#generate").click();

  await page.locator("#resultImage").dblclick();
  await expect(page.locator("#lightbox")).toBeVisible();
  await expect(page.locator(".lightboxImage")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.locator("#lightbox")).toBeHidden();
});

test("image workspace opens the lightbox from a history thumbnail", async ({ page }) => {
  await mockSuccessfulJob(page);

  await page.goto("/");
  await page.locator("#apiKey").fill("sk-page-key");
  await page.locator("#prompt").fill("history lightbox test");
  await page.locator("#generate").click();

  await page.locator(".record img").dblclick();
  await expect(page.locator("#lightbox")).toBeVisible();
});

test("image workspace can remember the API key in this browser only", async ({ page }) => {
  await page.goto("/");
  await page.locator("#apiKey").fill("sk-local-key");
  await page.locator("#rememberApiKey").check();
  await page.reload();

  await expect(page.locator("#apiKey")).toHaveValue("sk-local-key");
});

test("image workspace keeps special characters in history as plain text", async ({ page }) => {
  await mockSuccessfulJob(page);

  await page.goto("/");
  await page.locator("#apiKey").fill("sk-page-key");
  await page.locator("#prompt").fill("<b>neon</b>");
  await page.locator("#generate").click();

  await expect(page.locator(".record p")).toHaveText("<b>neon</b>");
});

test("image workspace does not store full generated images in local history", async ({ page }) => {
  await mockSuccessfulJob(page);

  await page.goto("/");
  await page.locator("#apiKey").fill("sk-page-key");
  await page.locator("#prompt").fill("large image history storage test");
  await page.locator("#generate").click();

  await expect(page.locator("#resultImage")).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("image2-history") || "[]"));
  expect(stored).toHaveLength(1);
  expect(stored[0].src).toBeUndefined();
  expect(stored[0].thumbnailSrc).toMatch(/^data:image\/png;base64,/);
});

test("image workspace still shows the result when local history storage is full", async ({ page }) => {
  await mockSuccessfulJob(page);

  await page.goto("/");
  await page.evaluate(() => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function patchedSetItem(key, value) {
      if (key === "image2-history") {
        throw new DOMException("quota exceeded", "QuotaExceededError");
      }
      return originalSetItem.call(this, key, value);
    };
  });
  await page.locator("#apiKey").fill("sk-page-key");
  await page.locator("#prompt").fill("quota should not block generation");
  await page.locator("#generate").click();

  await expect(page.locator("#resultImage")).toBeVisible();
  await expect(page.locator("#status")).toContainText("生成完成");
  await expect(page.getByRole("alert")).toContainText("历史记录空间已满");
});

test("image workspace explains html job API responses in Chinese", async ({ page }) => {
  await page.route("**/api/jobs", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "text/html",
      body: "<!DOCTYPE html><html><body>Bad gateway</body></html>",
    });
  });

  await page.goto("/");
  await page.locator("#apiKey").fill("sk-page-key");
  await page.locator("#prompt").fill("neon library");
  await page.locator("#generate").click();

  await expect(page.getByRole("alert")).toContainText("服务器返回了网页");
});

test("image workspace ignores corrupt local history", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("image2-history", "{bad json"));
  await page.reload();

  await expect(page.getByText("还没有记录")).toBeVisible();
  await expect(page.locator("#generate")).toBeEnabled();
});

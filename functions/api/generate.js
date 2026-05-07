import imageApi from "../../src/image-api.js";

const { handleGenerateImage } = imageApi;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function onRequestPost(context) {
  try {
    const contentType = context.request.headers.get("content-type") || "";
    let input;
    if (contentType.includes("multipart/form-data")) {
      const form = await context.request.formData();
      const file = form.get("referenceImage");
      input = Object.fromEntries(form.entries());
      if (file && typeof file.arrayBuffer === "function") {
        input.image = {
          buffer: await file.arrayBuffer(),
          type: file.type,
          name: file.name,
        };
      }
    } else {
      input = await context.request.json();
    }
    const fetchImpl = context.fetch || fetch;
    return json(await handleGenerateImage(input, { fetchImpl }));
  } catch (error) {
    const status = error.status || 500;
    return json({ error: error.message || "服务异常" }, status);
  }
}

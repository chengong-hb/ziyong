import imageApi from "../../../src/image-api.js";

const { streamGenerateImage } = imageApi;

async function readInput(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("referenceImage");
    const input = Object.fromEntries(form.entries());
    if (file && typeof file.arrayBuffer === "function") {
      input.image = {
        buffer: await file.arrayBuffer(),
        type: file.type,
        name: file.name,
      };
    }
    return input;
  }
  return request.json();
}

export async function onRequestPost(context) {
  const input = await readInput(context.request);
  const encoder = new TextEncoder();
  const fetchImpl = context.fetch || fetch;
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const send = async (event) => {
    await writer.write(encoder.encode(`${JSON.stringify(event)}\n`));
  };
  const task = (async () => {
    try {
      await streamGenerateImage(input, {
        fetchImpl,
        onEvent: (event) => send(event),
      });
    } catch (error) {
      await send({
        type: "error",
        status: error.status || 500,
        error: error.message || "服务异常",
      });
    } finally {
      await writer.close();
    }
  })();
  context.waitUntil?.(task);

  return new Response(readable, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

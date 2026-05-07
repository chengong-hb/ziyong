function backendUrl(env) {
  return String(env?.JOBS_API_URL || "https://st-image2-api.onrender.com").replace(/\/+$/, "");
}

function copyHeaders(response) {
  return new Headers({
    "Content-Type": response.headers.get("Content-Type") || "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
}

export async function onRequestPost(context) {
  const response = await (context.fetch || fetch)(`${backendUrl(context.env)}/api/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": context.request.headers.get("Content-Type") || "application/json",
    },
    body: context.request.body,
  });
  return new Response(response.body, {
    status: response.status,
    headers: copyHeaders(response),
  });
}

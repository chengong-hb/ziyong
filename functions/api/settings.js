import imageApi from "../../src/image-api.js";

const { getPublicSettings } = imageApi;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function onRequestGet() {
  return json(await getPublicSettings());
}

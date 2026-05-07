const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

test("public sharing script starts the app and cloudflared tunnel", async () => {
  const scriptPath = path.join(__dirname, "..", "Start-Public-Share.ps1");
  const script = fs.readFileSync(scriptPath, "utf8");

  expect(script).toContain("D:\\LLQ\\codex\\1\\tools\\cloudflared.exe");
  expect(script).toContain("cloudflared");
  expect(script).toContain("tunnel");
  expect(script).toContain("--url");
  expect(script).toContain("http://127.0.0.1:{0}");
  expect(script).not.toContain("FamilyPassword");
  expect(script).not.toContain("RandomNumberGenerator");
  expect(script).toContain("trycloudflare.com");
});

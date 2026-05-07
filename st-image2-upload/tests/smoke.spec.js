const { test, expect } = require("@playwright/test");

test("playwright smoke test", async ({ page }) => {
  await page.setContent(`
    <html>
      <head><title>Playwright Smoke</title></head>
      <body>
        <button id="run">Run</button>
        <div id="status">idle</div>
        <script>
          document.getElementById("run").addEventListener("click", () => {
            document.getElementById("status").textContent = "done";
          });
        </script>
      </body>
    </html>
  `);

  await expect(page).toHaveTitle("Playwright Smoke");
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.locator("#status")).toHaveText("done");
});

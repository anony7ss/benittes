import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "msedge",
  headless: true,
});
const url = process.env.REVIEW_URL || "http://127.0.0.1:4321";
const pages = [
  "/",
  "/sobre/",
  "/servicos/",
  "/servicos/diagnostico/",
  "/servicos/manutencao-preventiva/",
  "/servicos/freios/",
  "/servicos/suspensao-e-direcao/",
  "/galeria/",
  "/contato/",
  "/perguntas-frequentes/",
  "/privacidade/",
  "/termos/",
  "/pagina-inexistente",
];
await mkdir("docs/revisao", { recursive: true });
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
    [768, 1024],
    [320, 700],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const path of pages) {
      const response = await page.goto(url + path);
      assert.equal(
        response.status(),
        path === "/pagina-inexistente" ? 404 : 200,
        path,
      );
      assert.equal(await page.locator("h1").count(), 1, path);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(
          [...document.images].map((image) =>
            image.decode().catch(() => undefined),
          ),
        );
      });
      await page.waitForTimeout(750);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        width + path,
      );
      if (path === "/") {
        await page.locator(".hero img").evaluate((img) => img.decode());
        const titleFont = await page
          .locator("h1")
          .evaluate((element) => getComputedStyle(element).fontFamily);
        const bodyFont = await page
          .locator("body")
          .evaluate((element) => getComputedStyle(element).fontFamily);
        assert.match(titleFont, /Poppins/);
        assert.match(bodyFont, /Poppins/);
        await page.screenshot({ path: `docs/revisao/inicio-${width}.png` });
        assert.equal(await page.locator("form[data-contact-form]").count(), 1);
        if (width < 821) {
          await page.locator(".menu-toggle").click();
          await page.screenshot({ path: `docs/revisao/menu-${width}.png` });
          await page.locator('nav a[href="/sobre/"]').click();
          assert.ok(page.url().endsWith("/sobre/"));
        }
        if (width === 1440) {
          const scrollable = await page.evaluate(
            () => document.documentElement.scrollHeight > innerHeight + 1,
          );
          assert.equal(
            await page
              .locator("body")
              .evaluate((body) => body.hasAttribute("data-footer-hidden")),
            scrollable,
          );
          if (scrollable) {
            await page.evaluate(() => window.scrollTo(0, 120));
            await page.waitForTimeout(220);
            assert.equal(
              await page
                .locator("body")
                .evaluate((body) => body.hasAttribute("data-footer-hidden")),
              false,
            );
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.waitForTimeout(220);
            assert.equal(
              await page
                .locator("body")
                .evaluate((body) => body.hasAttribute("data-footer-hidden")),
              true,
            );
          }
        }
      }
      if (path === "/contato/") {
        const form = page.locator("form[data-contact-form]");
        assert.ok(await form.isVisible());
        assert.equal(
          await form.locator('input[name="name"]').isVisible(),
          true,
        );
        assert.equal(
          await form.locator('input[name="email"]').isVisible(),
          true,
        );
        assert.equal(
          await form.locator('textarea[name="message"]').isVisible(),
          true,
        );
        assert.equal(await page.locator(".contact-methods > *").count(), 3);
        const recipient = await form.getAttribute("data-recipient");
        assert.equal(
          await form.locator('button[type="submit"]').isDisabled(),
          !recipient,
        );
        if (width === 390 || width === 1440) {
          await page.screenshot({
            path: `docs/revisao/contato-${width}.png`,
            fullPage: true,
          });
        }
        if (width === 1440) {
          assert.equal(
            await page
              .locator("body")
              .evaluate((body) => body.hasAttribute("data-footer-hidden")),
            true,
          );
          await page.evaluate(() => window.scrollTo(0, 120));
          await page.waitForTimeout(220);
          assert.equal(
            await page
              .locator("body")
              .evaluate((body) => body.hasAttribute("data-footer-hidden")),
            false,
          );
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.waitForTimeout(220);
          assert.equal(
            await page
              .locator("body")
              .evaluate((body) => body.hasAttribute("data-footer-hidden")),
            true,
          );
        }
      }
      if (path === "/galeria/") {
        await page.locator(".zoom").first().click();
        assert.ok(await page.locator("dialog").isVisible());
        if (width === 390)
          await page.screenshot({ path: "docs/revisao/galeria-modal-390.png" });
        await page.keyboard.press("Escape");
        assert.equal(await page.locator("dialog").isVisible(), false);
      }
      if (path === "/perguntas-frequentes/") {
        await page.locator("summary").first().press("Enter");
        assert.ok(
          (await page.locator("details").first().getAttribute("open")) !== null,
        );
        if (width === 390)
          await page.screenshot({ path: "docs/revisao/faq-aberta-390.png" });
      }
    }
    assert.deepEqual(errors, []);
    console.log(width + "px: " + pages.length + " rotas verificadas");
    await page.close();
  }
} finally {
  await browser.close();
}

exports.next = async (page, accept = true) => {
  await page.evaluate((accept) => {
    window.addEventListener(
      "site-confirm-open",
      () => {
        document
          .querySelector(accept ? "[data-confirm-yes]" : "[data-confirm-no]")
          .click();
      },
      { once: true },
    );
  }, accept);
};
exports.auto = async (page) => {
  await page.addInitScript(() => {
    window.addEventListener("site-confirm-open", () =>
      document.querySelector("[data-confirm-yes]").click(),
    );
  });
};

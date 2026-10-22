/**
 * Step definitions for scenario GIF captures.
 * Defines deterministic, non-flaky animation steps for marketing showcases.
 */

export function getScenarioGifSteps(scenarioId, page) {
  if (scenarioId.includes("05")) {
    return [
      { action: async () => {}, delayMs: 1200 },
      // Hover over license copy button
      {
        action: async () => {
          try {
            const copyBtn = await page.$('button:has-text("Copy")');
            if (copyBtn) await copyBtn.hover({ force: true });
          } catch {}
        },
        delayMs: 800,
      },
      // Switch to Profiles tab in settings
      {
        action: async () => {
          try {
            const tabBtn = await page.$('button:has-text("Profiles")');
            if (tabBtn) await tabBtn.click({ force: true });
            await page.waitForTimeout(200);
          } catch {}
        },
        delayMs: 1000,
      },
      // Switch back to Account tab to feature Tier 3 & 3 Devices
      {
        action: async () => {
          try {
            const tabBtn = await page.$('button:has-text("Account")');
            if (tabBtn) await tabBtn.click({ force: true });
            await page.waitForTimeout(200);
          } catch {}
        },
        delayMs: 1400,
      },
    ];
  }

  if (scenarioId.includes("03")) {
    return [
      { action: async () => {}, delayMs: 800 },
      {
        action: async () => {
          try {
            const input = await page.$('input[placeholder*="Search"]');
            if (input) await input.fill("cli");
          } catch {}
        },
        delayMs: 400,
      },
      {
        action: async () => {
          try {
            const input = await page.$('input[placeholder*="Search"]');
            if (input) await input.fill("client");
          } catch {}
        },
        delayMs: 900,
      },
      {
        action: async () => {
          try {
            const item = await page.$("[data-item-active], [role='option'], .group");
            if (item) await item.hover({ force: true });
          } catch {}
        },
        delayMs: 700,
      },
      { action: async () => {}, delayMs: 900 },
    ];
  }

  if (scenarioId.includes("01")) {
    return [
      { action: async () => {}, delayMs: 1000 },
      {
        action: async () => {
          try {
            const timeSlots = await page.$$("button");
            if (timeSlots.length > 5) await timeSlots[5].hover({ force: true });
          } catch {}
        },
        delayMs: 700,
      },
      {
        action: async () => {
          try {
            const slides = await page.$$(".cursor-pointer");
            if (slides.length > 2) await slides[2].hover({ force: true });
          } catch {}
        },
        delayMs: 700,
      },
      { action: async () => {}, delayMs: 1000 },
    ];
  }

  if (scenarioId.includes("04")) {
    return [
      { action: async () => {}, delayMs: 1000 },
      {
        action: async () => {
          try {
            const emailRows = await page.$$("div.cursor-pointer, [data-interactive]");
            if (emailRows[0]) await emailRows[0].hover({ force: true });
          } catch {}
        },
        delayMs: 700,
      },
      {
        action: async () => {
          try {
            const emailRows = await page.$$("div.cursor-pointer, [data-interactive]");
            if (emailRows.length > 3) await emailRows[3].hover({ force: true });
          } catch {}
        },
        delayMs: 700,
      },
      { action: async () => {}, delayMs: 1000 },
    ];
  }

  // Default / 02: Client Tools Isolation
  return [
    { action: async () => {}, delayMs: 1000 },
    {
      action: async () => {
        try {
          const hoverTargets = await page.$$("button, div.cursor-pointer");
          if (hoverTargets.length > 2) await hoverTargets[2].hover({ force: true });
        } catch {}
      },
      delayMs: 700,
    },
    { action: async () => {}, delayMs: 1000 },
  ];
}

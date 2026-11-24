/**
 * Keyboard and screen-reader checks for the Run panel, the trace bar, the
 * Components icon strip and the update notices (#410).
 *
 * Icon strip: Tab reaches every category icon and shortcut; each is a named
 * button with a visible focus ring; Enter opens a category's menu (and says
 * so with aria-expanded) and picks up a shortcut, whose placing hint is a
 * status message; Escape backs out. Keyboard focus shows a row's hidden ☆ in
 * the full list. The strip's headings read at WCAG AA.
 *
 * Run panel: "Arrange inputs" is a named group; a bad bracket input is marked
 * invalid and points at its error message; each trial's ✕ says which trial it
 * removes; a run's trial count goes to a live region and the notices stack is
 * a live region; Show Δ reads at WCAG AA. After a run, the current trial card
 * and the active step's rows carry aria-current (so the step isn't told by
 * colour alone), and the trace bar's arrow buttons and step number have
 * names and work from the keyboard.
 *
 * Contrast (#412): no text in the faint or hint grey on the icon strip, the
 * Run panel or the trace bar, and no row of the current trial card not
 * reached yet at the trace step, reads below WCAG AA (4.5:1).
 *
 * Updates: the automatic-install question takes focus on its safe answer; the
 * update notice's Later reads at WCAG AA. (pnvSettings bridge stubbed.)
 */
import type { Locator, Page } from "@playwright/test";
import { readOnlyTest as test, expect, closePalette } from "./test-base";

/** The WCAG contrast ratio of an element's text against what is behind it. */
async function contrast(el: Locator): Promise<number> {
  return el.evaluate((node) => {
    const parse = (c: string) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    };
    const lum = (rgb: number[]) => {
      const f = (v: number) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
    };
    // The background: blend each translucent layer down to the first opaque one.
    const layers: number[][] = [];
    for (let e: Element | null = node; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c[3] > 0) {
        layers.push(c);
        if (c[3] >= 1) break;
      }
    }
    let bg = [255, 255, 255];
    for (const l of layers.reverse()) bg = bg.map((v, i) => v * (1 - l[3]) + l[i] * l[3]);
    const fg = parse(getComputedStyle(node).color)!;
    const text = fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
    const [a, b] = [lum(text), lum(bg)];
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}

/**
 * Text drawn in the faint or hint grey (or a not-yet-reached row's grey)
 * inside `scope` that reads below WCAG AA on what is behind it (#412).
 * Returns "text: ratio" for each, so an empty list is a pass.
 */
async function faintTextBelowAA(scope: Locator): Promise<string[]> {
  return scope.evaluate((root) => {
    const probe = document.createElement("span");
    document.body.appendChild(probe);
    const resolve = (v: string) => {
      probe.style.color = `var(${v})`;
      return getComputedStyle(probe).color;
    };
    const greys = new Set(["--pnv-text-faint", "--pnv-text-hint", "--pnv-step-pending-text"].map(resolve));
    probe.remove();
    const parse = (c: string) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    };
    const lum = (rgb: number[]) => {
      const f = (v: number) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
    };
    const low: string[] = [];
    for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
      const cs = getComputedStyle(el);
      if (!greys.has(cs.color)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (!Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim())) continue;
      // Opacity on the way up dims the text; the first opaque background is behind it.
      let opacity = 1;
      const layers: number[][] = [];
      for (let e: Element | null = el; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        opacity *= Number(s.opacity);
        const c = parse(s.backgroundColor);
        if (c && c[3] > 0 && layers.every((l) => l[3] < 1)) layers.push(c);
      }
      let bg = [255, 255, 255];
      for (const l of layers.reverse()) bg = bg.map((v, i) => v * (1 - l[3]) + l[i] * l[3]);
      const fg = parse(cs.color)!;
      const a = fg[3] * opacity;
      const text = fg.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a));
      const [x, y] = [lum(text), lum(bg)];
      const ratio = (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      if (ratio < 4.5) low.push(`${el.textContent!.trim().slice(0, 40)}: ${ratio.toFixed(2)}`);
    }
    return low;
  });
}

const focused = (page: Page) => page.locator(":focus");

async function focusRing(page: Page): Promise<string> {
  return focused(page).evaluate((e) => getComputedStyle(e).outlineStyle);
}

test.describe("accessibility: Run panel, trace bar, icon strip, notices (#410)", { tag: "@ci" }, () => {
  test("the icon strip works from the keyboard", async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => {
      localStorage.setItem("psyneuview_palette_favorites", JSON.stringify(["TransferMechanism"]));
      localStorage.setItem("psyneuview_palette_recents", JSON.stringify(["DDM"]));
      localStorage.setItem("psyneuview.components.start", "strip");
      localStorage.setItem("psyneuview.components.stripShortcuts", "true");
      localStorage.setItem("psyneuview.components.stripHeadings", "true");
    });
    await page.goto("/");
    // A model open, so a picked-up component has a graph to go on.
    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByText("Stroop").first().click();
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
    const palette = page.getByTestId("palette-sidebar");
    await expect(palette.getByTestId("palette-category")).toHaveCount(4);

    // Tab from the chevron through the four categories, then the shortcuts.
    await palette.getByTestId("palette-strip-expand").focus();
    for (const name of ["Mechanisms", "Projections", "Compositions", "Functions"]) {
      await page.keyboard.press("Tab");
      await expect(focused(page)).toHaveAttribute("data-testid", "palette-category");
      await expect(focused(page)).toHaveAttribute("role", "button");
      await expect(focused(page)).toHaveAccessibleName(name);
      await expect(focused(page)).toHaveAttribute("aria-expanded", "false");
      expect(await focusRing(page), `${name}: a focus ring`).not.toBe("none");
    }

    // Enter opens the focused category's menu; Escape closes it.
    const functions = palette.getByTestId("palette-category").last();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("palette-compact-flyout")).toBeVisible();
    await expect(functions).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("palette-compact-flyout")).toHaveCount(0);

    // The shortcuts come next: named buttons; Enter picks one up.
    await functions.focus();
    await page.keyboard.press("Tab");
    const fav = focused(page);
    await expect(fav).toHaveAttribute("data-shortcut", "favourite");
    await expect(fav).toHaveAccessibleName(/^Favourite: /);
    expect(await focusRing(page)).not.toBe("none");
    await page.keyboard.press("Tab");
    await expect(focused(page)).toHaveAttribute("data-shortcut", "recent");
    await page.keyboard.press("Enter");
    const tile = palette.locator('[data-shortcut="recent"]');
    await expect(tile).toHaveAttribute("data-armed", "true");
    await expect(tile).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("place-component-hint")).toHaveAttribute("role", "status");
    await page.keyboard.press("Escape");
    await expect(tile).not.toHaveAttribute("data-armed", "true");

    // The headings read at WCAG AA.
    for (const id of ["palette-strip-heading-components-text", "palette-strip-heading-shortcuts-text"]) {
      expect(await contrast(palette.getByTestId(id)), id).toBeGreaterThanOrEqual(4.5);
    }

    // No faint or hint grey text on the strip reads below AA (#412).
    expect(await faintTextBelowAA(palette), "icon strip").toEqual([]);

    // In the full list, keyboard focus shows a row's hidden ☆.
    await palette.getByTestId("palette-strip-expand").click();
    const star = palette.locator('[data-testid="palette-fav-star"][data-starred="false"]').first();
    await expect(star).toHaveCSS("opacity", "0");
    await star.focus();
    await expect(star).toHaveCSS("opacity", "1");
    await expect(star).toHaveAccessibleName(/^Add .+ to favorites$/);
  });

  test("the Run panel and trace bar name their controls and announce progress", async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("/");
    await expect(page.getByTestId("notification-stack")).toHaveAttribute("aria-live", "polite");
    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByText("Stroop").first().click();
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
    await closePalette(page);
    await page.getByTestId("tab-run").click();

    await expect(page.getByRole("group", { name: "Arrange inputs" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove trial 2" }).first()).toBeVisible();

    // A bad entry is marked invalid and points at its message.
    const input = page.locator('[data-testid^="run-trial-input-"]').first();
    const before = await input.inputValue();
    await input.fill("[1, x");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    const describedBy = (await input.getAttribute("aria-describedby"))!;
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`[id="${describedBy}"]`)).toBeVisible();
    await expect(input).toHaveAccessibleDescription(/.+/);
    await input.fill(before);
    await expect(input).not.toHaveAttribute("aria-invalid", "true");
    await expect(input).not.toHaveAttribute("aria-describedby");

    // The trial count is a live region, there before the run starts.
    await expect(page.getByTestId("run-trial-progress-live")).toHaveAttribute("role", "status");
    await page.getByRole("button", { name: /Run Model/ }).click();
    await expect(page.getByTestId("run-trial-card-1")).toBeVisible({ timeout: 60_000 });

    expect(await contrast(page.getByTestId("run-trial-deltas")), "Show Δ, off").toBeGreaterThanOrEqual(4.5);

    // The trace bar's arrows have names; stepping marks the current card and
    // the active rows with aria-current, not colour alone.
    const next = page.getByRole("button", { name: "Next step" });
    await expect(page.getByRole("button", { name: "Previous step" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Clear trace" })).toBeVisible();
    await expect(page.getByTestId("trace-autoplay")).toHaveAccessibleName(/Auto-play/);
    await next.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    const card = page.locator('[data-testid^="run-trial-card-"][aria-current="true"]');
    await expect(card).toHaveCount(1);
    await expect(card.locator('[data-testid="run-trial-node-band"][aria-current="step"]').first()).toBeVisible();

    // Faint and hint grey text, and the rows not reached yet in the current
    // trial card, read at AA in the Run panel and the trace bar (#412).
    await expect(card.locator('[data-testid="run-trial-node-band"][data-step="pending"]').first()).toBeVisible();
    expect(await faintTextBelowAA(page.getByTestId("run-panel")), "Run panel").toEqual([]);
    expect(await faintTextBelowAA(next.locator("..")), "trace bar").toEqual([]);
    const pendingName = card.locator('[data-testid="run-trial-node-band"][data-step="pending"] span').first();
    expect(await contrast(pendingName), "a row not reached yet").toBeGreaterThanOrEqual(4.5);
    await expect(page.locator('[data-testid="run-trial-node-band"][aria-current="step"]')).toHaveCount(
      await page.locator('[data-testid="run-trial-node-band"][data-step="active"]').count(),
    );

    // The step number is a button: Enter opens a labelled box to jump.
    const stepNumber = page.getByRole("button", { name: /^Step \d+ of \d+\. Press Enter/ });
    await stepNumber.focus();
    expect(await focusRing(page)).not.toBe("none");
    await page.keyboard.press("Enter");
    const jump = page.getByRole("spinbutton", { name: /^Jump to step/ });
    await expect(jump).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(jump).toHaveCount(0);
  });

  test("the automatic-install question takes focus; the update notice reads at AA", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      const state: Record<string, unknown> = {
        install: { running: "PsyNeuView 0.6.15", choice: "bundled", checkoutPath: null, includedVersion: "0.6.15", recentCheckouts: [] },
        app: { name: "PsyNeuView", version: "0.6.15", build: "0.6.15", builtAt: null },
        autoRestart: false, launchAtLogin: false, developerMode: false,
        reportSendWith: "ask", reportSendTo: "", reportSendToDefault: "contact@example.org",
        autoInstallUpdates: false, autoInstallOffer: true, lastUpdateCheck: null, justUpdated: null,
        appUpdate: { available: true, version: "0.6.18" },
      };
      w.webkit = {
        messageHandlers: {
          pnvSettings: {
            postMessage: async (body: { op: string }) => {
              if (body.op === "answerAutoInstallOffer") state.autoInstallOffer = false;
              return JSON.parse(JSON.stringify(state));
            },
          },
        },
      };
    });
    await page.goto("/");
    await expect(page.getByTestId("auto-install-offer")).toBeVisible();
    await expect(page.getByTestId("auto-install-offer-no")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("auto-install-offer")).toHaveCount(0);
    const later = page.getByTestId("app-update-later");
    await expect(later).toBeVisible();
    expect(await contrast(later), "Later on the notice's tint").toBeGreaterThanOrEqual(4.5);
  });
});

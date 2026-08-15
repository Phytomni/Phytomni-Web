/** Standalone Deep Genome Artifact visual fixture; never registered by production routes. */
import { createApp, nextTick } from "vue";
import { createPinia } from "pinia";
import ElementPlus from "element-plus";
import i18n, { setLanguage } from "@/locales";
import { useThemeStore } from "@/stores";
import DeepGenomeArtifactVisualFixtureApp from "./DeepGenomeArtifactVisualFixtureApp.vue";

import "@fontsource/inter/400";
import "@fontsource/inter/600";
import "element-plus/dist/index.css";
import "@/styles/tokens.css";
import "@/styles/markdown.css";
import "@/assets/main.css";

const params = new URLSearchParams(window.location.search);
const locale = params.get("locale") === "zh-CN" ? "zh-CN" : "en-US";
const theme = params.get("theme") === "dark" ? "dark" : "light";
const fixtureCase = params.get("case") === "contract" ? "contract" : "real";
const VISUAL_READINESS_TIMEOUT_MS = 5_000;

declare global {
  interface Window {
    __scientificMarkdownHostileImageExecuted?: boolean;
    assertScientificMarkdownVisualContract?: () => unknown;
  }
}

function requiredElement<T extends Element>(
  selector: string,
  root: ParentNode = document
): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`scientific Markdown visual contract: missing ${selector}`);
  }
  return element;
}

function tokenColor(
  root: HTMLElement,
  property: "backgroundColor" | "color",
  token: string
): string {
  const probe = document.createElement("span");
  probe.style[property] = `var(${token})`;
  root.append(probe);
  const color = getComputedStyle(probe)[property];
  probe.remove();
  return color;
}

function opaqueBackground(element: Element): string {
  for (
    let current: Element | null = element;
    current;
    current = current.parentElement
  ) {
    const color = getComputedStyle(current).backgroundColor;
    if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent") return color;
  }
  throw new Error("scientific Markdown visual contract: no opaque background");
}

function relativeLuminance(color: string): number {
  const channels = color
    .match(/\d+(?:\.\d+)?/g)
    ?.slice(0, 3)
    .map(Number);
  if (!channels || channels.length !== 3) {
    throw new Error(
      `scientific Markdown visual contract: unsupported color ${color}`
    );
  }
  const linear = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground: string, background: string): number {
  const light = Math.max(
    relativeLuminance(foreground),
    relativeLuminance(background)
  );
  const dark = Math.min(
    relativeLuminance(foreground),
    relativeLuminance(background)
  );
  return (light + 0.05) / (dark + 0.05);
}

function assertScientificMarkdownVisualContract() {
  const root = requiredElement<HTMLElement>(
    '[data-testid="deep-genome-visual-root"]'
  );
  const markdown = requiredElement<HTMLElement>(
    ".phy-markdown--document",
    root
  );
  const paragraph = requiredElement<HTMLParagraphElement>(
    ".elx-xmarkdown-container p",
    markdown
  );
  const viewer = requiredElement<HTMLElement>(
    ".scientific-cif-viewer",
    markdown
  );
  const canvas = requiredElement<HTMLCanvasElement>("canvas", viewer);
  const image = requiredElement<HTMLImageElement>(
    ".scientific-image__thumbnail",
    markdown
  );

  const expectedForeground = tokenColor(root, "color", "--phy-color-text");
  const paragraphForeground = getComputedStyle(paragraph).color;
  if (paragraphForeground !== expectedForeground) {
    throw new Error(
      `scientific Markdown visual contract: paragraph foreground ${paragraphForeground} != ${expectedForeground}`
    );
  }

  const tableHeaders = [
    ...markdown.querySelectorAll<HTMLTableCellElement>("thead th"),
  ];
  const tableRows = [
    ...markdown.querySelectorAll<HTMLTableRowElement>("tbody tr"),
  ];
  const tableCells = [
    ...markdown.querySelectorAll<HTMLTableCellElement>("tbody td"),
  ];
  const expectedHeaderBackground = tokenColor(
    root,
    "backgroundColor",
    "--phy-color-fill-subtle"
  );
  const expectedBodyBackground = tokenColor(
    root,
    "backgroundColor",
    "--phy-color-bg-elevated"
  );
  if (!tableHeaders.length || !tableRows.length || !tableCells.length) {
    throw new Error(
      "scientific Markdown visual contract: evidence table is incomplete"
    );
  }
  for (const header of tableHeaders) {
    const style = getComputedStyle(header);
    if (
      style.color !== expectedForeground ||
      style.backgroundColor !== expectedHeaderBackground
    ) {
      throw new Error(
        "scientific Markdown visual contract: table header misses semantic tokens"
      );
    }
    if (contrastRatio(style.color, style.backgroundColor) < 4.5) {
      throw new Error(
        "scientific Markdown visual contract: table header contrast is insufficient"
      );
    }
  }
  for (const row of tableRows) {
    if (opaqueBackground(row) !== expectedBodyBackground) {
      throw new Error(
        "scientific Markdown visual contract: report row misses semantic background"
      );
    }
  }
  for (const cell of tableCells) {
    const style = getComputedStyle(cell);
    const background = opaqueBackground(cell);
    if (
      style.color !== expectedForeground ||
      background !== expectedBodyBackground
    ) {
      throw new Error(
        "scientific Markdown visual contract: table cell misses semantic tokens"
      );
    }
    if (contrastRatio(style.color, background) < 4.5) {
      throw new Error(
        "scientific Markdown visual contract: table cell contrast is insufficient"
      );
    }
  }

  const hostileMarkup =
    '<img src="/private/report.png" onerror="window.__scientificMarkdownHostileImageExecuted = true">';
  if (
    !markdown.textContent?.includes(hostileMarkup) ||
    markdown.querySelector('img[src="/private/report.png"], img[onerror]') ||
    window.__scientificMarkdownHostileImageExecuted
  ) {
    throw new Error(
      "scientific Markdown visual contract: hostile raw image executed"
    );
  }

  const viewerRect = viewer.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  const tolerance = 1;
  if (
    canvas.offsetParent !== viewer ||
    canvasRect.left < viewerRect.left - tolerance ||
    canvasRect.top < viewerRect.top - tolerance ||
    canvasRect.right > viewerRect.right + tolerance ||
    canvasRect.bottom > viewerRect.bottom + tolerance
  ) {
    throw new Error("scientific Markdown visual contract: CIF canvas escapes");
  }

  const imageUrl = new URL(image.currentSrc);
  if (
    imageUrl.origin !== window.location.origin ||
    !image.complete ||
    image.naturalWidth === 0
  ) {
    throw new Error(
      "scientific Markdown visual contract: authorized image is not loaded from this origin"
    );
  }

  if (
    document.documentElement.scrollWidth >
    document.documentElement.clientWidth + tolerance
  ) {
    throw new Error(
      "scientific Markdown visual contract: document horizontal overflow"
    );
  }

  return {
    pass: true,
    theme,
    foreground: paragraphForeground,
    image: imageUrl.pathname,
    cif: {
      width: viewerRect.width,
      height: viewerRect.height,
    },
  };
}

Object.assign(window, { assertScientificMarkdownVisualContract });

function waitForVisualReadiness(root: HTMLElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = performance.now() + VISUAL_READINESS_TIMEOUT_MS;
    const check = () => {
      const image = root.querySelector<HTMLImageElement>(
        ".scientific-image__thumbnail"
      );
      const viewer = root.querySelector<HTMLElement>(".scientific-cif-viewer");
      const canvas = viewer?.querySelector<HTMLCanvasElement>("canvas");
      if (
        image?.complete &&
        image.naturalWidth > 0 &&
        viewer?.dataset.scientificCifReady === "true" &&
        canvas &&
        canvas.width > 0 &&
        canvas.height > 0
      ) {
        resolve();
        return;
      }
      if (image?.complete && image.naturalWidth === 0) {
        reject(
          new Error(
            "scientific Markdown visual fixture: authorized image failed"
          )
        );
        return;
      }
      if (!viewer && root.textContent?.includes("Structure unavailable")) {
        reject(new Error("scientific Markdown visual fixture: CIF failed"));
        return;
      }
      if (performance.now() >= deadline) {
        reject(
          new Error("scientific Markdown visual fixture: readiness timed out")
        );
        return;
      }
      requestAnimationFrame(check);
    };
    check();
  });
}

async function boot() {
  const app = createApp(DeepGenomeArtifactVisualFixtureApp);
  const pinia = createPinia();

  app.use(pinia);
  app.use(i18n);
  app.use(ElementPlus, { size: "default" });

  window.__scientificMarkdownHostileImageExecuted = false;
  useThemeStore().setTheme(theme);
  await setLanguage(locale);

  app.mount("#app");
  await nextTick();
  if (document.fonts) {
    await document.fonts.ready;
  }

  const root = requiredElement<HTMLElement>(
    "[data-testid=deep-genome-visual-root]"
  );
  root.setAttribute("data-fixture-case", fixtureCase);
  await waitForVisualReadiness(root);
  root.setAttribute("data-fixture-ready", "true");
}

void boot().catch((error: unknown) => {
  const root = document.querySelector<HTMLElement>(
    "[data-testid=deep-genome-visual-root]"
  );
  root?.setAttribute(
    "data-fixture-error",
    error instanceof Error ? error.message : String(error)
  );
  console.error(error);
});

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

  const foregroundProbe = document.createElement("span");
  foregroundProbe.style.color = "var(--phy-color-text)";
  root.append(foregroundProbe);
  const expectedForeground = getComputedStyle(foregroundProbe).color;
  foregroundProbe.remove();
  const paragraphForeground = getComputedStyle(paragraph).color;
  if (paragraphForeground !== expectedForeground) {
    throw new Error(
      `scientific Markdown visual contract: paragraph foreground ${paragraphForeground} != ${expectedForeground}`
    );
  }

  const tableRows = [
    ...markdown.querySelectorAll<HTMLTableRowElement>("tbody tr"),
  ];
  if (
    theme === "dark" &&
    tableRows.some(
      (row) => getComputedStyle(row).backgroundColor === "rgb(255, 255, 255)"
    )
  ) {
    throw new Error(
      "scientific Markdown visual contract: dark report row keeps a light background"
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

async function boot() {
  const app = createApp(DeepGenomeArtifactVisualFixtureApp);
  const pinia = createPinia();

  app.use(pinia);
  app.use(i18n);
  app.use(ElementPlus, { size: "default" });

  useThemeStore().setTheme(theme);
  await setLanguage(locale);

  app.mount("#app");
  await nextTick();
  if (document.fonts) {
    await document.fonts.ready;
  }

  document
    .querySelector<HTMLElement>("[data-testid=deep-genome-visual-root]")
    ?.setAttribute("data-fixture-ready", "true");
  document
    .querySelector<HTMLElement>("[data-testid=deep-genome-visual-root]")
    ?.setAttribute("data-fixture-case", fixtureCase);
}

void boot();

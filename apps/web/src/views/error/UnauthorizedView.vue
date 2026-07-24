<template>
  <main
    class="phy-recovery-page"
    data-scroll-root="recovery"
    data-recovery-page="401"
    aria-labelledby="recovery-401-title"
  >
    <div class="phy-recovery-content">
      <section class="phy-recovery-card">
        <div class="phy-recovery-visual" aria-hidden="true">
          <svg
            class="phy-recovery-illustration"
            viewBox="0 0 220 180"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            focusable="false"
          >
            <path
              class="phy-recovery-illustration__leaf"
              d="M164 29C119 30 77 50 65 87c-8 25 3 48 26 54 23 6 47-12 57-37 11-27 9-49 16-75Z"
              fill="currentColor"
              fill-opacity="0.14"
              stroke="currentColor"
              stroke-width="2"
            />
            <path
              d="M45 153c27-49 61-80 119-113"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-width="2"
            />
            <path
              class="phy-recovery-illustration__data-line"
              d="m85 106 18-20 17 11 20-28 19 8"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
            />
            <circle cx="85" cy="106" r="4" fill="currentColor" />
            <circle cx="103" cy="86" r="4" fill="currentColor" />
            <circle cx="120" cy="97" r="4" fill="currentColor" />
            <circle cx="140" cy="69" r="4" fill="currentColor" />
            <circle cx="159" cy="77" r="4" fill="currentColor" />
            <path
              d="M18 154h184"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-opacity="0.28"
            />
          </svg>
        </div>

        <div class="phy-recovery-copy">
          <p class="phy-recovery-code">401</p>
          <h1 id="recovery-401-title" class="phy-recovery-title">
            {{ $t("errorPage.e401Title") }}
          </h1>
          <PhyErrorState
            class="phy-recovery-summary"
            :description="$t('errorPage.e401NoAccess')"
          />
          <p class="phy-recovery-detail">
            {{ $t("errorPage.e401Detail") }}
          </p>

          <div class="phy-recovery-actions">
            <button
              type="button"
              class="phy-recovery-action phy-recovery-action--primary"
              data-action="back"
              @click="back"
            >
              {{ $t("errorPage.back") }}
            </button>
            <router-link
              to="/"
              class="phy-recovery-action phy-recovery-action--secondary"
              data-action="home"
            >
              {{ $t("errorPage.goHome") }}
            </router-link>
          </div>
        </div>
      </section>
    </div>
    <Footer class="recovery-footer" />
  </main>
</template>

<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import Footer from "@/components/AppFooter.vue";
import PhyErrorState from "@/components/state/PhyErrorState.vue";

const route = useRoute();
const router = useRouter();

function back() {
  if (route.query.noGoBack) {
    router.push("/").catch(() => undefined);
    return;
  }

  router.go(-1);
}
</script>

<style scoped>
.phy-recovery-page {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  min-height: 100%;
  min-height: 100dvh;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  background: var(--phy-color-bg-page);
  color: var(--phy-color-text);
  font-family: var(--phy-font-shell);
}

.phy-recovery-content {
  display: grid;
  flex: 1 0 auto;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  place-items: center;
  padding: clamp(var(--phy-space-24), 7vh, var(--phy-space-64))
    var(--phy-space-16);
}

.phy-recovery-card {
  display: grid;
  grid-template-columns: minmax(180px, 0.85fr) minmax(0, 1fr);
  width: min(100%, var(--phy-layout-reading-max-width, 760px));
  min-width: 0;
  align-items: center;
  gap: clamp(var(--phy-space-24), 6vw, var(--phy-space-64));
  box-sizing: border-box;
  padding: clamp(var(--phy-space-24), 5vw, var(--phy-space-48));
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-lg);
  background: var(--phy-color-bg-elevated);
  box-shadow: var(--phy-shadow-soft);
}

.phy-recovery-visual {
  display: grid;
  place-items: center;
  min-width: 0;
  color: var(--phy-color-accent);
}

.phy-recovery-illustration {
  display: block;
  width: min(100%, 220px);
  height: auto;
}

.phy-recovery-illustration__leaf {
  color: var(--phy-color-accent);
}

.phy-recovery-illustration__data-line {
  color: var(--phy-color-brand-blue);
}

.phy-recovery-copy {
  min-width: 0;
  overflow-wrap: anywhere;
}

.phy-recovery-summary {
  margin-top: var(--phy-space-12);
}

.phy-recovery-summary :deep(.phy-error-state__description) {
  color: var(--phy-color-text);
  font-size: 1.05rem;
  font-weight: 600;
  line-height: 1.5;
}

.recovery-footer {
  flex: 0 0 auto;
  width: min(100%, var(--phy-layout-reading-max-width, 760px));
}

.phy-recovery-code {
  margin: 0 0 var(--phy-space-8);
  color: var(--phy-color-action-text);
  font-family: var(--phy-font-mono);
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.12em;
}

.phy-recovery-title {
  margin: 0;
  color: var(--phy-color-text);
  font-size: clamp(1.55rem, 4vw, 2.25rem);
  line-height: 1.15;
}

.phy-recovery-detail {
  margin: var(--phy-space-12) 0 0;
  color: var(--phy-color-text-secondary);
  line-height: 1.65;
}

.phy-recovery-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--phy-space-12);
  margin-top: var(--phy-space-24);
}

.phy-recovery-action {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 0 var(--phy-space-16);
  border: 1px solid transparent;
  border-radius: var(--phy-radius-sm);
  font: inherit;
  font-weight: 600;
  line-height: 1.2;
  text-decoration: none;
  cursor: pointer;
  transition: background-color var(--phy-motion-fast) var(--phy-motion-ease-out),
    border-color var(--phy-motion-fast) var(--phy-motion-ease-out),
    color var(--phy-motion-fast) var(--phy-motion-ease-out);
}

.phy-recovery-action--primary {
  border-color: var(--phy-color-action-fill);
  background: var(--phy-color-action-fill);
  color: var(--phy-color-on-action);
}

.phy-recovery-action--primary:hover {
  border-color: var(--phy-color-action-fill-hover);
  background: var(--phy-color-action-fill-hover);
}

.phy-recovery-action--secondary {
  border-color: var(--phy-color-border-control);
  background: var(--phy-color-bg-elevated);
  color: var(--phy-color-action-text);
}

.phy-recovery-action--secondary:hover {
  border-color: var(--phy-color-action-text);
  background: var(--phy-color-brand-blue-soft);
}

.phy-recovery-action:focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 3px;
}

@media (max-width: 599px) {
  .phy-recovery-page {
    align-items: stretch;
  }

  .phy-recovery-content {
    place-items: start center;
    padding-top: var(--phy-space-24);
  }

  .phy-recovery-card {
    grid-template-columns: 1fr;
    gap: var(--phy-space-20);
  }

  .phy-recovery-visual {
    justify-content: start;
  }

  .phy-recovery-illustration {
    width: min(100%, 180px);
  }
}

@media (max-width: 389px) {
  .phy-recovery-page {
    align-items: stretch;
  }

  .phy-recovery-content {
    padding-inline: var(--phy-space-12);
  }

  .phy-recovery-card {
    padding: var(--phy-space-20) var(--phy-space-16);
  }

  .phy-recovery-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .phy-recovery-action {
    width: 100%;
  }
}
</style>

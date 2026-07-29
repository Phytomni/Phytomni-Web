<template>
  <section
    class="chat-cases"
    data-testid="chat-cases"
    :aria-label="t('chat.cases.ariaLabel')"
  >
    <h2 class="chat-cases-title">{{ t("chat.cases.title") }}</h2>
    <div class="chat-cases-grid">
      <RouterLink
        v-for="item in caseOptions"
        :key="item.toolName"
        :to="item.route"
        class="chat-case-link"
        data-testid="chat-case-link"
      >
        <span class="chat-case-icon" aria-hidden="true">
          <img
            v-if="item.media.kind === 'image'"
            :src="item.media.src"
            alt=""
            loading="eager"
            decoding="async"
          />
          <span v-else class="chat-case-monogram" aria-hidden="true">
            {{ item.media.text }}
          </span>
        </span>
        <span class="chat-case-title">{{ item.title }}</span>
      </RouterLink>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { useI18n } from "vue-i18n";
import {
  CANONICAL_AGENT_PAGE_TITLE_KEYS,
  deriveCaseRouteOptions,
} from "@/constants/agents";

const { t } = useI18n();

const caseOptions = computed(() =>
  deriveCaseRouteOptions().map((option) => {
    const titleKey = CANONICAL_AGENT_PAGE_TITLE_KEYS[option.toolName];
    return {
      ...option,
      title: titleKey ? t(titleKey) : option.name,
    };
  })
);
</script>

<style scoped>
.chat-cases {
  width: 100%;
  max-width: var(--phy-layout-transcript-max-width);
  margin: 0 auto;
  box-sizing: border-box;
  padding: var(--phy-space-16);
}

.chat-cases-title {
  margin: 0 0 var(--phy-space-12);
  color: var(--phy-color-text);
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.4;
}

.chat-cases-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--phy-space-12);
}

.chat-case-link {
  min-width: 0;
  min-height: var(--phy-control-height-primary);
  display: flex;
  align-items: center;
  gap: var(--phy-space-8);
  padding: var(--phy-space-12) var(--phy-space-16);
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-md);
  background: var(--phy-color-bg-elevated);
  color: var(--phy-color-text);
  text-decoration: none;
  box-shadow: none;
  transition:
    border-color var(--phy-motion-fast) var(--phy-motion-ease-out),
    background-color var(--phy-motion-fast) var(--phy-motion-ease-out);
}

.chat-case-link:hover {
  border-color: var(--phy-color-border-control);
  background: var(--phy-color-fill-subtle);
}

.chat-case-link:focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 2px;
}

.chat-case-icon {
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--phy-radius-sm);
  background: var(--phy-color-primary-soft);
  color: var(--phy-color-action-text);
}

.chat-case-icon img {
  width: 100%;
  height: 100%;
  display: block;
  border-radius: inherit;
  object-fit: cover;
}

.chat-case-monogram {
  display: inline-flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  color: var(--phy-color-action-text);
  font-size: 0.75rem;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.02em;
}

.chat-case-title {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.35;
}

@media (min-width: 1280px) {
  .chat-case-link {
    gap: var(--phy-space-4);
    min-height: var(--phy-control-height-default);
    padding: var(--phy-space-8);
  }

  .chat-case-icon {
    width: 24px;
    height: 24px;
    flex-basis: 24px;
  }

  .chat-case-title {
    overflow-wrap: normal;
    white-space: nowrap;
    font-size: 0.75rem;
    line-height: 1.25;
  }
}

@media (max-width: 1279px) {
  .chat-cases-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 899px) {
  .chat-cases-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 599px) {
  .chat-cases {
    padding: var(--phy-space-12);
  }

  .chat-cases-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--phy-space-8);
  }

  .chat-case-link {
    min-height: var(--phy-control-height-primary);
    padding: var(--phy-space-8) var(--phy-space-12);
  }

  .chat-case-icon {
    width: 28px;
    height: 28px;
    flex-basis: 28px;
  }
}
</style>

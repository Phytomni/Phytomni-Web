import { onMounted, ref } from "vue";

import { getAuthCapabilities } from "@/api/auth";

export function useRegistrationAvailability() {
  const registrationEnabled = ref(true);
  const loading = ref(false);

  const refresh = async () => {
    loading.value = true;
    try {
      const response = await getAuthCapabilities();
      registrationEnabled.value = response.data.registration_enabled;
    } catch {
      registrationEnabled.value = true;
    } finally {
      loading.value = false;
    }
  };

  onMounted(() => {
    refresh().catch(() => undefined);
  });

  return { registrationEnabled, loading, refresh };
}

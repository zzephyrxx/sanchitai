/**
 * 身份（工作面）store
 *
 * 一人多身份、身份间数据互不打通。v1 仅「党支部书记」可用。
 */
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { SetupStoreId } from '@/enum';
import { ACTIVE_IDENTITY_KEY, IDENTITIES } from '@/constants/sanchitai';

export const useIdentityStore = defineStore(SetupStoreId.Identity, () => {
  const activeId = ref<string>(localStorage.getItem(ACTIVE_IDENTITY_KEY) ?? 'secretary');

  const active = computed(() => IDENTITIES.find(i => i.id === activeId.value) ?? IDENTITIES[0]);

  function switchTo(id: string): boolean {
    const target = IDENTITIES.find(i => i.id === id);
    if (!target?.available) {
      window.$message?.info(`「${target?.name ?? id}」身份规划中，敬请期待`);
      return false;
    }
    activeId.value = id;
    localStorage.setItem(ACTIVE_IDENTITY_KEY, id);
    return true;
  }

  return {
    activeId,
    active,
    identities: IDENTITIES,
    switchTo
  };
});

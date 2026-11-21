<script setup lang="ts">
import { computed } from 'vue';
import { $t } from '@/locales';
import { useIdentityStore } from '@/store/modules/identity';

defineOptions({ name: 'IdentityBadge' });

const identityStore = useIdentityStore();

const options = computed(() =>
  identityStore.identities.map(i => ({
    // 占位身份保持可点击：switchTo() 会提示"规划中"，避免禁用项点击无反馈
    label: `${i.name}${i.available ? '' : $t('sct.header.planningSuffix')}`,
    key: i.id,
    disabled: false
  }))
);

function handleSelect(key: string) {
  identityStore.switchTo(key);
}
</script>

<template>
  <NDropdown trigger="click" :options="options" @select="handleSelect">
    <button
      type="button"
      class="flex flex-shrink-0 items-center gap-6px whitespace-nowrap rounded-4px px-10px py-4px text-13px transition hover:opacity-85"
      style="background: var(--sct-container); border: 1px solid var(--sct-border); color: var(--sct-ink)"
    >
      <span class="text-gray-400">{{ $t('sct.header.identityLabel') }}</span>
      <span class="inline-block size-6px rounded-full" style="background: #A81C24" />
      <span class="font-bold">{{ identityStore.active.name }}</span>
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
    </button>
  </NDropdown>
</template>

<style scoped></style>

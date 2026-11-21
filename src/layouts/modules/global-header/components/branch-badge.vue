<script setup lang="ts">
import { ref } from 'vue';
import { $t } from '@/locales';
import { useWorkDataStore } from '@/store/modules/work-data';

defineOptions({ name: 'BranchBadge' });

const workStore = useWorkDataStore();
const popShow = ref(false);
const draftName = ref('');

function openEdit() {
  draftName.value = workStore.branchName;
  popShow.value = true;
}

async function saveBranchName() {
  const clean = draftName.value.trim();
  if (!clean) {
    window.$message?.warning($t('sct.header.branchEmptyWarn'));
    return;
  }
  await workStore.setBranchName(clean);
  popShow.value = false;
  window.$message?.success($t('sct.header.branchUpdateSuccess'));
}
</script>

<template>
  <NPopover v-model:show="popShow" trigger="click" placement="bottom-end" :show-arrow="false">
    <template #trigger>
      <button
        type="button"
        class="group flex flex-shrink-0 items-center gap-6px whitespace-nowrap rounded-4px px-10px py-4px text-13px transition hover:opacity-85"
        style="background: var(--sct-container); border: 1px solid var(--sct-border); color: var(--sct-ink)"
        :title="$t('sct.header.branchEditTip')"
        @click="openEdit"
      >
        <span class="text-gray-400">{{ $t('sct.header.branchLabel') }}</span>
        <span class="inline-block size-6px flex-shrink-0 rounded-full" style="background: #a81c24" />
        <span class="whitespace-nowrap font-bold">{{ workStore.branchName }}</span>
        <SvgIcon icon="lucide:pen-line" class="flex-shrink-0 text-11px text-gray-400 transition group-hover:text-[#A81C24]" />
      </button>
    </template>
    <div class="w-300px p-4px">
      <div class="mb-8px flex items-center gap-6px text-12px font-bold" style="color: var(--sct-ink)">
        <SvgIcon icon="lucide:landmark" class="text-13px text-[#A81C24]" />
        <span>{{ $t('sct.header.branchModalTitle') }}</span>
      </div>
      <NInput
        v-model:value="draftName"
        size="small"
        :placeholder="$t('sct.header.branchPlaceholder')"
        maxlength="40"
        @keyup.enter="saveBranchName"
      />
      <div class="mt-10px flex items-center justify-between gap-8px">
        <span class="text-11px text-gray-400">{{ $t('sct.header.branchHint') }}</span>
        <div class="flex flex-shrink-0 gap-6px">
          <NButton size="tiny" @click="popShow = false">{{ $t('common.cancel') }}</NButton>
          <NButton size="tiny" type="primary" @click="saveBranchName">{{ $t('sct.common.save') }}</NButton>
        </div>
      </div>
    </div>
  </NPopover>
</template>

<style scoped></style>

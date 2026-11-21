<script setup lang="ts">
import { useRouter } from 'vue-router';
import { $t } from '@/locales';
import { useAppLockStore } from '@/store/modules/applock';

defineOptions({ name: 'LockButton' });

const appLock = useAppLockStore();
const router = useRouter();

function handleConfirmLock() {
  if (appLock.enabled) {
    appLock.lock();
    return;
  }
  appLock.lock();
  void router.push('/settings');
}
</script>

<template>
  <NPopconfirm
    placement="bottom-end"
    :positive-text="appLock.enabled ? $t('sct.header.lockConfirm') : $t('sct.header.lockGoSettings')"
    :negative-text="$t('common.cancel')"
    @positive-click="handleConfirmLock"
  >
    <template #trigger>
      <div>
        <ButtonIcon icon="lucide:lock" :tooltip-content="$t('sct.header.lockTooltip')" />
      </div>
    </template>
    <span>{{ appLock.enabled ? $t('sct.header.lockConfirmQuestion') : $t('sct.header.lockUnsetQuestion') }}</span>
  </NPopconfirm>
</template>

<style scoped></style>

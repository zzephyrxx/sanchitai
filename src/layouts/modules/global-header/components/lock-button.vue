<script setup lang="ts">
import { useAppLockStore } from '@/store/modules/applock';

defineOptions({ name: 'LockButton' });

const appLock = useAppLockStore();
</script>

<template>
  <button
    v-if="appLock.enabled"
    class="flex-y-center rounded-4px px-8px py-4px text-16px text-gray-500 transition hover:bg-gray-100"
    title="锁定工作台"
    @click="appLock.lock()"
  >
    <SvgIcon icon="lucide:lock" />
  </button>
</template>

<style scoped></style>

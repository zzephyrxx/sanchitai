<script setup lang="ts">
import { $t } from '@/locales';

defineOptions({
  name: 'GlobalFooter'
});
</script>

<template>
  <DarkModeContainer class="h-full flex-center">
    <span class="text-12px text-gray-400">{{ $t('sct.header.footerPlatform') }}</span>
  </DarkModeContainer>
</template>

<style scoped></style>

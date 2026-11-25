<script setup lang="ts">
import ThemeColor from './modules/theme-color.vue';
import ThemeDensity from './modules/theme-density.vue';
import ThemeFont from './modules/theme-font.vue';
import ThemeSchema from './modules/theme-schema.vue';

defineOptions({
  name: 'AppearanceSettings'
});
</script>

<template>
  <div class="flex-col-stretch gap-16px">
    <ThemeSchema />
    <ThemeColor />
    <ThemeDensity />
    <ThemeFont />
  </div>
</template>

<style scoped></style>

<script setup lang="ts">
defineOptions({
  name: 'GlobalLogo'
});

interface Props {
  /** Whether to show the title */
  showTitle?: boolean;
}

withDefaults(defineProps<Props>(), {
  showTitle: true
});
</script>

<template>
  <RouterLink to="/" class="w-full flex-center nowrap-hidden">
    <SystemLogo class="size-32px" />
    <h2 v-show="showTitle" class="sct-brand-title pl-8px text-20px transition duration-300 ease-in-out">三尺台</h2>
  </RouterLink>
</template>

<style scoped>
/* 固定使用与 Logo 印章内一致的宋体字型与 900 字重，保持中文「三尺台」不受全局字体、语言与主题色影响 */
.sct-brand-title {
  font-family: 'Songti SC', 'STSong', 'SimSun', serif !important;
  font-weight: 900 !important;
  letter-spacing: 0.08em;
  color: #16150f !important;
}

:global(.dark) .sct-brand-title {
  color: #f3f4f6 !important;
}
</style>

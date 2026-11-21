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
    <h2
      v-show="showTitle"
      class="sct-brand-title pl-8px text-17px text-primary transition duration-300 ease-in-out"
    >
      三尺台
    </h2>
  </RouterLink>
</template>

<style scoped>
/* 固定使用与 Logo 印章内一致的宋体字型与 900 字重，且保持中文「三尺台」不受全局字体与语言切换影响 */
.sct-brand-title {
  font-family: 'Songti SC', 'STSong', 'SimSun', serif !important;
  font-weight: 900 !important;
  letter-spacing: 0.08em;
}
</style>

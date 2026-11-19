<script setup lang="ts">
/**
 * 3D emoji 空态组件（Fluent Emoji 3D，编译期按需打包）
 */
defineOptions({ name: 'EmptyFancy' });

interface Props {
  emoji?: 'calendar' | 'folder' | 'notes' | 'inbox' | 'tea' | 'alarm' | 'index';
  text: string;
  sub?: string;
  compact?: boolean;
}

withDefaults(defineProps<Props>(), {
  emoji: 'calendar',
  sub: '',
  compact: false
});
</script>

<template>
  <div :class="compact ? 'py-10px' : 'py-24px'" class="flex flex-col items-center">
    <div :class="compact ? 'text-28px' : 'text-42px'" class="leading-none drop-shadow-sm">
      <IconFluentEmojiCalendar v-if="emoji === 'calendar'" />
      <IconFluentEmojiOpenFileFolder v-else-if="emoji === 'folder'" />
      <IconFluentEmojiSpiralNotepad v-else-if="emoji === 'notes'" />
      <IconFluentEmojiInboxTray v-else-if="emoji === 'inbox'" />
      <IconFluentEmojiTeacupWithoutHandle v-else-if="emoji === 'tea'" />
      <IconFluentEmojiAlarmClock v-else-if="emoji === 'alarm'" />
      <IconFluentEmojiCardIndexDividers v-else />
    </div>
    <div class="mt-8px text-13px text-gray-400">{{ text }}</div>
    <div v-if="sub" class="mt-2px text-12px text-gray-300">{{ sub }}</div>
  </div>
</template>

<style scoped></style>

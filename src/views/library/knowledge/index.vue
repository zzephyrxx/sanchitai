<script setup lang="ts">
import { computed, ref } from 'vue';
import { KNOWLEDGE_CATEGORIES, KNOWLEDGE_ITEMS } from '@/constants/knowledge-data';
import EmptyFancy from '@/components/custom/empty-fancy.vue';

defineOptions({ name: 'KnowledgePage' });

const images = import.meta.glob<string>('@/assets/knowledge/*.jpg', { eager: true, query: '?url', import: 'default' });

function imgUrl(file: string): string {
  const key = Object.keys(images).find(k => k.endsWith(`/${file}.jpg`));
  return key ? images[key] : '';
}

const activeCat = ref<string>('全部');
const keyword = ref('');

const filtered = computed(() =>
  KNOWLEDGE_ITEMS.filter(
    it =>
      (activeCat.value === '全部' || it.category === activeCat.value) &&
      (!keyword.value || it.title.toLowerCase().includes(keyword.value.toLowerCase()))
  )
);

const allTabLabel = computed(() => `全部（${KNOWLEDGE_ITEMS.length}）`);
const preview = ref<string | null>(null);
const previewTitle = ref('');
</script>

<template>
  <div class="min-h-500px">
    <NCard :bordered="false">
      <template #header>
        <div class="flex items-center gap-12px">
          <span class="text-16px font-bold">知识库</span>
          <span class="text-12px text-gray-400">支部工作图解 · 电子版 · 仅供个人学习</span>
        </div>
      </template>
      <template #header-extra>
        <NInput v-model:value="keyword" placeholder="搜索标题" size="small" class="w-200px" clearable />
      </template>

      <NTabs v-model:value="activeCat" type="segment" size="small" class="mb-16px">
        <NTab name="全部" :tab="allTabLabel" />
        <NTab v-for="c in KNOWLEDGE_CATEGORIES" :key="c" :name="c" :tab="c" />
      </NTabs>

      <EmptyFancy v-if="!filtered.length" emoji="folder" text="没有匹配的图解" />
      <div v-else class="grid grid-cols-1 gap-14px md:grid-cols-2 lg:grid-cols-3">
        <div v-for="it in filtered" :key="it.id" class="knowledge-card" @click="preview = imgUrl(it.file); previewTitle = it.title">
          <img :src="imgUrl(it.file)" :alt="it.title" class="knowledge-thumb" loading="lazy" />
          <div class="px-12px py-10px">
            <div class="text-13px font-bold leading-snug">{{ it.title }}</div>
            <div class="mt-4px flex items-center justify-between">
              <NTag size="tiny" :bordered="false">{{ it.category }}</NTag>
              <span class="text-11px text-gray-300">点击放大查看</span>
            </div>
          </div>
        </div>
      </div>
    </NCard>

    <NModal :show="!!preview" preset="card" :title="previewTitle" class="w-860px" @update:show="v => (preview = v ? preview : null)">
      <img v-if="preview" :src="preview" :alt="previewTitle" class="w-full rounded-8px" />
    </NModal>
  </div>
</template>

<style scoped>
.knowledge-card {
  background: var(--sct-container);
  border: 1px solid var(--sct-border);
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  transition: box-shadow 0.15s, transform 0.15s;
}
.knowledge-card:hover {
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.1);
  transform: translateY(-2px);
}
.knowledge-thumb {
  width: 100%;
  height: 190px;
  object-fit: cover;
  object-position: top;
  background: var(--sct-soft);
}
</style>

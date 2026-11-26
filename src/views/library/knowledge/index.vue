<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { NPopconfirm } from 'naive-ui';
import { KNOWLEDGE_CATEGORIES, KNOWLEDGE_ITEMS } from '@/constants/knowledge-data';
import type { KnowledgeItem } from '@/constants/knowledge-data';
import { useSctI18n } from '@/hooks/common/sct-i18n';
import EmptyFancy from '@/components/custom/empty-fancy.vue';
import { getMeta, setMeta } from '@/db/db';

defineOptions({ name: 'KnowledgePage' });

const { bi, tKnowledgeCat } = useSctI18n();

interface CustomKnowledgeItem extends KnowledgeItem {
  isCustom: true;
  customType: 'image' | 'markdown';
  imageDataUrl?: string;
  markdown?: string;
  createdAt: string;
}

type UnifiedKnowledgeItem = KnowledgeItem & {
  isCustom?: boolean;
  customType?: 'image' | 'markdown';
  imageDataUrl?: string;
  markdown?: string;
  createdAt?: string;
};

const CUSTOM_META_KEY = 'knowledge-custom-items';

const images = import.meta.glob<string>('@/assets/knowledge/*.jpg', { eager: true, query: '?url', import: 'default' });

function imgUrl(item: UnifiedKnowledgeItem): string {
  if (item.imageDataUrl) return item.imageDataUrl;
  if (!item.file) return '';
  const key = Object.keys(images).find(k => k.endsWith(`/${item.file}.jpg`));
  return key ? images[key] : '';
}

const customItems = ref<CustomKnowledgeItem[]>([]);

onMounted(async () => {
  try {
    const saved = await getMeta<CustomKnowledgeItem[]>(CUSTOM_META_KEY);
    if (Array.isArray(saved)) {
      customItems.value = saved;
    }
  } catch {
    /* ignore empty db */
  }
});

async function persistCustomItems() {
  await setMeta(CUSTOM_META_KEY, JSON.parse(JSON.stringify(customItems.value)));
}

const allItems = computed<UnifiedKnowledgeItem[]>(() => [...customItems.value, ...KNOWLEDGE_ITEMS]);

const activeCat = ref<string>('全部');
const keyword = ref('');

const filtered = computed(() =>
  allItems.value.filter(
    it =>
      (activeCat.value === '全部' || it.category === activeCat.value) &&
      (!keyword.value ||
        it.title.toLowerCase().includes(keyword.value.toLowerCase()) ||
        (it.markdown && it.markdown.toLowerCase().includes(keyword.value.toLowerCase())))
  )
);

const kbPagination = reactive({
  page: 1,
  pageSize: 12,
  pageSizes: [12, 24, 36]
});

watch([activeCat, keyword], () => {
  kbPagination.page = 1;
});

watch(
  () => filtered.value.length,
  total => {
    const maxPage = Math.max(1, Math.ceil(total / kbPagination.pageSize));
    if (kbPagination.page > maxPage) {
      kbPagination.page = maxPage;
    }
  }
);

const pagedFiltered = computed(() => {
  const start = (kbPagination.page - 1) * kbPagination.pageSize;
  return filtered.value.slice(start, start + kbPagination.pageSize);
});

const allTabLabel = computed(() => `${bi('全部', 'All')}（${allItems.value.length}）`);
const activeItem = ref<UnifiedKnowledgeItem | null>(null);
const previewShow = ref(false);
const zoomPct = ref(100);

function openPreview(item: UnifiedKnowledgeItem) {
  activeItem.value = item;
  zoomPct.value = 100;
  previewShow.value = true;
}

function adjustZoom(delta: number) {
  zoomPct.value = Math.min(200, Math.max(60, zoomPct.value + delta));
}

// ---------------- 上传图解 / Markdown ----------------
const uploadShow = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);
const categoryOptions = KNOWLEDGE_CATEGORIES.map(c => ({ label: c, value: c }));

const uploadForm = reactive<{
  title: string;
  category: (typeof KNOWLEDGE_CATEGORIES)[number];
  customType: 'image' | 'markdown';
  imageDataUrl: string;
  markdown: string;
  fileName: string;
}>({
  title: '',
  category: '支部建设',
  customType: 'image',
  imageDataUrl: '',
  markdown: '',
  fileName: ''
});

function openUploadModal() {
  uploadForm.title = '';
  const matchedCat = KNOWLEDGE_CATEGORIES.find(c => c === activeCat.value);
  uploadForm.category = matchedCat ?? '支部建设';
  uploadForm.customType = 'image';
  uploadForm.imageDataUrl = '';
  uploadForm.markdown = '';
  uploadForm.fileName = '';
  uploadShow.value = true;
}

function triggerPickFile() {
  fileInputRef.value?.click();
}

function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result || '')), { once: true });
    reader.addEventListener('error', () => reject(new Error('读取图片失败')), { once: true });
    reader.readAsDataURL(file);
  });
}

async function onFileSelected(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  uploadForm.fileName = file.name;
  const baseTitle = file.name.replace(/\.[^.]+$/, '');
  if (!uploadForm.title.trim()) {
    uploadForm.title = baseTitle;
  }

  const lower = file.name.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown') || file.type === 'text/markdown') {
    uploadForm.customType = 'markdown';
    const text = await file.text();
    uploadForm.markdown = text;
    // 若 Markdown 首行有 # 标题且用户未手动改名，则提取标题
    const firstHeading = text.match(/^#\s+(.+)$/m);
    if (firstHeading?.[1] && uploadForm.title === baseTitle) {
      uploadForm.title = firstHeading[1].trim();
    }
  } else if (file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(lower)) {
    uploadForm.customType = 'image';
    uploadForm.imageDataUrl = await readImageAsDataUrl(file);
  } else {
    window.$message?.warning('仅支持图片（JPG/PNG/WebP/SVG）或 Markdown（.md）文件');
  }
  input.value = '';
}

async function handleSaveUpload() {
  const title = uploadForm.title.trim();
  if (!title) {
    window.$message?.warning('请填写标题');
    return;
  }
  if (uploadForm.customType === 'image' && !uploadForm.imageDataUrl) {
    window.$message?.warning('请先选择要上传的图片文件');
    return;
  }
  if (uploadForm.customType === 'markdown' && !uploadForm.markdown.trim()) {
    window.$message?.warning('请上传 .md 文件或填写 Markdown 内容');
    return;
  }

  const item: CustomKnowledgeItem = {
    id: `kb-custom-${Date.now().toString(36)}`,
    title,
    category: uploadForm.category,
    isCustom: true,
    customType: uploadForm.customType,
    imageDataUrl: uploadForm.customType === 'image' ? uploadForm.imageDataUrl : undefined,
    markdown: uploadForm.customType === 'markdown' ? uploadForm.markdown : undefined,
    createdAt: new Date().toISOString().slice(0, 10)
  };

  customItems.value = [item, ...customItems.value];
  await persistCustomItems();
  uploadShow.value = false;
  window.$message?.success(`已上传至知识库（${uploadForm.customType === 'image' ? '图片图解' : 'Markdown 文档'}）`);
}

async function removeCustomItem(id: string) {
  customItems.value = customItems.value.filter(it => it.id !== id);
  await persistCustomItems();
  if (activeItem.value?.id === id) {
    previewShow.value = false;
    activeItem.value = null;
  }
  window.$message?.success('已从知识库移除');
}

// ---------------- 轻量安全 Markdown 解析（零外部重依赖） ----------------
interface MdBlock {
  type: 'h1' | 'h2' | 'h3' | 'ul' | 'ol' | 'quote' | 'code' | 'hr' | 'p';
  text?: string;
  items?: string[];
}

function parseMarkdownBlocks(md?: string): MdBlock[] {
  if (!md) return [];
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: MdBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();

    if (!line) {
      i += 1;
      continue;
    }

    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push({ type: 'code', text: codeLines.join('\n') });
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(line)) {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    if (line.startsWith('### ')) {
      blocks.push({ type: 'h3', text: line.slice(4).trim() });
      i += 1;
      continue;
    }
    if (line.startsWith('## ')) {
      blocks.push({ type: 'h2', text: line.slice(3).trim() });
      i += 1;
      continue;
    }
    if (line.startsWith('# ')) {
      blocks.push({ type: 'h1', text: line.slice(2).trim() });
      i += 1;
      continue;
    }

    if (line.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ type: 'quote', text: quoteLines.join(' ') });
      continue;
    }

    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*+]\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    blocks.push({ type: 'p', text: line });
    i += 1;
  }

  return blocks;
}

function mdSummaryLines(md?: string): string[] {
  if (!md) return [];
  return md
    .split('\n')
    .map(l => l.trim().replace(/^[#*>-]+\s*/, ''))
    .filter(Boolean)
    .slice(0, 3);
}
</script>

<template>
  <div class="min-h-500px">
    <NCard :bordered="false">
      <template #header>
        <div class="flex items-center gap-12px">
          <span class="text-16px font-bold">{{ bi('知识库', 'Knowledge Base') }}</span>
          <span class="text-12px text-gray-400">
            {{
              bi(
                '支部工作高清图解 · 12371.cn 党内法规一图读懂 · 支持上传自定义图片与 Markdown',
                'High-res Party work infographics · 12371.cn regulation guides · Supports custom image & Markdown uploads'
              )
            }}
          </span>
        </div>
      </template>
      <template #header-extra>
        <div class="flex items-center gap-10px">
          <NButton type="primary" size="small" @click="openUploadModal">
            <template #icon><SvgIcon icon="lucide:upload" /></template>
            {{ bi('上传图解 / Markdown', 'Upload Image / Markdown') }}
          </NButton>
          <NButton
            tag="a"
            href="https://www.12371.cn/special/tx/"
            target="_blank"
            size="small"
            secondary
            type="primary"
          >
            <template #icon><SvgIcon icon="lucide:external-link" /></template>
            {{ bi('12371.cn 法规图解专题', '12371.cn Infographics') }}
          </NButton>
          <NInput
            v-model:value="keyword"
            :placeholder="bi('搜索图解或 Markdown…', 'Search infographics or Markdown…')"
            size="small"
            class="w-220px"
            clearable
          >
            <template #prefix><SvgIcon icon="lucide:search" class="text-gray-400" /></template>
          </NInput>
        </div>
      </template>

      <div data-tour="knowledge-bar" class="mb-16px flex justify-center">
        <div class="lib-cat-tabs">
          <NTabs v-model:value="activeCat" type="segment" size="small">
            <NTab name="全部" :tab="allTabLabel" />
            <NTab v-for="c in KNOWLEDGE_CATEGORIES" :key="c" :name="c" :tab="tKnowledgeCat(c)" />
          </NTabs>
        </div>
      </div>

      <EmptyFancy
        v-if="!filtered.length"
        emoji="folder"
        :text="bi('没有匹配的图解或文档', 'No matching infographics or documents')"
      />
      <template v-else>
        <div class="grid grid-cols-1 gap-14px sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          <div v-for="it in pagedFiltered" :key="it.id" class="knowledge-card" @click="openPreview(it)">
            <!-- 1. 高清长图 / 自定义上传图片缩略图 -->
            <div v-if="it.file || it.imageDataUrl" class="knowledge-thumb-wrap">
              <img :src="imgUrl(it)" :alt="it.title" class="knowledge-thumb" loading="lazy" />
              <span class="knowledge-badge">
                {{ it.isCustom ? bi('自定义图片', 'Custom Image') : bi('高清长图', 'Infographic') }}
              </span>
            </div>

            <!-- 2. 自定义上传 Markdown 缩略预览 -->
            <div v-else-if="it.customType === 'markdown'" class="knowledge-poster-thumb knowledge-poster-thumb--md">
              <div class="flex items-center justify-between">
                <span class="knowledge-poster-thumb__tag">{{ bi('Markdown 文档', 'Markdown Doc') }}</span>
                <span v-if="it.createdAt" class="text-10px text-gray-400">{{ it.createdAt }}</span>
              </div>
              <div class="knowledge-poster-thumb__title">{{ it.title }}</div>
              <div class="knowledge-poster-thumb__list">
                <div v-for="(line, idx) in mdSummaryLines(it.markdown)" :key="idx" class="truncate">• {{ line }}</div>
              </div>
            </div>

            <!-- 3. 结构化权威图解缩略预览 -->
            <div v-else class="knowledge-poster-thumb">
              <div class="knowledge-poster-thumb__tag">{{ bi('12371.cn 权威图解', '12371.cn Guide') }}</div>
              <div class="knowledge-poster-thumb__title">{{ it.title }}</div>
              <div class="knowledge-poster-thumb__list">
                <div v-for="(sec, idx) in (it.sections ?? []).slice(0, 2)" :key="idx" class="truncate">
                  • {{ sec.heading }}
                </div>
              </div>
            </div>

            <div class="px-12px py-10px">
              <div class="line-clamp-1 text-13px font-bold leading-snug" :title="it.title">{{ it.title }}</div>
              <div class="mt-6px flex items-center justify-between">
                <NTag size="tiny" :bordered="false">{{ tKnowledgeCat(it.category) }}</NTag>
                <div class="flex items-center gap-6px" @click.stop>
                  <NPopconfirm v-if="it.isCustom" @positive-click="removeCustomItem(it.id)">
                    <template #trigger>
                      <NButton size="tiny" quaternary type="error" :title="bi('删除自定义条目', 'Delete custom item')">
                        <template #icon><SvgIcon icon="lucide:trash-2" class="text-12px" /></template>
                      </NButton>
                    </template>
                    {{ bi(`确认删除自定义知识库条目「${it.title}」吗？`, `Delete custom item "${it.title}"?`) }}
                  </NPopconfirm>
                  <span class="inline-flex items-center gap-3px text-11px text-gray-400" @click="openPreview(it)">
                    <SvgIcon icon="lucide:maximize-2" class="text-11px" />
                    {{ bi('查看', 'View') }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="mt-16px flex justify-end">
          <NPagination
            v-model:page="kbPagination.page"
            v-model:page-size="kbPagination.pageSize"
            :item-count="filtered.length"
            :page-sizes="kbPagination.pageSizes"
            show-size-picker
            size="small"
          >
            <template #prefix="{ itemCount }">
              <span class="text-12px text-gray-400">{{ bi(`共 ${itemCount} 条`, `Total ${itemCount}`) }}</span>
            </template>
          </NPagination>
        </div>
      </template>
    </NCard>

    <!-- 预览弹窗（图片 / Markdown / 12371 结构化图解） -->
    <NModal v-model:show="previewShow" preset="card" :title="activeItem?.title ?? ''" class="w-920px max-w-95vw">
      <template #header-extra>
        <div class="mr-8px flex items-center gap-6px">
          <template v-if="activeItem?.file || activeItem?.imageDataUrl">
            <NButton size="tiny" secondary @click="adjustZoom(-20)">
              <template #icon><SvgIcon icon="lucide:zoom-out" /></template>
              缩小
            </NButton>
            <NButton size="tiny" secondary @click="zoomPct = 100">{{ zoomPct }}%</NButton>
            <NButton size="tiny" secondary @click="adjustZoom(20)">
              <template #icon><SvgIcon icon="lucide:zoom-in" /></template>
              放大
            </NButton>
          </template>
          <NPopconfirm v-if="activeItem?.isCustom" @positive-click="removeCustomItem(activeItem.id)">
            <template #trigger>
              <NButton size="tiny" secondary type="error">
                <template #icon><SvgIcon icon="lucide:trash-2" /></template>
                删除
              </NButton>
            </template>
            确认删除「{{ activeItem?.title }}」吗？
          </NPopconfirm>
        </div>
      </template>

      <!-- 1. 图片预览 -->
      <div
        v-if="activeItem && (activeItem.file || activeItem.imageDataUrl)"
        class="max-h-76vh overflow-auto rounded-8px bg-[var(--sct-soft)] p-12px text-center"
      >
        <img
          :src="imgUrl(activeItem)"
          :alt="activeItem.title"
          class="mx-auto block rounded-6px shadow-sm transition-all duration-150"
          :style="{ width: `${zoomPct}%`, maxWidth: 'none' }"
        />
      </div>

      <!-- 2. Markdown 预览 -->
      <div v-else-if="activeItem?.customType === 'markdown'" class="max-h-76vh overflow-y-auto pr-4px">
        <div class="mb-12px flex items-center justify-between rounded-8px bg-[var(--sct-soft)] px-14px py-8px">
          <div class="flex items-center gap-8px">
            <NTag size="small" type="info" :bordered="false">{{ activeItem.category }}</NTag>
            <span class="text-12px text-gray-500">Markdown 学习笔记 / 知识文档</span>
          </div>
          <span v-if="activeItem.createdAt" class="text-12px text-gray-400">上传于 {{ activeItem.createdAt }}</span>
        </div>

        <div class="rounded-12px border border-[var(--sct-border)] bg-[var(--sct-container)] p-18px">
          <template v-for="(blk, bIdx) in parseMarkdownBlocks(activeItem.markdown)" :key="bIdx">
            <h1 v-if="blk.type === 'h1'" class="mb-10px mt-6px text-18px font-black text-[var(--sct-ink)]">
              {{ blk.text }}
            </h1>
            <h2
              v-else-if="blk.type === 'h2'"
              class="mb-8px mt-12px border-b border-[var(--sct-border)] pb-4px text-15px font-bold text-[#A81C24]"
            >
              {{ blk.text }}
            </h2>
            <h3 v-else-if="blk.type === 'h3'" class="mb-6px mt-10px text-14px font-bold text-[var(--sct-ink)]">
              {{ blk.text }}
            </h3>
            <blockquote
              v-else-if="blk.type === 'quote'"
              class="my-8px rounded-8px bg-[var(--sct-soft)] px-12px py-8px text-13px text-gray-500"
            >
              {{ blk.text }}
            </blockquote>
            <pre
              v-else-if="blk.type === 'code'"
              class="my-8px overflow-x-auto rounded-8px bg-[var(--sct-soft)] p-12px font-mono text-12px leading-relaxed text-[var(--sct-ink)]"
            ><code>{{ blk.text }}</code></pre>
            <ul
              v-else-if="blk.type === 'ul'"
              class="my-6px list-disc pl-20px text-13px leading-relaxed text-[var(--sct-ink)]"
            >
              <li v-for="(li, lIdx) in blk.items" :key="lIdx" class="mb-3px">{{ li }}</li>
            </ul>
            <ol
              v-else-if="blk.type === 'ol'"
              class="my-6px list-decimal pl-20px text-13px leading-relaxed text-[var(--sct-ink)]"
            >
              <li v-for="(li, lIdx) in blk.items" :key="lIdx" class="mb-3px">{{ li }}</li>
            </ol>
            <hr v-else-if="blk.type === 'hr'" class="my-12px border-[var(--sct-border)]" />
            <p v-else class="my-6px text-13px leading-relaxed text-[var(--sct-ink)]">{{ blk.text }}</p>
          </template>
        </div>
      </div>

      <!-- 3. 12371 结构化图解预览 -->
      <div v-else-if="activeItem?.sections" class="max-h-76vh overflow-y-auto pr-4px">
        <div class="mb-12px flex items-center justify-between rounded-8px bg-[var(--sct-soft)] px-14px py-10px">
          <div class="flex items-center gap-8px">
            <NTag size="small" type="error" :bordered="false">{{ activeItem.category }}</NTag>
            <span class="text-12px text-gray-500">来源：{{ activeItem.source ?? '共产党员网 12371.cn' }}</span>
          </div>
          <NButton
            v-if="activeItem.sourceUrl"
            tag="a"
            :href="activeItem.sourceUrl"
            target="_blank"
            size="tiny"
            type="primary"
            secondary
          >
            <template #icon><SvgIcon icon="lucide:external-link" /></template>
            前往 12371.cn 专题原文
          </NButton>
        </div>
        <div class="flex flex-col gap-12px">
          <div
            v-for="(sec, i) in activeItem.sections"
            :key="i"
            class="rounded-10px border border-[var(--sct-border)] bg-[var(--sct-container)] p-14px"
          >
            <div class="mb-8px flex items-center gap-8px text-14px font-bold text-[#A81C24]">
              <span class="inline-block size-6px rounded-full bg-[#A81C24]" />
              {{ sec.heading }}
            </div>
            <ul class="ma-0 pl-18px text-13px leading-relaxed text-[var(--sct-ink)]">
              <li v-for="(line, j) in sec.items" :key="j" class="mb-4px">{{ line }}</li>
            </ul>
          </div>
        </div>
      </div>
    </NModal>

    <!-- 上传图解 / Markdown 弹窗 -->
    <NModal v-model:show="uploadShow" preset="card" title="上传知识库图解 / Markdown 文档" class="w-580px">
      <NForm label-placement="left" label-width="112" size="small">
        <NFormItem>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:file-up" class="sct-field-icon" />
              <span>文件导入</span>
            </span>
          </template>
          <div class="w-full flex items-center gap-8px">
            <NButton size="small" secondary type="primary" @click="triggerPickFile">
              <template #icon><SvgIcon icon="lucide:file-up" /></template>
              选择图片或 .md 文件
            </NButton>
            <span class="truncate text-12px text-gray-400">
              {{ uploadForm.fileName || '支持 .jpg / .png / .webp / .svg / .md' }}
            </span>
            <input
              ref="fileInputRef"
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.gif,.svg,.md,.markdown,image/*,text/markdown"
              class="hidden"
              @change="onFileSelected"
            />
          </div>
        </NFormItem>

        <NFormItem required>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:file-type" class="sct-field-icon" />
              <span>内容格式</span>
            </span>
          </template>
          <NRadioGroup v-model:value="uploadForm.customType" size="small">
            <NRadioButton value="image">图片图解</NRadioButton>
            <NRadioButton value="markdown">Markdown 文档 (.md)</NRadioButton>
          </NRadioGroup>
        </NFormItem>

        <NFormItem required>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:type" class="sct-field-icon" />
              <span>标题</span>
            </span>
          </template>
          <NInput v-model:value="uploadForm.title" placeholder="请输入知识库条目标题" />
        </NFormItem>

        <NFormItem required>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:folder" class="sct-field-icon" />
              <span>所属分类</span>
            </span>
          </template>
          <NSelect v-model:value="uploadForm.category" :options="categoryOptions" />
        </NFormItem>

        <NFormItem v-if="uploadForm.customType === 'image'">
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:image" class="sct-field-icon" />
              <span>图片预览</span>
            </span>
          </template>
          <div
            v-if="uploadForm.imageDataUrl"
            class="max-h-200px w-full overflow-hidden rounded-8px border border-[var(--sct-border)] bg-[var(--sct-soft)] p-6px text-center"
          >
            <img :src="uploadForm.imageDataUrl" alt="预览" class="mx-auto max-h-180px object-contain" />
          </div>
          <div
            v-else
            class="w-full cursor-pointer rounded-8px border border-dashed border-[var(--sct-border)] bg-[var(--sct-soft)] py-20px text-center text-12px text-gray-400 transition hover:border-[#A81C24]"
            @click="triggerPickFile"
          >
            点击此处选择本地高清图解（JPG / PNG / WebP / SVG）
          </div>
        </NFormItem>

        <NFormItem v-else required>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:file-code" class="sct-field-icon" />
              <span>Markdown</span>
            </span>
          </template>
          <NInput
            v-model:value="uploadForm.markdown"
            type="textarea"
            :rows="8"
            placeholder="可直接选择本地 .md 文件导入，或在此粘贴 Markdown 内容（支持 # 标题、列表、引用、代码块）"
          />
        </NFormItem>
      </NForm>
      <template #footer>
        <div class="flex justify-end gap-8px">
          <NButton size="small" @click="uploadShow = false">取消</NButton>
          <NButton size="small" type="primary" @click="handleSaveUpload">
            <template #icon><SvgIcon icon="lucide:check" /></template>
            保存到知识库
          </NButton>
        </div>
      </template>
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
  transition:
    box-shadow 0.15s,
    transform 0.15s,
    border-color 0.15s;
}
.knowledge-card:hover {
  border-color: #a81c24;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.08);
  transform: translateY(-2px);
}
.knowledge-thumb-wrap {
  position: relative;
  width: 100%;
  height: 176px;
  overflow: hidden;
  background: var(--sct-soft);
}
.knowledge-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top;
}
.knowledge-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 2px 7px;
  font-size: 10px;
  font-weight: 600;
  color: #fff;
  background: rgba(43, 41, 38, 0.72);
  backdrop-filter: blur(4px);
  border-radius: 999px;
}
.knowledge-poster-thumb {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 176px;
  padding: 14px;
  background: linear-gradient(135deg, rgba(168, 28, 36, 0.08) 0%, var(--sct-soft) 100%);
  border-bottom: 1px solid var(--sct-border);
}
.knowledge-poster-thumb--md {
  background: linear-gradient(135deg, rgba(32, 128, 240, 0.08) 0%, var(--sct-soft) 100%);
}
.knowledge-poster-thumb--md .knowledge-poster-thumb__tag {
  color: #2080f0;
  background: var(--sct-info-soft);
}
.knowledge-poster-thumb__tag {
  align-self: flex-start;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 700;
  color: #a81c24;
  background: var(--sct-err-soft);
  border-radius: 999px;
}
.knowledge-poster-thumb__title {
  font-size: 14px;
  font-weight: 800;
  line-height: 1.4;
  color: var(--sct-ink);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.lib-cat-tabs {
  width: fit-content;
  min-width: 68%;
  max-width: 100%;
}
.lib-cat-tabs :deep(.n-tabs-tab) {
  padding-left: 12px;
  padding-right: 12px;
}
@media (max-width: 960px) {
  .lib-cat-tabs {
    width: 100%;
  }
}
.knowledge-poster-thumb__list {
  font-size: 11px;
  color: var(--sct-muted);
  line-height: 1.6;
}
</style>

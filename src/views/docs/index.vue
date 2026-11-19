<script setup lang="ts">
import { computed, h, reactive, ref } from 'vue';
import dayjs from 'dayjs';
import { saveAs } from 'file-saver';
import { useWorkDataStore } from '@/store/modules/work-data';

defineOptions({ name: 'DocsPage' });

const workStore = useWorkDataStore();

const BRANCH_NAME = '智感硕博党支部（虚构演示）';

// ---------------- 模板区 ----------------
const CATEGORY_COLORS: Record<string, string> = {
  会议: '#A81C24',
  活动: '#d97706',
  总结: '#3f9d63',
  发展: '#7c5cd6',
  谈心谈话: '#2080f0'
};

// ---------------- 从模板新建 ----------------
const editShow = ref(false);
const editingTemplate = ref<Sct.DocTemplate | null>(null);
const fills = reactive<Record<string, string>>({});
const previewBody = ref('');

const AUTO_FILL: Record<string, () => string> = {
  支部名称: () => BRANCH_NAME,
  落款日期: () => dayjs().format('YYYY年M月D日'),
  会议时间: () => `${dayjs().format('YYYY年M月D日')} 14:00`,
  谈话时间: () => `${dayjs().format('YYYY年M月D日')} 14:00`,
  活动时间: () => `${dayjs().format('YYYY年M月D日')} 14:00`,
  学期区间: () => {
    const y = dayjs().year();
    return dayjs().month() >= 7 ? `${y}-${y + 1}学年秋季学期` : `${y}-${y - 1}学年春季学期`;
  }
};

function openCreate(tpl: Sct.DocTemplate) {
  editingTemplate.value = tpl;
  Object.keys(fills).forEach(k => delete fills[k]);
  tpl.placeholders.forEach(p => {
    fills[p] = AUTO_FILL[p]?.() ?? '';
  });
  renderPreview();
  editShow.value = true;
}

function renderPreview() {
  const tpl = editingTemplate.value;
  if (!tpl) return;
  let body = tpl.body;
  Object.entries(fills).forEach(([k, v]) => {
    body = body.replaceAll(`{{${k}}}`, v || `〔${k}〕`);
  });
  previewBody.value = body;
}

async function saveDoc() {
  const tpl = editingTemplate.value;
  if (!tpl) return;
  const title = `${tpl.name}（${dayjs().format('M月D日')}）`;
  await workStore.addDoc({
    template_id: tpl.id,
    title,
    body: previewBody.value,
    created_at: dayjs().toISOString()
  });
  window.$message?.success('已存入材料库归档区');
}

function exportMarkdown() {
  const tpl = editingTemplate.value;
  if (!tpl) return;
  saveAs(new Blob([previewBody.value], { type: 'text/markdown;charset=utf-8' }), `${tpl.name}.md`);
}

/** 导出 Word 可打开的 .doc（HTML 内容 + msword MIME） */
function exportWord() {
  const tpl = editingTemplate.value;
  if (!tpl) return;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${tpl.name}</title>
<style>body{font-family:SimSun,serif;font-size:14pt;line-height:1.8;margin:40px;}h2{text-align:center;}</style>
</head><body><pre style="font-family:SimSun,serif;font-size:14pt;white-space:pre-wrap;">${previewBody.value.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre></body></html>`;
  saveAs(new Blob([html], { type: 'application/msword;charset=utf-8' }), `${tpl.name}.doc`);
  window.$message?.success('已导出 .doc（Word 可直接打开）');
}

// ---------------- 归档区 ----------------
const docsList = computed(() => [...workStore.docsList].sort((a, b) => b.created_at.localeCompare(a.created_at)));
const viewShow = ref(false);
const viewingDoc = ref<Sct.Doc | null>(null);

function openDoc(doc: Sct.Doc) {
  viewingDoc.value = doc;
  viewShow.value = true;
}

async function deleteDoc(id: string) {
  await workStore.deleteDoc(id);
  viewShow.value = false;
  window.$message?.success('已删除');
}
</script>

<template>
  <div class="min-h-500px">
    <!-- 模板区 -->
    <NCard :bordered="false" title="模板库" class="mb-16px">
      <div class="grid grid-cols-1 gap-10px md:grid-cols-2 lg:grid-cols-3">
        <div v-for="tpl in workStore.docTemplates" :key="tpl.id" class="tpl-card" @click="openCreate(tpl)">
          <div class="flex items-center justify-between">
            <span class="text-14px font-bold">{{ tpl.name }}</span>
            <NTag size="tiny" :bordered="false" :color="{ color: '#F7E3E4', textColor: CATEGORY_COLORS[tpl.category] ?? '#A81C24' }">
              {{ tpl.category }}
            </NTag>
          </div>
          <div class="mt-6px text-12px text-gray-400">{{ tpl.placeholders.length }} 个占位符 · 从模板新建后可导出 Word / Markdown</div>
        </div>
      </div>
    </NCard>

    <!-- 归档区 -->
    <NCard :bordered="false" title="归档区">
      <EmptyFancy v-if="!docsList.length" emoji="folder" text="暂无归档文档" sub="从上方模板新建一份吧" />
      <NDataTable
        v-else
        :data="docsList"
        :bordered="false"
        size="small"
        :row-key="(r: any) => r.id"
        :columns="[
          { title: '标题', key: 'title' },
          { title: '创建时间', key: 'created_at', width: 170, render: (r: any) => dayjs(r.created_at).format('YYYY-MM-DD HH:mm') },
          {
            title: '',
            key: 'op',
            width: 130,
            render: (r: any) =>
              h('div', { class: 'flex gap-10px' }, [
                h('a', { style: { color: '#A81C24', cursor: 'pointer' }, onClick: () => openDoc(r) }, '查看'),
                h('a', { style: { color: '#d43030', cursor: 'pointer' }, onClick: () => deleteDoc(r.id) }, '删除')
              ])
          }
        ]"
      />
    </NCard>

    <!-- 从模板新建 -->
    <NModal v-model:show="editShow" preset="card" :title="`从模板新建：${editingTemplate?.name ?? ''}`" class="w-720px">
      <NForm label-placement="left" label-width="96" size="small">
        <NFormItem v-for="p in editingTemplate?.placeholders ?? []" :key="p" :label="p">
          <NInput v-model:value="fills[p]" @update:value="renderPreview" />
        </NFormItem>
      </NForm>
      <div class="mb-6px text-13px font-bold">预览</div>
      <div class="doc-preview">{{ previewBody }}</div>
      <template #footer>
        <div class="flex justify-between">
          <NButton size="small" @click="editShow = false">取消</NButton>
          <div class="flex gap-8px">
            <NButton size="small" @click="exportMarkdown">导出 Markdown</NButton>
            <NButton size="small" @click="exportWord">导出 Word(.doc)</NButton>
            <NButton type="primary" @click="saveDoc">存入归档</NButton>
          </div>
        </div>
      </template>
    </NModal>

    <!-- 查看归档 -->
    <NDrawer v-model:show="viewShow" :width="520">
      <NDrawerContent v-if="viewingDoc" :title="viewingDoc.title" closable>
        <div class="doc-preview">{{ viewingDoc.body }}</div>
      </NDrawerContent>
    </NDrawer>
  </div>
</template>

<style scoped>
.tpl-card {
  padding: 12px 14px;
  background: #fff;
  border: 1px solid #e7e4de;
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.tpl-card:hover {
  border-color: #a81c24;
  box-shadow: 0 2px 10px rgba(168, 28, 36, 0.08);
}
.doc-preview {
  max-height: 260px;
  overflow-y: auto;
  padding: 12px;
  font-size: 13px;
  line-height: 1.9;
  color: #2b2b2b;
  background: #faf8f4;
  border-radius: 8px;
  white-space: pre-wrap;
}
</style>

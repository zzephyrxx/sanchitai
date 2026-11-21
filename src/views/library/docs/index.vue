<script setup lang="ts">
import { computed, h, reactive, ref } from 'vue';
import dayjs from 'dayjs';
import { NButton, NPopconfirm } from 'naive-ui';
import type { DataTableColumns } from 'naive-ui';
import { saveAs } from 'file-saver';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useSvgIcon } from '@/hooks/common/icon';
import { useSctI18n } from '@/hooks/common/sct-i18n';

defineOptions({ name: 'DocsPage' });

const workStore = useWorkDataStore();
const { SvgIconVNode } = useSvgIcon();
const { bi } = useSctI18n();

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
  const safeTitle = tpl.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeBody = previewBody.value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${safeTitle}</title>
<style>body{font-family:SimSun,serif;font-size:14pt;line-height:1.8;margin:40px;}h2{text-align:center;}</style>
</head><body><pre style="font-family:SimSun,serif;font-size:14pt;white-space:pre-wrap;">${safeBody}</pre></body></html>`;
  saveAs(new Blob([html], { type: 'application/msword;charset=utf-8' }), `${tpl.name}.doc`);
  window.$message?.success('已导出 .doc（Word 可直接打开）');
}

// ---------------- 归档区（支持搜索、分页与图标表头） ----------------
const searchKeyword = ref('');
const pagination = reactive({
  page: 1,
  pageSize: 10,
  showSizePicker: true,
  pageSizes: [10, 15, 25, 50],
  onChange: (page: number) => {
    pagination.page = page;
  },
  onUpdatePageSize: (pageSize: number) => {
    pagination.pageSize = pageSize;
    pagination.page = 1;
  }
});

const docsList = computed<Sct.Doc[]>(() => {
  const kw = searchKeyword.value.trim().toLowerCase();
  return [...workStore.docsList]
    .filter(d => !kw || d.title.toLowerCase().includes(kw) || d.body.toLowerCase().includes(kw))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
});
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

function placeholderIcon(p: string): string {
  if (p.includes('日期') || p.includes('时间') || p.includes('年月')) return 'lucide:calendar';
  if (p.includes('地点')) return 'lucide:map-pin';
  if (p.includes('人数') || p.includes('应到') || p.includes('实到')) return 'lucide:users';
  if (p.includes('人') || p.includes('姓名') || p.includes('书记') || p.includes('对象')) return 'lucide:user';
  return 'lucide:file-text';
}

function colHeader(icon: string, text: string) {
  return h('span', { class: 'inline-flex items-center gap-4px whitespace-nowrap' }, [
    SvgIconVNode({ icon, fontSize: 13 })?.(),
    h('span', text)
  ]);
}

const docsColumns = computed<DataTableColumns<Sct.Doc>>(() => [
  {
    title: () => colHeader('lucide:file-text', bi('标题', 'Title')),
    key: 'title',
    resizable: true,
    sorter: (a, b) => a.title.localeCompare(b.title)
  },
  {
    title: () => colHeader('lucide:clock', bi('创建时间', 'Created At')),
    key: 'created_at',
    width: 180,
    resizable: true,
    sorter: (a, b) => a.created_at.localeCompare(b.created_at),
    render: r => dayjs(r.created_at).format('YYYY-MM-DD HH:mm')
  },
  {
    title: () => colHeader('lucide:sliders-horizontal', bi('操作', 'Actions')),
    key: 'op',
    width: 160,
    render: r =>
      h('div', { class: 'flex items-center gap-6px' }, [
        h(
          NButton,
          {
            size: 'tiny',
            secondary: true,
            type: 'primary',
            onClick: () => openDoc(r)
          },
          {
            icon: SvgIconVNode({ icon: 'lucide:eye', fontSize: 13 }),
            default: () => bi('查看', 'View')
          }
        ),
        h(
          NPopconfirm,
          { onPositiveClick: () => deleteDoc(r.id) },
          {
            trigger: () =>
              h(
                NButton,
                {
                  size: 'tiny',
                  secondary: true,
                  type: 'error'
                },
                {
                  icon: SvgIconVNode({ icon: 'lucide:trash-2', fontSize: 13 }),
                  default: () => bi('删除', 'Delete')
                }
              ),
            default: () => bi(`确认删除归档材料「${r.title}」？`, `Delete archived document "${r.title}"?`)
          }
        )
      ])
  }
]);
</script>

<template>
  <div class="min-h-500px">
    <!-- 模板区 -->
    <NCard :bordered="false" :title="bi('模板库', 'Document Templates')" class="mb-16px">
      <div class="grid grid-cols-1 gap-10px md:grid-cols-2 lg:grid-cols-3">
        <div v-for="tpl in workStore.docTemplates" :key="tpl.id" class="tpl-card" @click="openCreate(tpl)">
          <div class="flex items-center justify-between">
            <span class="text-14px font-bold">{{ tpl.name }}</span>
            <NTag
              size="tiny"
              :bordered="false"
              :color="{ color: 'var(--sct-err-soft)', textColor: CATEGORY_COLORS[tpl.category] ?? '#A81C24' }"
            >
              {{ tpl.category }}
            </NTag>
          </div>
          <div class="mt-6px text-12px text-gray-400">
            {{
              bi(
                `${tpl.placeholders.length} 个占位符 · 从模板新建后可导出 Word / Markdown`,
                `${tpl.placeholders.length} placeholders · Create & export Word / Markdown`
              )
            }}
          </div>
        </div>
      </div>
    </NCard>

    <!-- 归档区 -->
    <NCard :bordered="false" :title="bi('归档区', 'Archived Documents')">
      <template #header-extra>
        <NInput
          v-if="workStore.docsList.length"
          v-model:value="searchKeyword"
          size="small"
          clearable
          class="w-240px"
          :placeholder="bi('搜索归档材料标题或正文…', 'Search archived title or content…')"
          @update:value="pagination.page = 1"
        >
          <template #prefix><SvgIcon icon="lucide:search" class="text-gray-400" /></template>
        </NInput>
      </template>
      <EmptyFancy
        v-if="!docsList.length"
        emoji="folder"
        :text="bi('暂无归档文档', 'No archived documents yet')"
        :sub="bi('从上方模板新建一份吧', 'Create one from the templates above')"
      />
      <NDataTable
        v-else
        :data="docsList"
        :pagination="pagination"
        :bordered="false"
        size="small"
        :row-key="(r: Sct.Doc) => r.id"
        :columns="docsColumns"
      />
    </NCard>

    <!-- 从模板新建（label-width="132" 带匹配图标防止较长占位符换行） -->
    <NModal v-model:show="editShow" preset="card" :title="`从模板新建：${editingTemplate?.name ?? ''}`" class="w-740px">
      <NForm label-placement="left" label-width="132" size="small">
        <NFormItem v-for="p in editingTemplate?.placeholders ?? []" :key="p">
          <template #label>
            <span class="sct-field-label">
              <SvgIcon :icon="placeholderIcon(p)" class="sct-field-icon" />
              <span>{{ p }}</span>
            </span>
          </template>
          <NInput v-model:value="fills[p]" @update:value="renderPreview" />
        </NFormItem>
      </NForm>
      <div class="mb-6px text-13px font-bold">预览</div>
      <div class="doc-preview">{{ previewBody }}</div>
      <template #footer>
        <div class="flex justify-between">
          <NButton size="small" @click="editShow = false">取消</NButton>
          <div class="flex gap-8px">
            <NButton size="small" secondary @click="exportMarkdown">
              <template #icon><SvgIcon icon="lucide:file-code" /></template>
              导出 Markdown
            </NButton>
            <NButton size="small" secondary @click="exportWord">
              <template #icon><SvgIcon icon="lucide:file-text" /></template>
              导出 Word(.doc)
            </NButton>
            <NButton type="primary" size="small" @click="saveDoc">
              <template #icon><SvgIcon icon="lucide:archive" /></template>
              存入归档
            </NButton>
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
  background: var(--sct-container);
  border: 1px solid var(--sct-border);
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
  color: var(--sct-ink);
  background: var(--sct-soft);
  border-radius: 8px;
  white-space: pre-wrap;
}
</style>

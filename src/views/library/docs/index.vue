<script setup lang="ts">
import { computed, h, nextTick, onMounted, reactive, ref } from 'vue';
import { NButton, NDropdown, NPopconfirm, NTag } from 'naive-ui';
import type { DataTableColumns, DropdownOption } from 'naive-ui';
import dayjs from 'dayjs';
import { saveFileWithPicker } from '@/utils/save-file';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useSvgIcon } from '@/hooks/common/icon';
import { useSctI18n } from '@/hooks/common/sct-i18n';
import EmptyFancy from '@/components/custom/empty-fancy.vue';
import { ensureDefaultDocTemplates } from '@/db/db';

defineOptions({ name: 'DocsPage' });

const workStore = useWorkDataStore();
const { SvgIconVNode } = useSvgIcon();
const { bi } = useSctI18n();

onMounted(() => {
  void ensureDefaultDocTemplates();
});

const BASE_CATEGORIES = ['会议', '活动', '总结', '发展', '谈心谈话', '其他'] as const;

const CATEGORY_COLORS: Record<string, string> = {
  会议: '#A81C24',
  活动: '#d97706',
  总结: '#3f9d63',
  发展: '#7c5cd6',
  谈心谈话: '#2080f0',
  其他: '#64748b'
};

function categoryColor(cat?: string): string {
  if (!cat) return '#64748b';
  return CATEGORY_COLORS[cat] ?? '#2080f0';
}

const currentBranchName = computed(() => workStore.branchName || '党支部');
const secretaryName = computed(() => workStore.members.find(m => m.role === '书记')?.name ?? '');

const AUTO_FILL: Record<string, () => string> = {
  支部名称: () => currentBranchName.value,
  落款日期: () => dayjs().format('YYYY年M月D日'),
  会议时间: () => `${dayjs().format('YYYY年M月D日')} 14:00`,
  谈话时间: () => `${dayjs().format('YYYY年M月D日')} 14:00`,
  活动时间: () => `${dayjs().format('YYYY年M月D日')} 14:00`,
  书记姓名: () => secretaryName.value,
  主持人: () => secretaryName.value,
  学期区间: () => {
    const y = dayjs().year();
    return dayjs().month() >= 7 ? `${y}-${y + 1}学年秋季学期` : `${y}-${y - 1}学年春季学期`;
  }
};

const QUICK_VARS = [
  '支部名称',
  '落款日期',
  '会议时间',
  '会议地点',
  '主持人',
  '记录人',
  '书记姓名',
  '学期区间',
  '参会人员'
];

const allCategoryList = computed(() => {
  const set = new Set<string>(BASE_CATEGORIES);
  workStore.docTemplates.forEach(t => {
    if (t.category?.trim()) set.add(t.category.trim());
  });
  workStore.docsList.forEach(d => {
    if (d.category?.trim()) set.add(d.category.trim());
  });
  return [...set];
});

const categorySelectOptions = computed(() => allCategoryList.value.map(c => ({ label: c, value: c })));

const templateNameMap = computed(() => {
  const map = new Map<string, string>();
  workStore.docTemplates.forEach(t => map.set(t.id, t.name));
  return map;
});

function extractPlaceholders(body: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const reg = /\{\{\s*([^{}]+?)\s*\}\}/g;
  for (const m of body.matchAll(reg)) {
    const key = m[1].trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      found.push(key);
    }
  }
  return found;
}

// ---------------- 轻量安全公文/Markdown 预览解析 ----------------
interface PreviewBlock {
  type: 'h1' | 'h2' | 'h3' | 'ul' | 'ol' | 'quote' | 'hr' | 'p';
  text?: string;
  items?: string[];
}

function parseDocPreview(text: string): PreviewBlock[] {
  const lines = (text || '').replace(/\r\n/g, '\n').split('\n');
  const blocks: PreviewBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i += 1;
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
      const q: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        q.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ type: 'quote', text: q.join('\n') });
      continue;
    }
    if (/^[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, ''));
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
    blocks.push({ type: 'p', text: lines[i] });
    i += 1;
  }
  return blocks;
}

// ---------------- 通用导出与复制 ----------------
async function exportDocMarkdown(title: string, body: string) {
  const safeName = title.trim() || '材料文档';
  const res = await saveFileWithPicker(new Blob([body], { type: 'text/markdown;charset=utf-8' }), {
    suggestedName: `${safeName}.md`,
    types: [{ description: 'Markdown 文档', mime: 'text/markdown', extensions: ['.md'] }]
  });
  if (res.status === 'saved') {
    window.$message?.success('已导出 Markdown 文档');
  }
}

async function exportDocWord(title: string, body: string) {
  const safeName = title.trim() || '材料文档';
  const safeTitle = safeName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeBody = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${safeTitle}</title>
<style>body{font-family:SimSun,serif;font-size:14pt;line-height:1.8;margin:40px;}h2{text-align:center;}</style>
</head><body><pre style="font-family:SimSun,serif;font-size:14pt;white-space:pre-wrap;">${safeBody}</pre></body></html>`;
  const res = await saveFileWithPicker(new Blob([html], { type: 'application/msword;charset=utf-8' }), {
    suggestedName: `${safeName}.doc`,
    types: [{ description: 'Word 文档', mime: 'application/msword', extensions: ['.doc'] }]
  });
  if (res.status === 'saved') {
    window.$message?.success('已导出 .doc（Word 可直接打开）');
  }
}

async function copyDocText(body: string) {
  try {
    await navigator.clipboard.writeText(body);
    window.$message?.success('已复制全文到剪贴板');
  } catch {
    window.$message?.error('复制失败，请手动选中文本复制');
  }
}

// ---------------- 1. 模板区筛选与增删改 ----------------
const activeTplCategory = ref('全部');
const tplCategories = computed(() => {
  const cats = new Set<string>();
  workStore.docTemplates.forEach(t => {
    if (t.category?.trim()) cats.add(t.category.trim());
  });
  return ['全部', ...cats];
});

const filteredTemplates = computed(() => {
  if (activeTplCategory.value === '全部') return workStore.docTemplates;
  return workStore.docTemplates.filter(t => t.category === activeTplCategory.value);
});

const tplModalShow = ref(false);
const tplModalMode = ref<'create' | 'edit'>('create');
const tplFileInputRef = ref<HTMLInputElement | null>(null);
const tplTextareaWrapRef = ref<HTMLElement | null>(null);
const customVarInput = ref('');

const tplForm = reactive({
  id: '' as string,
  name: '',
  category: '会议',
  body: ''
});

const tplDetectedPlaceholders = computed(() => extractPlaceholders(tplForm.body));

const tplLivePreviewText = computed(() => {
  let out = tplForm.body;
  tplDetectedPlaceholders.value.forEach(k => {
    const sample = AUTO_FILL[k]?.() || `〔${k}〕`;
    out = out.replace(new RegExp(`\\{\\{\\s*${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`, 'g'), sample);
  });
  return out;
});

function openCreateTemplateModal() {
  tplModalMode.value = 'create';
  tplForm.id = '';
  tplForm.name = '';
  tplForm.category = activeTplCategory.value === '全部' ? '会议' : activeTplCategory.value;
  tplForm.body = `# {{支部名称}} 工作材料\n\n- **时间**：{{会议时间}}\n- **地点**：{{会议地点}}\n- **主持人**：{{主持人}}\n\n## 一、主要内容\n\n{{主要内容}}\n\n---\n\n{{支部名称}}\n{{落款日期}}`;
  customVarInput.value = '';
  tplModalShow.value = true;
}

function openEditTemplateModal(tpl: Sct.DocTemplate) {
  tplModalMode.value = 'edit';
  tplForm.id = tpl.id;
  tplForm.name = tpl.name;
  tplForm.category = tpl.category || '其他';
  tplForm.body = tpl.body;
  customVarInput.value = '';
  tplModalShow.value = true;
}

function insertAtTextarea(
  container: HTMLElement | null,
  currentText: string,
  snippet: string,
  setter: (v: string) => void
) {
  const ta = container?.querySelector('textarea') as HTMLTextAreaElement | null;
  if (!ta) {
    setter(`${currentText}${snippet}`);
    return;
  }
  const start = ta.selectionStart ?? currentText.length;
  const end = ta.selectionEnd ?? currentText.length;
  const next = `${currentText.slice(0, start)}${snippet}${currentText.slice(end)}`;
  setter(next);
  void nextTick(() => {
    ta.focus();
    const pos = start + snippet.length;
    ta.setSelectionRange(pos, pos);
  });
}

function insertTemplateVar(varName: string) {
  const clean = varName.trim();
  if (!clean) return;
  insertAtTextarea(tplTextareaWrapRef.value, tplForm.body, `{{${clean}}}`, v => {
    tplForm.body = v;
  });
}

function insertCustomTemplateVar() {
  const clean = customVarInput.value.trim().replace(/[{}]/g, '');
  if (!clean) return;
  insertTemplateVar(clean);
  customVarInput.value = '';
}

function triggerImportTemplateFile(openModalAfter = true) {
  if (openModalAfter && !tplModalShow.value) {
    tplModalMode.value = 'create';
    tplForm.id = '';
    tplForm.name = '';
    tplForm.category = '其他';
    tplForm.body = '';
  }
  tplFileInputRef.value?.click();
}

async function handleImportTemplateFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const lower = file.name.toLowerCase();
  if (!lower.endsWith('.md') && !lower.endsWith('.markdown') && !lower.endsWith('.txt')) {
    window.$message?.warning('仅支持导入 .md / .markdown / .txt 文本文件作为模板');
    return;
  }
  const text = await file.text();
  const baseName = file.name.replace(/\.[^.]+$/, '');
  if (!tplForm.name.trim()) {
    tplForm.name = baseName;
  }
  tplForm.body = text;
  if (!tplModalShow.value) {
    tplModalMode.value = 'create';
    tplModalShow.value = true;
  }
  window.$message?.success(`已载入「${file.name}」，自动识别 ${extractPlaceholders(text).length} 个占位符`);
}

async function handleSaveTemplate() {
  const name = tplForm.name.trim();
  const category = tplForm.category.trim() || '其他';
  if (!name) {
    window.$message?.warning('请输入模板名称');
    return;
  }
  if (!tplForm.body.trim()) {
    window.$message?.warning('请输入模板正文内容');
    return;
  }
  const placeholders = extractPlaceholders(tplForm.body);
  await workStore.saveDocTemplate({
    id: tplModalMode.value === 'edit' && tplForm.id ? tplForm.id : undefined,
    name,
    category,
    placeholders,
    body: tplForm.body
  });
  tplModalShow.value = false;
  window.$message?.success(tplModalMode.value === 'edit' ? `模板「${name}」已更新` : `已新增自定义模板「${name}」`);
}

async function handleDeleteTemplate(tpl: Sct.DocTemplate) {
  await workStore.deleteDocTemplate(tpl.id);
  window.$message?.success(`已删除模板「${tpl.name}」`);
}

async function handleRestoreDefaultTemplates() {
  await workStore.restoreDefaultDocTemplates();
  activeTplCategory.value = '全部';
  window.$message?.success('已恢复全部内置默认模板（保留你自建的模板）');
}

// ---------------- 2. 从模板新建（填写占位符 + 实时预览） ----------------
const createFromTplShow = ref(false);
const usingTemplate = ref<Sct.DocTemplate | null>(null);
const createDocTitle = ref('');
const fills = reactive<Record<string, string>>({});
const previewBody = ref('');

function openCreateFromTemplate(tpl: Sct.DocTemplate) {
  usingTemplate.value = tpl;
  createDocTitle.value = `${tpl.name}（${dayjs().format('M月D日')}）`;
  Object.keys(fills).forEach(k => delete fills[k]);
  const vars = tpl.placeholders.length ? tpl.placeholders : extractPlaceholders(tpl.body);
  vars.forEach(p => {
    fills[p] = AUTO_FILL[p]?.() ?? '';
  });
  renderFromTemplatePreview();
  createFromTplShow.value = true;
}

function renderFromTemplatePreview() {
  const tpl = usingTemplate.value;
  if (!tpl) return;
  let body = tpl.body;
  Object.entries(fills).forEach(([k, v]) => {
    body = body.replace(
      new RegExp(`\\{\\{\\s*${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`, 'g'),
      v || `〔${k}〕`
    );
  });
  previewBody.value = body;
}

async function saveFromTemplateToArchive() {
  const tpl = usingTemplate.value;
  if (!tpl) return;
  const title = createDocTitle.value.trim() || `${tpl.name}（${dayjs().format('M月D日')}）`;
  await workStore.addDoc({
    template_id: tpl.id,
    title,
    category: tpl.category || '其他',
    body: previewBody.value,
    created_at: dayjs().toISOString()
  });
  createFromTplShow.value = false;
  window.$message?.success(`已将「${title}」存入材料库归档区`);
}

function placeholderIcon(p: string): string {
  if (p.includes('日期') || p.includes('时间') || p.includes('年月')) return 'lucide:calendar';
  if (p.includes('地点')) return 'lucide:map-pin';
  if (p.includes('人数') || p.includes('应到') || p.includes('实到')) return 'lucide:users';
  if (p.includes('人') || p.includes('姓名') || p.includes('书记') || p.includes('对象')) return 'lucide:user';
  return 'lucide:file-text';
}

// ---------------- 3. 归档区（筛选、编辑、新建空白、复用、导出） ----------------
const searchKeyword = ref('');
const archiveCategoryFilter = ref<string>('全部');
const archiveTemplateFilter = ref<string>('全部');

const archiveTemplateFilterOptions = computed(() => [
  { label: bi('全部来源', 'All Sources'), value: '全部' },
  { label: bi('空白新建', 'Blank Doc'), value: '__blank__' },
  ...workStore.docTemplates.map(t => ({ label: t.name, value: t.id }))
]);

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
    .filter(d => {
      const cat = d.category || '其他';
      if (archiveCategoryFilter.value !== '全部' && cat !== archiveCategoryFilter.value) return false;
      if (archiveTemplateFilter.value === '__blank__' && d.template_id) return false;
      if (
        archiveTemplateFilter.value !== '全部' &&
        archiveTemplateFilter.value !== '__blank__' &&
        d.template_id !== archiveTemplateFilter.value
      ) {
        return false;
      }
      if (!kw) return true;
      return d.title.toLowerCase().includes(kw) || d.body.toLowerCase().includes(kw) || cat.toLowerCase().includes(kw);
    })
    .sort((a, b) => (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at));
});

// 归档双栏实时编辑器（支持新建空白 / 编辑已有 / 复用复制）
const docEditorShow = ref(false);
const docEditorMode = ref<'create' | 'edit' | 'duplicate'>('create');
const docTextareaWrapRef = ref<HTMLElement | null>(null);
const docForm = reactive({
  id: '' as string,
  template_id: '' as string,
  title: '',
  category: '会议',
  body: ''
});

const docCharCount = computed(() => Array.from(docForm.body.replace(/\s+/g, '')).length);

function openBlankDocEditor() {
  docEditorMode.value = 'create';
  docForm.id = '';
  docForm.template_id = '';
  docForm.title = `党支部工作材料（${dayjs().format('M月D日')}）`;
  docForm.category = '会议';
  docForm.body = `# ${currentBranchName.value} 工作材料\n\n- **日期**：${dayjs().format('YYYY年M月D日')}\n\n## 一、基本情况\n\n在此输入正文内容…\n\n---\n\n${currentBranchName.value}\n${dayjs().format('YYYY年M月D日')}`;
  docEditorShow.value = true;
}

function openEditDocEditor(doc: Sct.Doc) {
  docEditorMode.value = 'edit';
  docForm.id = doc.id;
  docForm.template_id = doc.template_id ?? '';
  docForm.title = doc.title;
  docForm.category = doc.category || '其他';
  docForm.body = doc.body;
  docEditorShow.value = true;
}

function openDuplicateDocEditor(doc: Sct.Doc) {
  docEditorMode.value = 'duplicate';
  docForm.id = '';
  docForm.template_id = doc.template_id ?? '';
  const stripped = doc.title.replace(/（[^（）]*）$/, '');
  docForm.title = `${stripped || doc.title}（${dayjs().format('M月D日')}复用）`;
  docForm.category = doc.category || '其他';
  docForm.body = doc.body;
  docEditorShow.value = true;
}

function insertDocSnippet(snippet: string) {
  insertAtTextarea(docTextareaWrapRef.value, docForm.body, snippet, v => {
    docForm.body = v;
  });
}

async function handleSaveDocEditor() {
  const title = docForm.title.trim();
  if (!title) {
    window.$message?.warning('请输入文档标题');
    return;
  }
  if (!docForm.body.trim()) {
    window.$message?.warning('请输入文档正文');
    return;
  }
  const category = docForm.category.trim() || '其他';
  if (docEditorMode.value === 'edit' && docForm.id) {
    await workStore.updateDoc(docForm.id, {
      title,
      category,
      body: docForm.body
    });
    window.$message?.success(`已更新归档材料「${title}」`);
  } else {
    await workStore.addDoc({
      template_id: docForm.template_id || undefined,
      title,
      category,
      body: docForm.body,
      created_at: dayjs().toISOString()
    });
    window.$message?.success(`已存入归档区「${title}」`);
  }
  docEditorShow.value = false;
}

async function deleteDoc(id: string) {
  await workStore.deleteDoc(id);
  window.$message?.success('已删除归档材料');
}

function colHeader(icon: string, text: string) {
  return h('span', { class: 'inline-flex items-center gap-4px whitespace-nowrap' }, [
    SvgIconVNode({ icon, fontSize: 13 })?.(),
    h('span', text)
  ]);
}

const exportMenuOptions: DropdownOption[] = [
  { label: '导出 Word (.doc)', key: 'word', icon: SvgIconVNode({ icon: 'lucide:file-text', fontSize: 13 }) },
  { label: '导出 Markdown (.md)', key: 'md', icon: SvgIconVNode({ icon: 'lucide:file-code', fontSize: 13 }) },
  { label: '复制全文', key: 'copy', icon: SvgIconVNode({ icon: 'lucide:copy', fontSize: 13 }) }
];

function handleDocExportAction(key: string, doc: Sct.Doc) {
  if (key === 'word') void exportDocWord(doc.title, doc.body);
  else if (key === 'md') void exportDocMarkdown(doc.title, doc.body);
  else if (key === 'copy') void copyDocText(doc.body);
}

const docsColumns = computed<DataTableColumns<Sct.Doc>>(() => [
  {
    title: () => colHeader('lucide:file-text', bi('标题', 'Title')),
    key: 'title',
    resizable: true,
    sorter: (a, b) => a.title.localeCompare(b.title),
    render: r => {
      const tplName = r.template_id ? templateNameMap.value.get(r.template_id) : '';
      return h('div', { class: 'flex items-center gap-6px min-w-0' }, [
        h('span', { class: 'truncate font-medium text-[var(--sct-ink)]' }, r.title),
        tplName
          ? h(NTag, { size: 'tiny', bordered: false, class: 'shrink-0 opacity-80' }, { default: () => tplName })
          : null
      ]);
    }
  },
  {
    title: () => colHeader('lucide:tag', bi('分类', 'Category')),
    key: 'category',
    width: 100,
    render: r => {
      const cat = r.category || '其他';
      return h(
        NTag,
        {
          size: 'tiny',
          bordered: false,
          color: { color: 'var(--sct-soft)', textColor: categoryColor(cat) }
        },
        { default: () => cat }
      );
    }
  },
  {
    title: () => colHeader('lucide:clock', bi('最后更新', 'Updated At')),
    key: 'updated_at',
    width: 158,
    resizable: true,
    sorter: (a, b) => (a.updated_at ?? a.created_at).localeCompare(b.updated_at ?? b.created_at),
    render: r => dayjs(r.updated_at ?? r.created_at).format('YYYY-MM-DD HH:mm')
  },
  {
    title: () => colHeader('lucide:sliders-horizontal', bi('操作', 'Actions')),
    key: 'op',
    width: 248,
    render: r =>
      h('div', { class: 'flex items-center gap-5px' }, [
        h(
          NButton,
          {
            size: 'tiny',
            secondary: true,
            type: 'primary',
            onClick: () => openEditDocEditor(r)
          },
          {
            icon: SvgIconVNode({ icon: 'lucide:pencil', fontSize: 12 }),
            default: () => bi('编辑', 'Edit')
          }
        ),
        h(
          NButton,
          {
            size: 'tiny',
            secondary: true,
            title: '基于此文档复制一份新草稿',
            onClick: () => openDuplicateDocEditor(r)
          },
          {
            icon: SvgIconVNode({ icon: 'lucide:copy-plus', fontSize: 12 }),
            default: () => bi('复用', 'Reuse')
          }
        ),
        h(
          NDropdown,
          {
            trigger: 'click',
            options: exportMenuOptions,
            onSelect: (key: string) => handleDocExportAction(key, r)
          },
          {
            default: () =>
              h(
                NButton,
                { size: 'tiny', secondary: true },
                {
                  icon: SvgIconVNode({ icon: 'lucide:download', fontSize: 12 }),
                  default: () => bi('导出', 'Export')
                }
              )
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
                  quaternary: true,
                  type: 'error',
                  title: bi('删除', 'Delete')
                },
                {
                  icon: SvgIconVNode({ icon: 'lucide:trash-2', fontSize: 13 })
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
    <!-- 隐藏文件选择器（导入 .md / .txt 创建模板） -->
    <input
      ref="tplFileInputRef"
      type="file"
      accept=".md,.markdown,.txt"
      class="hidden"
      @change="handleImportTemplateFile"
    />

    <!-- 1. 模板库区 -->
    <NCard :bordered="false" class="mb-16px">
      <template #header>
        <div class="flex items-center gap-8px">
          <SvgIcon icon="lucide:layout-template" class="text-16px text-[#A81C24]" />
          <span class="text-15px font-bold">{{ bi('模板库', 'Document Templates') }}</span>
          <NTag size="tiny" type="warning" :bordered="false" round>Preview</NTag>
          <NTag size="tiny" :bordered="false" round>
            {{ bi(`${workStore.docTemplates.length} 套`, `${workStore.docTemplates.length}`) }}
          </NTag>
        </div>
      </template>
      <template #header-extra>
        <div class="flex flex-wrap items-center gap-6px">
          <NButton size="small" type="primary" @click="openCreateTemplateModal">
            <template #icon><SvgIcon icon="lucide:file-plus-2" /></template>
            {{ bi('新增模板', 'New Template') }}
          </NButton>
          <NButton size="small" secondary @click="triggerImportTemplateFile(true)">
            <template #icon><SvgIcon icon="lucide:upload" /></template>
            {{ bi('导入 .md/.txt', 'Import .md/.txt') }}
          </NButton>
          <NPopconfirm @positive-click="handleRestoreDefaultTemplates">
            <template #trigger>
              <NButton size="small" secondary>
                <template #icon><SvgIcon icon="lucide:rotate-ccw" /></template>
                {{ bi('恢复内置模板', 'Restore Defaults') }}
              </NButton>
            </template>
            确认重新写入内置默认模板吗？（不会删除你自建的模板，已修改的内置同名模板将恢复原样）
          </NPopconfirm>
        </div>
      </template>

      <!-- 模板分类快筛 -->
      <div class="mb-12px flex flex-wrap items-center gap-6px">
        <button
          v-for="cat in tplCategories"
          :key="cat"
          type="button"
          class="tpl-cat-pill"
          :class="{ 'is-active': activeTplCategory === cat }"
          @click="activeTplCategory = cat"
        >
          {{ cat }}
        </button>
      </div>

      <EmptyFancy
        v-if="!filteredTemplates.length"
        emoji="folder"
        :text="bi('该分类下暂无模板', 'No templates in this category')"
        :sub="bi('点击右上角「新增模板」或「导入 .md/.txt」创建', 'Create or import a template above')"
        compact
      />
      <div v-else class="grid grid-cols-1 gap-10px md:grid-cols-2 lg:grid-cols-3">
        <div v-for="tpl in filteredTemplates" :key="tpl.id" class="tpl-card group" @click="openCreateFromTemplate(tpl)">
          <div class="flex items-start justify-between gap-8px">
            <div class="min-w-0 flex-1">
              <div class="truncate text-14px font-bold text-[var(--sct-ink)]">{{ tpl.name }}</div>
            </div>
            <div class="flex shrink-0 items-center gap-4px" @click.stop>
              <NTag
                size="tiny"
                :bordered="false"
                :color="{ color: 'var(--sct-container)', textColor: categoryColor(tpl.category) }"
              >
                {{ tpl.category || '其他' }}
              </NTag>
              <NButton size="tiny" quaternary title="编辑此模板" @click="openEditTemplateModal(tpl)">
                <template #icon><SvgIcon icon="lucide:pencil" class="text-12px" /></template>
              </NButton>
              <NPopconfirm @positive-click="handleDeleteTemplate(tpl)">
                <template #trigger>
                  <NButton size="tiny" quaternary type="error" title="删除此模板">
                    <template #icon><SvgIcon icon="lucide:trash-2" class="text-12px" /></template>
                  </NButton>
                </template>
                确认删除模板「{{ tpl.name }}」吗？（不会影响已归档的文档，内置模板可随时恢复）
              </NPopconfirm>
            </div>
          </div>
          <div class="mt-6px flex items-center justify-between gap-8px text-12px text-gray-400">
            <span class="truncate">
              {{
                bi(
                  `${tpl.placeholders.length} 个占位符 · 点击直接套用起草`,
                  `${tpl.placeholders.length} placeholders · Click to draft`
                )
              }}
            </span>
            <span class="inline-flex shrink-0 items-center gap-2px text-11px text-[var(--sct-accent)] opacity-80">
              <SvgIcon icon="lucide:arrow-right" class="text-11px" />
              {{ bi('套用', 'Use') }}
            </span>
          </div>
        </div>
      </div>
    </NCard>

    <!-- 2. 归档区 -->
    <NCard :bordered="false">
      <template #header>
        <div class="flex items-center gap-8px">
          <SvgIcon icon="lucide:archive" class="text-16px text-[var(--sct-ink)] opacity-80" />
          <span class="text-15px font-bold">{{ bi('归档区', 'Archived Documents') }}</span>
          <NTag size="tiny" :bordered="false" round>
            {{ bi(`${workStore.docsList.length} 份`, `${workStore.docsList.length}`) }}
          </NTag>
        </div>
      </template>
      <template #header-extra>
        <NButton size="small" type="primary" secondary @click="openBlankDocEditor">
          <template #icon><SvgIcon icon="lucide:file-plus" /></template>
          {{ bi('新建空白材料', 'New Blank Doc') }}
        </NButton>
      </template>

      <div class="mb-12px flex flex-wrap items-center gap-8px">
        <NSelect
          v-model:value="archiveCategoryFilter"
          size="small"
          class="w-120px"
          :options="[{ label: bi('全部分类', 'All Categories'), value: '全部' }, ...categorySelectOptions]"
          @update:value="pagination.page = 1"
        />
        <NSelect
          v-model:value="archiveTemplateFilter"
          size="small"
          class="w-168px"
          :options="archiveTemplateFilterOptions"
          @update:value="pagination.page = 1"
        />
        <NInput
          v-model:value="searchKeyword"
          size="small"
          clearable
          class="w-240px"
          :placeholder="bi('搜索归档标题或正文…', 'Search title or body…')"
          @update:value="pagination.page = 1"
        >
          <template #prefix><SvgIcon icon="lucide:search" class="text-gray-400" /></template>
        </NInput>
      </div>

      <EmptyFancy
        v-if="!docsList.length"
        emoji="folder"
        :text="bi('暂无匹配的归档文档', 'No matching archived documents')"
        :sub="
          bi('可从上方模板起草，或点击右上角「新建空白材料」直接编写', 'Draft from a template or create a blank doc')
        "
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

    <!-- Modal A：新增 / 编辑模板（双栏实时编辑器） -->
    <NModal
      v-model:show="tplModalShow"
      preset="card"
      :title="tplModalMode === 'edit' ? `编辑模板：${tplForm.name || ''}` : '新增自定义材料模板'"
      class="max-w-95vw w-980px"
      :mask-closable="false"
    >
      <div class="flex flex-col gap-12px">
        <!-- 顶部基本信息 -->
        <div class="grid grid-cols-1 gap-10px md:grid-cols-12">
          <div class="md:col-span-7">
            <div class="mb-4px text-12px font-semibold text-gray-500">模板名称 *</div>
            <NInput v-model:value="tplForm.name" size="small" placeholder="例如：党员大会会议纪要、主题党日策划方案…" />
          </div>
          <div class="md:col-span-5">
            <div class="mb-4px text-12px font-semibold text-gray-500">分类（支持输入自定义新分类）</div>
            <NSelect
              v-model:value="tplForm.category"
              size="small"
              filterable
              tag
              :options="categorySelectOptions"
              placeholder="选择或输入分类名称"
            />
          </div>
        </div>

        <!-- 快捷插入变量工具栏 -->
        <div class="rounded-10px border border-[var(--sct-border)] bg-[var(--sct-soft)] px-10px py-8px">
          <div class="flex flex-wrap items-center gap-6px">
            <span class="inline-flex items-center gap-4px text-11px font-semibold text-gray-500">
              <SvgIcon icon="lucide:braces" class="text-13px text-[#A81C24]" />
              插入占位符：
            </span>
            <NButton v-for="v in QUICK_VARS" :key="v" size="tiny" secondary @click="insertTemplateVar(v)">
              + {{ v }}
            </NButton>
            <div class="ml-auto flex items-center gap-4px">
              <NInput
                v-model:value="customVarInput"
                size="tiny"
                class="w-110px"
                placeholder="自定义变量名"
                @keyup.enter="insertCustomTemplateVar"
              />
              <NButton size="tiny" secondary type="primary" @click="insertCustomTemplateVar">插入</NButton>
              <NButton size="tiny" secondary @click="triggerImportTemplateFile(false)">
                <template #icon><SvgIcon icon="lucide:upload" class="text-12px" /></template>
                导入 .md/.txt
              </NButton>
            </div>
          </div>
          <div class="mt-6px flex flex-wrap items-center gap-5px text-11px text-gray-500">
            <span>自动识别占位符（{{ tplDetectedPlaceholders.length }}）：</span>
            <span v-if="!tplDetectedPlaceholders.length" class="text-gray-400">
              在正文中使用
              <code class="font-mono">&#123;&#123;变量名&#125;&#125;</code>
              即可自动识别
            </span>
            <NTag v-for="p in tplDetectedPlaceholders" :key="p" size="tiny" :bordered="false" type="info">
              &#123;&#123;{{ p }}&#125;&#125;
            </NTag>
          </div>
        </div>

        <!-- 双栏实时编辑 + 预览 -->
        <div class="grid grid-cols-1 gap-12px md:grid-cols-2">
          <div ref="tplTextareaWrapRef" class="flex flex-col">
            <div class="mb-5px flex items-center justify-between text-12px font-semibold text-gray-500">
              <span class="inline-flex items-center gap-4px">
                <SvgIcon icon="lucide:code-2" class="text-13px" />
                模板正文（支持 Markdown 与 &#123;&#123;占位符&#125;&#125;）
              </span>
              <span class="text-11px font-normal text-gray-400">{{ tplForm.body.length }} 字符</span>
            </div>
            <NInput
              v-model:value="tplForm.body"
              type="textarea"
              :rows="15"
              class="font-mono text-12px"
              placeholder="在此编写模板正文，使用 {{支部名称}}、{{落款日期}} 等占位符…"
            />
          </div>
          <div class="flex flex-col">
            <div class="mb-5px flex items-center justify-between text-12px font-semibold text-gray-500">
              <span class="inline-flex items-center gap-4px">
                <SvgIcon icon="lucide:eye" class="text-13px" />
                实时排版预览（已自动带入当前支部名称与今日日期）
              </span>
            </div>
            <div class="doc-live-paper flex-1">
              <template v-for="(blk, idx) in parseDocPreview(tplLivePreviewText)" :key="idx">
                <h1 v-if="blk.type === 'h1'" class="doc-paper-h1">{{ blk.text }}</h1>
                <h2 v-else-if="blk.type === 'h2'" class="doc-paper-h2">{{ blk.text }}</h2>
                <h3 v-else-if="blk.type === 'h3'" class="doc-paper-h3">{{ blk.text }}</h3>
                <blockquote v-else-if="blk.type === 'quote'" class="doc-paper-quote">{{ blk.text }}</blockquote>
                <ul v-else-if="blk.type === 'ul'" class="doc-paper-ul">
                  <li v-for="(li, liIdx) in blk.items" :key="liIdx">{{ li }}</li>
                </ul>
                <ol v-else-if="blk.type === 'ol'" class="doc-paper-ol">
                  <li v-for="(li, liIdx) in blk.items" :key="liIdx">{{ li }}</li>
                </ol>
                <hr v-else-if="blk.type === 'hr'" class="doc-paper-hr" />
                <p v-else class="doc-paper-p">{{ blk.text }}</p>
              </template>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="flex justify-end gap-8px">
          <NButton size="small" @click="tplModalShow = false">取消</NButton>
          <NButton size="small" type="primary" @click="handleSaveTemplate">
            <template #icon><SvgIcon icon="lucide:save" /></template>
            {{ tplModalMode === 'edit' ? '保存模板修改' : '创建模板' }}
          </NButton>
        </div>
      </template>
    </NModal>

    <!-- Modal B：从模板新建（左侧填写占位符，右侧实时预览） -->
    <NModal
      v-model:show="createFromTplShow"
      preset="card"
      :title="`从模板起草：${usingTemplate?.name ?? ''}`"
      class="max-w-95vw w-920px"
    >
      <div class="grid grid-cols-1 gap-14px md:grid-cols-12">
        <div class="md:col-span-5">
          <NForm label-placement="left" label-width="116" size="small">
            <NFormItem>
              <template #label>
                <span class="sct-field-label">
                  <SvgIcon icon="lucide:heading" class="sct-field-icon" />
                  <span>归档标题</span>
                </span>
              </template>
              <NInput v-model:value="createDocTitle" placeholder="归档保存标题" />
            </NFormItem>
            <NFormItem v-for="p in Object.keys(fills)" :key="p">
              <template #label>
                <span class="sct-field-label">
                  <SvgIcon :icon="placeholderIcon(p)" class="sct-field-icon" />
                  <span>{{ p }}</span>
                </span>
              </template>
              <NInput v-model:value="fills[p]" @update:value="renderFromTemplatePreview" />
            </NFormItem>
          </NForm>
        </div>
        <div class="md:col-span-7 flex flex-col">
          <div class="mb-6px flex items-center justify-between text-12px font-semibold text-gray-500">
            <span class="inline-flex items-center gap-4px">
              <SvgIcon icon="lucide:eye" class="text-13px" />
              实时生成预览
            </span>
            <NButton size="tiny" quaternary @click="copyDocText(previewBody)">
              <template #icon><SvgIcon icon="lucide:copy" class="text-12px" /></template>
              复制全文
            </NButton>
          </div>
          <div class="doc-live-paper flex-1">
            <template v-for="(blk, idx) in parseDocPreview(previewBody)" :key="idx">
              <h1 v-if="blk.type === 'h1'" class="doc-paper-h1">{{ blk.text }}</h1>
              <h2 v-else-if="blk.type === 'h2'" class="doc-paper-h2">{{ blk.text }}</h2>
              <h3 v-else-if="blk.type === 'h3'" class="doc-paper-h3">{{ blk.text }}</h3>
              <blockquote v-else-if="blk.type === 'quote'" class="doc-paper-quote">{{ blk.text }}</blockquote>
              <ul v-else-if="blk.type === 'ul'" class="doc-paper-ul">
                <li v-for="(li, liIdx) in blk.items" :key="liIdx">{{ li }}</li>
              </ul>
              <ol v-else-if="blk.type === 'ol'" class="doc-paper-ol">
                <li v-for="(li, liIdx) in blk.items" :key="liIdx">{{ li }}</li>
              </ol>
              <hr v-else-if="blk.type === 'hr'" class="doc-paper-hr" />
              <p v-else class="doc-paper-p">{{ blk.text }}</p>
            </template>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="flex flex-wrap justify-between gap-8px">
          <NButton size="small" @click="createFromTplShow = false">取消</NButton>
          <div class="flex flex-wrap gap-8px">
            <NButton size="small" secondary @click="exportDocMarkdown(createDocTitle, previewBody)">
              <template #icon><SvgIcon icon="lucide:file-code" /></template>
              导出 Markdown
            </NButton>
            <NButton size="small" secondary @click="exportDocWord(createDocTitle, previewBody)">
              <template #icon><SvgIcon icon="lucide:file-text" /></template>
              导出 Word(.doc)
            </NButton>
            <NButton type="primary" size="small" @click="saveFromTemplateToArchive">
              <template #icon><SvgIcon icon="lucide:archive" /></template>
              存入归档
            </NButton>
          </div>
        </div>
      </template>
    </NModal>

    <!-- Modal C：归档文档双栏实时编辑器（新建空白 / 编辑已有 / 复用复制） -->
    <NModal
      v-model:show="docEditorShow"
      preset="card"
      :title="
        docEditorMode === 'edit'
          ? '编辑归档材料'
          : docEditorMode === 'duplicate'
            ? '基于往期归档复用新建'
            : '新建空白归档材料'
      "
      class="max-w-95vw w-980px"
      :mask-closable="false"
    >
      <div class="flex flex-col gap-12px">
        <div class="grid grid-cols-1 gap-10px md:grid-cols-12">
          <div class="md:col-span-8">
            <div class="mb-4px text-12px font-semibold text-gray-500">材料标题 *</div>
            <NInput v-model:value="docForm.title" size="small" placeholder="输入材料标题" />
          </div>
          <div class="md:col-span-4">
            <div class="mb-4px text-12px font-semibold text-gray-500">归档分类</div>
            <NSelect
              v-model:value="docForm.category"
              size="small"
              filterable
              tag
              :options="categorySelectOptions"
              placeholder="选择或输入分类"
            />
          </div>
        </div>

        <!-- 快捷排版工具栏 -->
        <div
          class="flex flex-wrap items-center justify-between gap-8px rounded-8px bg-[var(--sct-soft)] px-10px py-6px"
        >
          <div class="flex flex-wrap items-center gap-6px">
            <span class="text-11px font-semibold text-gray-500">快捷插入：</span>
            <NButton size="tiny" secondary @click="insertDocSnippet('\n## 章节标题\n\n')">二级标题</NButton>
            <NButton size="tiny" secondary @click="insertDocSnippet('\n- 要点条目\n')">项目清单</NButton>
            <NButton size="tiny" secondary @click="insertDocSnippet('\n> 补充说明或决议要点\n')">引用块</NButton>
            <NButton
              size="tiny"
              secondary
              @click="insertDocSnippet(`\n---\n\n${currentBranchName}\n${dayjs().format('YYYY年M月D日')}`)"
            >
              支部落款
            </NButton>
          </div>
          <span class="text-11px text-gray-400">正文约 {{ docCharCount }} 字</span>
        </div>

        <div class="grid grid-cols-1 gap-12px md:grid-cols-2">
          <div ref="docTextareaWrapRef" class="flex flex-col">
            <div class="mb-5px text-12px font-semibold text-gray-500">
              <span class="inline-flex items-center gap-4px">
                <SvgIcon icon="lucide:pencil-line" class="text-13px" />
                正文编辑（支持 Markdown 标题与列表）
              </span>
            </div>
            <NInput
              v-model:value="docForm.body"
              type="textarea"
              :rows="16"
              class="font-mono text-12px"
              placeholder="在此编辑材料正文…"
            />
          </div>
          <div class="flex flex-col">
            <div class="mb-5px text-12px font-semibold text-gray-500">
              <span class="inline-flex items-center gap-4px">
                <SvgIcon icon="lucide:eye" class="text-13px" />
                实时排版预览
              </span>
            </div>
            <div class="doc-live-paper flex-1">
              <template v-for="(blk, idx) in parseDocPreview(docForm.body)" :key="idx">
                <h1 v-if="blk.type === 'h1'" class="doc-paper-h1">{{ blk.text }}</h1>
                <h2 v-else-if="blk.type === 'h2'" class="doc-paper-h2">{{ blk.text }}</h2>
                <h3 v-else-if="blk.type === 'h3'" class="doc-paper-h3">{{ blk.text }}</h3>
                <blockquote v-else-if="blk.type === 'quote'" class="doc-paper-quote">{{ blk.text }}</blockquote>
                <ul v-else-if="blk.type === 'ul'" class="doc-paper-ul">
                  <li v-for="(li, liIdx) in blk.items" :key="liIdx">{{ li }}</li>
                </ul>
                <ol v-else-if="blk.type === 'ol'" class="doc-paper-ol">
                  <li v-for="(li, liIdx) in blk.items" :key="liIdx">{{ li }}</li>
                </ol>
                <hr v-else-if="blk.type === 'hr'" class="doc-paper-hr" />
                <p v-else class="doc-paper-p">{{ blk.text }}</p>
              </template>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="flex flex-wrap items-center justify-between gap-8px">
          <NButton size="small" @click="docEditorShow = false">取消</NButton>
          <div class="flex flex-wrap gap-8px">
            <NButton size="small" secondary @click="copyDocText(docForm.body)">
              <template #icon><SvgIcon icon="lucide:copy" /></template>
              复制全文
            </NButton>
            <NButton size="small" secondary @click="exportDocMarkdown(docForm.title, docForm.body)">
              <template #icon><SvgIcon icon="lucide:file-code" /></template>
              导出 Markdown
            </NButton>
            <NButton size="small" secondary @click="exportDocWord(docForm.title, docForm.body)">
              <template #icon><SvgIcon icon="lucide:file-text" /></template>
              导出 Word(.doc)
            </NButton>
            <NButton size="small" type="primary" @click="handleSaveDocEditor">
              <template #icon><SvgIcon icon="lucide:save" /></template>
              {{ docEditorMode === 'edit' ? '保存修改' : '存入归档' }}
            </NButton>
          </div>
        </div>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.tpl-cat-pill {
  padding: 3px 11px;
  font-size: 12px;
  font-weight: 500;
  color: var(--sct-muted);
  background: var(--sct-soft);
  border: 1px solid var(--sct-border);
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.tpl-cat-pill:hover {
  border-color: var(--sct-accent, #a81c24);
  color: var(--sct-ink);
}

.tpl-cat-pill.is-active {
  color: #fff;
  background: var(--sct-accent, #a81c24);
  border-color: var(--sct-accent, #a81c24);
  font-weight: 600;
}

.tpl-card {
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--sct-soft);
  border: 1px solid var(--sct-border);
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    transform 0.15s ease;
}

.tpl-card:hover {
  border-color: var(--sct-accent, #a81c24);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  transform: translateY(-1px);
}

.doc-live-paper {
  min-height: 316px;
  max-height: 360px;
  overflow-y: auto;
  padding: 14px 16px;
  border-radius: 10px;
  background: var(--sct-soft);
  border: 1px solid var(--sct-border);
  color: var(--sct-ink);
  font-size: 13px;
  line-height: 1.75;
}

.doc-paper-h1 {
  margin: 0 0 10px;
  font-size: 16px;
  font-weight: 800;
  text-align: center;
  color: var(--sct-ink);
}

.doc-paper-h2 {
  margin: 12px 0 6px;
  padding-bottom: 4px;
  border-bottom: 1px dashed var(--sct-border);
  font-size: 14px;
  font-weight: 700;
  color: #a81c24;
}

.doc-paper-h3 {
  margin: 8px 0 4px;
  font-size: 13px;
  font-weight: 700;
}

.doc-paper-p {
  margin: 0 0 6px;
  white-space: pre-wrap;
}

.doc-paper-ul,
.doc-paper-ol {
  margin: 4px 0 8px;
  padding-left: 18px;
}

.doc-paper-quote {
  margin: 6px 0 8px;
  padding: 6px 10px;
  border-left: 3px solid var(--sct-accent, #a81c24);
  background: var(--sct-container);
  border-radius: 6px;
  color: var(--sct-muted);
  white-space: pre-wrap;
}

.doc-paper-hr {
  margin: 10px 0;
  border: none;
  border-top: 1px solid var(--sct-border);
}
</style>

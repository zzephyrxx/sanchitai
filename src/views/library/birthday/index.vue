<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { NPopconfirm } from 'naive-ui';
import dayjs from 'dayjs';
import {
  batchExportZip,
  batchSequential,
  downloadPage,
  downloadSheet,
  printSheet,
  saveBlob,
  sheetCanvas
} from '@/utils/pbc/export';
import type { PbcRosterRow } from '@/utils/pbc/export';
import { ensureReady, paint, preview } from '@/utils/pbc/render';
import { H, TEMPLATE_LIST, TEMPLATE_MAP, W, partyAge } from '@/utils/pbc/templates';
import type { PbcState } from '@/utils/pbc/templates';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useSctI18n } from '@/hooks/common/sct-i18n';

defineOptions({ name: 'PoliticalBirthdayPage' });

const route = useRoute();
const workStore = useWorkDataStore();
const { bi } = useSctI18n();

const STATE_KEY = 'sct_pbc_state_v1';
const ROSTER_KEY = 'sct_pbc_roster_v1';

const STANDARD_OATH =
  '我志愿加入中国共产党，拥护党的纲领，遵守党的章程，履行党员义务，执行党的决定，严守党的纪律，保守党的秘密，对党忠诚，积极工作，为共产主义奋斗终身，随时准备为党和人民牺牲一切，永不叛党。';

const WISH_PRESETS: Array<{ label: string; text: string }> = [
  {
    label: '初心使命',
    text: '希望你牢记入党时的铮铮誓言，常思入党初心、常担党员之责，在学习与工作中当先锋、作表率，以实干实绩为党旗增辉。'
  },
  {
    label: '先锋表率',
    text: '希望你始终以党员标准严格要求自己，坚定理想信念，永葆政治本色，在科研攻关与平凡岗位上践行为人民服务的宗旨。'
  },
  {
    label: '理论学习',
    text: '希望你坚持读原著、学原文、悟原理，把理论学习成果转化为干事创业的本领，做到知行合一、久久为功。'
  },
  {
    label: '实干担当',
    text: '希望你把政治生日作为新的起点，勇于担当、善于作为，以实干实绩回应组织的信任与师生的期待。'
  }
];

function createDefaultState(): PbcState {
  return {
    template: 'classic',
    name: '陈明远',
    branch: '中共智感硕博支部委员会（演示）',
    joinDate: '2021-05-20',
    signDate: dayjs().format('YYYY-MM-DD'),
    partyAgeMode: 'auto',
    partyAge: '',
    wishes: WISH_PRESETS[0].text,
    coverTitle: '政治生日卡',
    coverSlogan: '不忘初心 牢记使命',
    oath: STANDARD_OATH,
    showOath: true,
    showEmblem: true,
    showBranchOnCover: true,
    showFlag: false,
    emblemVariant: 'auto',
    font: 'song',
    fontSize: 1,
    goldTone: 0
  };
}

const DEFAULT_ROSTER: PbcRosterRow[] = [
  { name: '陈明远', joinDate: '2021-05-20', wishes: '', branch: '', signDate: '', partyAge: '' },
  { name: '林嘉树', joinDate: '2022-11-18', wishes: WISH_PRESETS[1].text, branch: '', signDate: '', partyAge: '' },
  { name: '宋知夏', joinDate: '2020-07-01', wishes: WISH_PRESETS[2].text, branch: '', signDate: '', partyAge: '' }
];

function loadState(): PbcState {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return createDefaultState();
    const parsed = JSON.parse(raw) as Partial<PbcState>;
    return { ...createDefaultState(), ...parsed };
  } catch {
    return createDefaultState();
  }
}

function loadRoster(): PbcRosterRow[] {
  try {
    const raw = localStorage.getItem(ROSTER_KEY);
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_ROSTER)) as PbcRosterRow[];
    const parsed = JSON.parse(raw) as PbcRosterRow[];
    return Array.isArray(parsed) ? parsed : (JSON.parse(JSON.stringify(DEFAULT_ROSTER)) as PbcRosterRow[]);
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_ROSTER)) as PbcRosterRow[];
  }
}

const state = reactive<PbcState>(loadState());
const roster = ref<PbcRosterRow[]>(loadRoster());
const activeTab = ref<'content' | 'style' | 'roster'>('content');
const viewMode = ref<'cover' | 'inner' | 'sheet'>('cover');
const previewRowIdx = ref<number | null>(null);
const selectedMemberId = ref<string | null>(null);

// 导出选项
const expScale = ref<number>(2);
const expType = ref<string>('image/png');
const rosterExportMode = ref<'zip' | 'files'>('zip');
const busy = ref(false);
const batchProgress = ref('');

// 弹窗状态
const helpShow = ref(false);
const importShow = ref(false);
const importText = ref('');

// Canvas 引用
const previewCanvasRef = ref<HTMLCanvasElement | null>(null);
const sheetFrontRef = ref<HTMLCanvasElement | null>(null);
const sheetBackRef = ref<HTMLCanvasElement | null>(null);
const thumbCanvasMap = new Map<string, HTMLCanvasElement>();

function setThumbRef(id: string, el: unknown) {
  if (el instanceof HTMLCanvasElement) {
    thumbCanvasMap.set(id, el);
  }
}

// ---------------- 在册党员联动 ----------------
const currentMonthMm = dayjs().format('MM');

const partyMembers = computed(() => workStore.members.filter(m => m.type === '正式党员' || m.type === '预备党员'));

const thisMonthBirthdayMembers = computed(() =>
  partyMembers.value.filter(m => {
    const jd = m.join_date || m.key_dates?.accepted_at || '';
    return jd.length >= 7 && jd.slice(5, 7) === currentMonthMm;
  })
);

const memberSelectOptions = computed(() =>
  partyMembers.value.map(m => {
    const jd = m.join_date || m.key_dates?.accepted_at || '';
    const isThisMonth = jd.length >= 7 && jd.slice(5, 7) === currentMonthMm;
    const suffix = isThisMonth ? ' 🎂本月政治生日' : '';
    return {
      label: `${m.name}（${m.type}${jd ? ` · 入党 ${jd}` : ''}${suffix}）`,
      value: m.id
    };
  })
);

function applyMemberToForm(memberId: string | null) {
  selectedMemberId.value = memberId;
  if (!memberId) return;
  const m = workStore.memberOf(memberId);
  if (!m) return;
  previewRowIdx.value = null;
  state.name = m.name;
  const jd = m.join_date || m.key_dates?.accepted_at || '';
  if (jd) {
    state.joinDate = jd;
  }
  window.$message?.success(`已载入「${m.name}」同志的入党信息`);
}

function importAllMembersToRoster(onlyThisMonth = false) {
  const source = onlyThisMonth ? thisMonthBirthdayMembers.value : partyMembers.value;
  if (!source.length) {
    window.$message?.info(onlyThisMonth ? '本月暂无政治生日（入党月份匹配）的在册党员' : '暂无在册党员数据');
    return;
  }
  roster.value = source.map(m => ({
    name: m.name,
    joinDate: m.join_date || m.key_dates?.accepted_at || state.joinDate,
    wishes: '',
    branch: '',
    signDate: '',
    partyAge: ''
  }));
  previewRowIdx.value = null;
  persistNow();
  scheduleRender();
  window.$message?.success(`已从在册台账载入 ${source.length} 名党员到批量名单`);
}

// ---------------- 字号与烫金滑块计算属性 ----------------
const fontSizePct = computed<number>({
  get: () => Math.round((state.fontSize || 1) * 100),
  set: v => {
    state.fontSize = (v || 100) / 100;
  }
});

const goldToneStep = computed<number>({
  get: () => Math.round((state.goldTone || 0) * 10),
  set: v => {
    state.goldTone = (v || 0) / 10;
  }
});

const wishCharCount = computed(() => Array.from(state.wishes || '').length);
const wishCap = computed(() => Math.round(80 / (state.fontSize || 1)));
const computedPartyAge = computed(() => partyAge(currentRenderState.value));

/** 当前用于预览/单张导出的状态（若选中了名单某行则优先预览该行） */
const currentRenderState = computed<PbcState>(() => {
  const base: PbcState = { ...state };
  if (previewRowIdx.value === null || !roster.value[previewRowIdx.value]) {
    return base;
  }
  const r = roster.value[previewRowIdx.value];
  if (r.name.trim()) base.name = r.name.trim();
  if (r.joinDate.trim()) base.joinDate = r.joinDate.trim();
  if (r.wishes.trim()) base.wishes = r.wishes.trim();
  if (r.branch.trim()) base.branch = r.branch.trim();
  if (r.signDate.trim()) base.signDate = r.signDate.trim();
  if (r.partyAge.trim()) {
    base.partyAge = r.partyAge.trim();
    base.partyAgeMode = 'manual';
  }
  return base;
});

const activeTemplateInfo = computed(() => TEMPLATE_MAP[state.template] || TEMPLATE_LIST[0]);

// ---------------- 持久化与渲染调度 ----------------
let saveTimer: number | null = null;
let rafId: number | null = null;

function persistNow() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
    localStorage.setItem(ROSTER_KEY, JSON.stringify(roster.value));
  } catch {
    /* 忽略存储受限 */
  }
}

function persistSoon() {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
  }
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    persistNow();
  }, 360);
}

function renderThumbs() {
  TEMPLATE_LIST.forEach(tpl => {
    const cv = thumbCanvasMap.get(tpl.id);
    if (!cv) return;
    cv.width = 240;
    cv.height = Math.round((240 * H) / W);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const s = 240 / W;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    paint(ctx, 'cover', { ...state, template: tpl.id }, 1, 0, 0);
  });
}

function renderStage() {
  const S = currentRenderState.value;
  if (viewMode.value === 'sheet') {
    const frontHost = sheetFrontRef.value;
    const backHost = sheetBackRef.value;
    if (frontHost) {
      const src = sheetCanvas('front', S);
      frontHost.width = src.width;
      frontHost.height = src.height;
      frontHost.getContext('2d')?.drawImage(src, 0, 0);
    }
    if (backHost) {
      const src = sheetCanvas('back', S);
      backHost.width = src.width;
      backHost.height = src.height;
      backHost.getContext('2d')?.drawImage(src, 0, 0);
    }
    return;
  }
  if (previewCanvasRef.value) {
    preview(previewCanvasRef.value, viewMode.value, S, 1);
  }
}

function scheduleRender() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
  }
  rafId = requestAnimationFrame(() => {
    rafId = null;
    renderStage();
  });
}

watch(
  state,
  () => {
    scheduleRender();
    persistSoon();
  },
  { deep: true }
);

watch(viewMode, () => {
  void nextTick(() => {
    scheduleRender();
  });
});

watch(
  roster,
  () => {
    persistSoon();
    if (previewRowIdx.value !== null) {
      scheduleRender();
    }
  },
  { deep: true }
);

onMounted(async () => {
  const qMemberId = typeof route.query.memberId === 'string' ? route.query.memberId : '';
  if (qMemberId) {
    applyMemberToForm(qMemberId);
  }
  await ensureReady();
  renderThumbs();
  scheduleRender();
});

onBeforeUnmount(() => {
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  if (rafId !== null) cancelAnimationFrame(rafId);
});

// ---------------- 模板与快捷动作 ----------------
function selectTemplate(tplId: string) {
  state.template = tplId;
  scheduleRender();
  persistSoon();
}

function applyWishPreset(text: string) {
  state.wishes = text;
  window.$message?.success('已套用常用寄语');
}

function resetOath() {
  state.oath = STANDARD_OATH;
  window.$message?.success('已恢复标准入党誓词');
}

function resetAll() {
  Object.assign(state, createDefaultState());
  roster.value = JSON.parse(JSON.stringify(DEFAULT_ROSTER)) as PbcRosterRow[];
  previewRowIdx.value = null;
  selectedMemberId.value = null;
  viewMode.value = 'cover';
  persistNow();
  renderThumbs();
  scheduleRender();
  window.$message?.success('已恢复初始设置');
}

// ---------------- 名单管理 ----------------
function addRosterRow() {
  roster.value.push({ name: '', joinDate: '', wishes: '', branch: '', signDate: '', partyAge: '' });
}

function removeRosterRow(idx: number) {
  roster.value.splice(idx, 1);
  if (previewRowIdx.value === idx) {
    previewRowIdx.value = null;
  } else if (previewRowIdx.value !== null && previewRowIdx.value > idx) {
    previewRowIdx.value -= 1;
  }
}

function togglePreviewRow(idx: number) {
  previewRowIdx.value = previewRowIdx.value === idx ? null : idx;
  scheduleRender();
}

function clearRoster() {
  roster.value = [];
  previewRowIdx.value = null;
  persistNow();
  scheduleRender();
  window.$message?.success('批量名单已清空');
}

function downloadCsvTemplate() {
  const csv =
    '\uFEFF姓名,入党日期,寄语,支部名称,落款日期,党龄\r\n' +
    '陈明远,2021-05-20,"希望你牢记入党初心，发挥先锋模范作用。",中共智感硕博支部委员会（演示）,,\r\n' +
    '林嘉树,2022-11-18,,,,';
  saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), '政治生日贺卡_名单模板.csv');
  window.$message?.success('已下载 CSV 名单模板');
}

function parseCsvLine(line: string): string[] {
  const delim = line.includes('\t') ? '\t' : ',';
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (c === delim && !quoted) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur.trim());
  return out;
}

function handlePasteImport() {
  const lines = importText.value
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  if (!lines.length) {
    window.$message?.warning('请粘贴名单内容');
    return;
  }
  const first = parseCsvLine(lines[0]);
  if (/姓名|name/i.test(first[0] || '')) {
    lines.shift();
  }
  const rows: PbcRosterRow[] = lines
    .map(l => {
      const c = parseCsvLine(l);
      return {
        name: c[0] || '',
        joinDate: c[1] || '',
        wishes: c[2] || '',
        branch: c[3] || '',
        signDate: c[4] || '',
        partyAge: c[5] || ''
      };
    })
    .filter(r => r.name.trim());

  if (!rows.length) {
    window.$message?.warning('未解析到有效人员数据，请检查格式');
    return;
  }
  roster.value = rows;
  previewRowIdx.value = null;
  importShow.value = false;
  importText.value = '';
  persistNow();
  scheduleRender();
  window.$message?.success(`已导入 ${rows.length} 位同志`);
}

// ---------------- 导出与打印动作 ----------------
async function handleExportCurrent() {
  if (busy.value) return;
  busy.value = true;
  try {
    const kind = viewMode.value === 'inner' ? 'inner' : 'cover';
    await downloadPage(kind, currentRenderState.value, { scale: expScale.value, type: expType.value });
    window.$message?.success(`已导出${kind === 'cover' ? '封面' : '内页'}`);
  } catch (err) {
    window.$message?.error(`导出失败：${(err as Error).message}`);
  } finally {
    busy.value = false;
  }
}

async function handleExportBoth() {
  if (busy.value) return;
  busy.value = true;
  try {
    const S = currentRenderState.value;
    await Promise.all([
      downloadPage('cover', S, { scale: expScale.value, type: expType.value }),
      downloadPage('inner', S, { scale: expScale.value, type: expType.value })
    ]);
    window.$message?.success('已导出封面与内页');
  } catch (err) {
    window.$message?.error(`导出失败：${(err as Error).message}`);
  } finally {
    busy.value = false;
  }
}

async function handleDownloadSheet(side: 'front' | 'back') {
  if (busy.value) return;
  busy.value = true;
  try {
    await downloadSheet(side, currentRenderState.value);
    window.$message?.success(`已导出 A4 ${side === 'front' ? '正面' : '背面'}拼版`);
  } catch (err) {
    window.$message?.error(`导出失败：${(err as Error).message}`);
  } finally {
    busy.value = false;
  }
}

function handlePrintSheet() {
  printSheet(currentRenderState.value);
  window.$message?.info('打印窗口已打开，双面打印请选择「短边翻转」');
}

async function handleBatchExport() {
  if (busy.value) return;
  const validRows = roster.value.filter(r => r.name.trim());
  if (!validRows.length) {
    window.$message?.warning('批量名单为空，请先添加或从在册党员载入');
    return;
  }
  busy.value = true;
  try {
    const onProgress = (idx: number, total: number, row: PbcRosterRow | null) => {
      batchProgress.value = row ? `正在生成 ${idx + 1}/${total}：${row.name}` : `已完成 ${total}/${total}`;
    };
    if (rosterExportMode.value === 'zip') {
      await batchExportZip(validRows, state, { scale: 2 }, onProgress);
    } else {
      await batchSequential(validRows, state, { scale: 2, type: 'image/png' }, onProgress);
    }
    window.$message?.success(`已生成 ${validRows.length} 位同志的政治生日贺卡`);
  } catch (err) {
    window.$message?.error(`批量生成失败：${(err as Error).message}`);
  } finally {
    busy.value = false;
    window.setTimeout(() => {
      batchProgress.value = '';
    }, 3500);
  }
}
</script>

<template>
  <div class="min-h-560px flex flex-col gap-16px lg:flex-row">
    <!-- 左侧控制面板 -->
    <NCard :bordered="false" class="w-full flex-shrink-0 lg:w-420px" :content-style="{ padding: '14px 16px' }">
      <template #header>
        <div class="flex items-center gap-8px">
          <span class="inline-flex size-28px items-center justify-center rounded-8px bg-[#A81C24]/10 text-[#A81C24]">
            <SvgIcon icon="lucide:gift" class="text-16px" />
          </span>
          <div>
            <div class="text-15px font-bold">{{ bi('政治生日贺卡工作坊', 'Political Birthday Card Studio') }}</div>
            <div class="text-11px text-gray-400">
              {{
                bi(
                  '6 套中式党建模板 · 支持台账选人与批量拼版打印',
                  '6 Party templates · Roster picker & A4 batch imposition'
                )
              }}
            </div>
          </div>
        </div>
      </template>

      <NTabs v-model:value="activeTab" type="segment" size="small" class="mb-14px">
        <NTab name="content" :tab="bi('内容与模板', 'Content & Template')" />
        <NTab name="style" :tab="bi('版式与元素', 'Layout & Elements')" />
        <NTab name="roster" :tab="`${bi('批量名单', 'Batch Roster')}（${roster.length}）`" />
      </NTabs>

      <!-- Tab 1: 内容与模板 -->
      <div v-show="activeTab === 'content'" class="flex flex-col gap-12px">
        <div>
          <div class="mb-8px flex items-center justify-between text-12px font-bold text-gray-500">
            <span>选择模板（共 6 套，各含封面与内页）</span>
            <span class="text-11px text-[#A81C24]">{{ activeTemplateInfo.name }} · {{ activeTemplateInfo.tag }}</span>
          </div>
          <div class="grid grid-cols-3 gap-8px">
            <button
              v-for="tpl in TEMPLATE_LIST"
              :key="tpl.id"
              type="button"
              class="pbc-tpl-btn"
              :class="{ 'pbc-tpl-btn--active': state.template === tpl.id }"
              :title="tpl.desc"
              @click="selectTemplate(tpl.id)"
            >
              <canvas :ref="el => setThumbRef(tpl.id, el)" class="block h-auto w-full" />
              <span class="pbc-tpl-btn__name">{{ tpl.name }}</span>
            </button>
          </div>
        </div>

        <!-- 从在册党员快速选人 -->
        <div class="rounded-10px bg-[var(--sct-soft)] p-10px">
          <div class="mb-6px flex items-center justify-between text-12px">
            <span class="flex items-center gap-5px font-bold text-[var(--sct-ink)]">
              <SvgIcon icon="lucide:user-check" class="text-14px text-[#A81C24]" />
              从支部在册党员快选
            </span>
            <NTag v-if="thisMonthBirthdayMembers.length" size="tiny" type="error" :bordered="false" round>
              本月政治生日 {{ thisMonthBirthdayMembers.length }} 人
            </NTag>
          </div>
          <NSelect
            :value="selectedMemberId"
            :options="memberSelectOptions"
            placeholder="选择在册正式/预备党员自动填入姓名与入党日期…"
            size="small"
            filterable
            clearable
            @update:value="applyMemberToForm"
          />
        </div>

        <NForm
          label-placement="left"
          label-width="84"
          size="small"
          :show-feedback="false"
          class="flex flex-col gap-10px"
        >
          <NFormItem label="党员姓名">
            <NInput v-model:value="state.name" placeholder="内页显示为「×× 同志」" />
          </NFormItem>
          <NFormItem label="入党日期">
            <NInput v-model:value="state.joinDate" placeholder="YYYY-MM-DD（如 2021-05-20）" />
          </NFormItem>
          <NFormItem label="落款日期">
            <NInput v-model:value="state.signDate" placeholder="YYYY-MM-DD" />
          </NFormItem>
          <NFormItem label="党龄计算">
            <div class="flex w-full items-center gap-8px">
              <NSelect
                v-model:value="state.partyAgeMode"
                :options="[
                  { label: `自动计算（${computedPartyAge} 年）`, value: 'auto' },
                  { label: '手动填写', value: 'manual' }
                ]"
                class="flex-1"
              />
              <NInput
                v-if="state.partyAgeMode === 'manual'"
                v-model:value="state.partyAge"
                placeholder="年数"
                class="w-80px"
              />
            </div>
          </NFormItem>
          <NFormItem label="支部名称">
            <NInput v-model:value="state.branch" placeholder="填写党支部全称" />
          </NFormItem>
          <NFormItem label="政治寄语">
            <div class="w-full flex flex-col gap-6px">
              <NInput
                v-model:value="state.wishes"
                type="textarea"
                :rows="3"
                placeholder="填写给党员同志的政治生日寄语"
              />
              <div class="flex flex-wrap items-center justify-between gap-4px text-11px text-gray-400">
                <div class="flex flex-wrap items-center gap-4px">
                  <span>常用：</span>
                  <NButton
                    v-for="p in WISH_PRESETS"
                    :key="p.label"
                    size="tiny"
                    secondary
                    @click="applyWishPreset(p.text)"
                  >
                    {{ p.label }}
                  </NButton>
                </div>
                <span :class="{ 'text-[#d43030] font-bold': wishCharCount > wishCap }">
                  {{ wishCharCount }}/{{ wishCap }} 字
                </span>
              </div>
            </div>
          </NFormItem>
        </NForm>
      </div>

      <!-- Tab 2: 版式与元素 -->
      <div v-show="activeTab === 'style'" class="flex flex-col gap-12px">
        <NForm
          label-placement="left"
          label-width="88"
          size="small"
          :show-feedback="false"
          class="flex flex-col gap-10px"
        >
          <NFormItem label="正文字体">
            <NSelect
              v-model:value="state.font"
              :options="[
                { label: '宋体 / 传统衬线', value: 'song' },
                { label: '楷体 / 手书风范', value: 'kai' },
                { label: '黑体 / 现代无衬线', value: 'hei' }
              ]"
            />
          </NFormItem>
          <NFormItem :label="`整体字号 ${fontSizePct}%`">
            <NSlider v-model:value="fontSizePct" :min="80" :max="125" :step="1" />
          </NFormItem>
          <NFormItem :label="`烫金明暗 ${goldToneStep}`">
            <NSlider v-model:value="goldToneStep" :min="-10" :max="10" :step="1" />
          </NFormItem>
          <NFormItem label="党徽配色">
            <NSelect
              v-model:value="state.emblemVariant"
              :options="[
                { label: '跟随模板默认', value: 'auto' },
                { label: '烫金党徽', value: 'gold' },
                { label: '正红党徽', value: 'red' }
              ]"
            />
          </NFormItem>
        </NForm>

        <div class="grid grid-cols-2 gap-8px rounded-10px bg-[var(--sct-soft)] p-10px text-12px">
          <label class="flex cursor-pointer items-center justify-between gap-6px">
            <span>显示党徽</span>
            <NSwitch v-model:value="state.showEmblem" size="small" />
          </label>
          <label class="flex cursor-pointer items-center justify-between gap-6px">
            <span>封面加标准党旗</span>
            <NSwitch v-model:value="state.showFlag" size="small" />
          </label>
          <label class="flex cursor-pointer items-center justify-between gap-6px">
            <span>内页显示誓词</span>
            <NSwitch v-model:value="state.showOath" size="small" />
          </label>
          <label class="flex cursor-pointer items-center justify-between gap-6px">
            <span>封面显示支部</span>
            <NSwitch v-model:value="state.showBranchOnCover" size="small" />
          </label>
        </div>

        <NForm
          label-placement="left"
          label-width="88"
          size="small"
          :show-feedback="false"
          class="flex flex-col gap-10px"
        >
          <NFormItem label="封面主标题">
            <NInput v-model:value="state.coverTitle" placeholder="政治生日卡" />
          </NFormItem>
          <NFormItem label="页脚标语">
            <NInput v-model:value="state.coverSlogan" placeholder="不忘初心 牢记使命" />
          </NFormItem>
          <NFormItem label="入党誓词">
            <div class="w-full flex flex-col gap-6px">
              <NInput v-model:value="state.oath" type="textarea" :rows="4" />
              <div class="flex justify-end">
                <NButton size="tiny" secondary @click="resetOath">
                  <template #icon><SvgIcon icon="lucide:rotate-ccw" /></template>
                  恢复标准入党誓词
                </NButton>
              </div>
            </div>
          </NFormItem>
        </NForm>
      </div>

      <!-- Tab 3: 批量名单 -->
      <div v-show="activeTab === 'roster'" class="flex flex-col gap-10px">
        <div class="rounded-8px bg-[var(--sct-soft)] p-10px text-12px leading-relaxed text-gray-500">
          留空项自动继承「内容与模板」页设置；点击序号可在右侧单独预览该同志贺卡。
        </div>

        <div class="flex flex-wrap gap-6px">
          <NButton size="tiny" type="primary" secondary @click="importAllMembersToRoster(false)">
            <template #icon><SvgIcon icon="lucide:users" /></template>
            载入全部在册党员
          </NButton>
          <NButton size="tiny" type="error" secondary @click="importAllMembersToRoster(true)">
            <template #icon><SvgIcon icon="lucide:cake" /></template>
            载入本月政治生日
          </NButton>
          <NButton size="tiny" secondary @click="addRosterRow">
            <template #icon><SvgIcon icon="lucide:plus" /></template>
            添加一行
          </NButton>
          <NButton size="tiny" secondary @click="importShow = true">
            <template #icon><SvgIcon icon="lucide:clipboard-paste" /></template>
            粘贴导入
          </NButton>
          <NButton size="tiny" secondary @click="downloadCsvTemplate">
            <template #icon><SvgIcon icon="lucide:file-spreadsheet" /></template>
            CSV 模板
          </NButton>
          <NPopconfirm @positive-click="clearRoster">
            <template #trigger>
              <NButton size="tiny" secondary type="error">
                <template #icon><SvgIcon icon="lucide:trash-2" /></template>
                清空
              </NButton>
            </template>
            确认清空批量名单中的所有行？
          </NPopconfirm>
        </div>

        <div class="max-h-360px flex flex-col gap-8px overflow-auto pr-2px">
          <div
            v-if="!roster.length"
            class="rounded-8px border border-dashed border-[var(--sct-border)] py-20px text-center text-12px text-gray-400"
          >
            {{
              bi(
                '暂无名单，点击上方「载入全部在册党员」或「添加一行」开始编辑',
                'No entries yet — click Load Members or Add Row above'
              )
            }}
          </div>
          <div
            v-for="(row, idx) in roster"
            :key="idx"
            class="rounded-10px border border-[var(--sct-border)] bg-[var(--sct-container)] p-9px transition"
            :class="{ 'border-[#A81C24] bg-[#A81C24]/5': previewRowIdx === idx }"
          >
            <!-- 第 1 行：预览序号 + 姓名 + 入党日期 + 删除 -->
            <div class="flex items-center gap-6px">
              <button
                type="button"
                class="shrink-0 rounded-5px px-7px py-3px text-11px font-bold transition"
                :class="
                  previewRowIdx === idx
                    ? 'bg-[#A81C24] text-white'
                    : 'bg-[var(--sct-soft)] text-[var(--sct-ink)] hover:text-[#A81C24]'
                "
                title="点击在右侧预览该同志贺卡"
                @click="togglePreviewRow(idx)"
              >
                #{{ idx + 1 }}
              </button>
              <NInput v-model:value="row.name" size="tiny" class="min-w-0 flex-1" placeholder="姓名">
                <template #prefix><SvgIcon icon="lucide:user" class="text-12px text-gray-400" /></template>
              </NInput>
              <NInput v-model:value="row.joinDate" size="tiny" class="w-122px shrink-0" placeholder="YYYY-MM-DD">
                <template #prefix><SvgIcon icon="lucide:calendar" class="text-12px text-gray-400" /></template>
              </NInput>
              <NButton size="tiny" quaternary type="error" title="移除此行" @click="removeRosterRow(idx)">
                <template #icon><SvgIcon icon="lucide:x" /></template>
              </NButton>
            </div>

            <!-- 第 2 行：独占整行宽度的专属寄语编辑区 -->
            <div class="mt-7px flex flex-col gap-4px">
              <div class="flex items-center justify-between text-11px text-gray-500">
                <span class="inline-flex items-center gap-4px font-medium">
                  <SvgIcon icon="lucide:pen-line" class="text-12px text-[#A81C24]" />
                  <span>{{ bi('专属寄语', 'Custom Wishes') }}</span>
                </span>
                <span class="text-10px text-gray-400">
                  {{ row.wishes.trim() ? `${Array.from(row.wishes.trim()).length} 字` : '留空继承默认寄语' }}
                </span>
              </div>
              <NInput
                v-model:value="row.wishes"
                type="textarea"
                size="tiny"
                :autosize="{ minRows: 2, maxRows: 4 }"
                placeholder="输入该同志专属政治生日寄语（留空自动继承「内容与模板」中的默认寄语）…"
              />
            </div>
          </div>
        </div>

        <div class="rounded-10px bg-[var(--sct-soft)] p-10px">
          <div class="mb-6px text-12px font-bold">批量导出方式（2× 高清 2400×1866 PNG）</div>
          <NRadioGroup v-model:value="rosterExportMode" size="small" class="mb-10px flex flex-col gap-6px">
            <NRadio value="zip">打包为单个 ZIP（含每人封面 + 内页 + 汇总 CSV）</NRadio>
            <NRadio value="files">逐张单独下载（需浏览器允许多文件下载）</NRadio>
          </NRadioGroup>
          <div class="flex items-center justify-between gap-8px">
            <NButton type="primary" size="small" :loading="busy" @click="handleBatchExport">
              <template #icon><SvgIcon icon="lucide:folder-down" /></template>
              生成全部贺卡（{{ roster.filter(r => r.name.trim()).length }} 人）
            </NButton>
            <span v-if="batchProgress" class="text-11px font-semibold text-[#A81C24]">{{ batchProgress }}</span>
          </div>
        </div>
      </div>
    </NCard>

    <!-- 右侧实时画布预览与导出工作区 -->
    <NCard
      :bordered="false"
      class="min-w-0 flex-1"
      content-class="h-full flex flex-col justify-between"
      :content-style="{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '14px' }"
    >
      <!-- 顶部视图切换条 -->
      <div class="flex flex-wrap items-center justify-between gap-10px border-b border-[var(--sct-border)] pb-10px">
        <div class="flex items-center gap-10px">
          <NTabs v-model:value="viewMode" type="segment" size="small" class="w-300px">
            <NTab name="cover" :tab="bi('封面展开页', 'Cover Spread')" />
            <NTab name="inner" :tab="bi('内页展开页', 'Inner Spread')" />
            <NTab name="sheet" :tab="bi('A4 对折拼版', 'A4 Imposition')" />
          </NTabs>
          <NTag
            v-if="previewRowIdx !== null && roster[previewRowIdx]"
            size="small"
            type="warning"
            closable
            @close="previewRowIdx = null"
          >
            {{ bi('正在预览名单', 'Previewing') }} #{{ previewRowIdx + 1 }}：{{
              roster[previewRowIdx].name || bi('未命名', 'Unnamed')
            }}
          </NTag>
        </div>

        <div class="flex items-center gap-8px">
          <span class="text-12px text-gray-400">
            {{ activeTemplateInfo.name }} · {{ currentRenderState.name || bi('未填姓名', 'Unnamed') }}（{{
              bi(`党龄 ${computedPartyAge} 年`, `Party Age: ${computedPartyAge} yrs`)
            }}）
          </span>
          <NButton size="tiny" secondary @click="helpShow = true">
            <template #icon><SvgIcon icon="lucide:help-circle" /></template>
            {{ bi('制作与打印说明', 'Print Guide') }}
          </NButton>
          <NPopconfirm @positive-click="resetAll">
            <template #trigger>
              <NButton size="tiny" secondary>
                <template #icon><SvgIcon icon="lucide:rotate-ccw" /></template>
                {{ bi('重置', 'Reset') }}
              </NButton>
            </template>
            {{ bi('确认将贺卡内容、样式与名单恢复为初始状态？', 'Reset card content, style, and roster to default?') }}
          </NPopconfirm>
        </div>
      </div>

      <!-- 中央画布舞台 -->
      <div class="pbc-stage flex-1">
        <div v-show="viewMode !== 'sheet'" class="flex flex-col items-center gap-10px">
          <div class="pbc-canvas-frame">
            <canvas ref="previewCanvasRef" width="1200" height="933" class="block h-auto max-w-full" />
          </div>
          <span class="text-12px text-gray-400">
            {{
              viewMode === 'cover'
                ? '展开整幅（1200×933） · 左半为封底，右半为封面'
                : '展开整幅（1200×933） · 左半为入党誓词，右半为生日寄语与支部落款'
            }}
          </span>
        </div>

        <div v-show="viewMode === 'sheet'" class="w-full flex flex-col gap-16px">
          <div>
            <div class="mb-6px text-12px font-bold text-gray-500">
              第 1 页 · A4 正面（封面 / 封底对折拼版，含裁切线与对折虚线）
            </div>
            <div class="pbc-canvas-frame">
              <canvas ref="sheetFrontRef" class="block h-auto w-full" />
            </div>
          </div>
          <div>
            <div class="mb-6px text-12px font-bold text-gray-500">
              第 2 页 · A4 背面（内页入党誓词 / 政治生日寄语对折拼版）
            </div>
            <div class="pbc-canvas-frame">
              <canvas ref="sheetBackRef" class="block h-auto w-full" />
            </div>
          </div>
        </div>
      </div>

      <!-- 底部导出与打印工具栏 -->
      <div
        class="flex flex-wrap items-center justify-between gap-12px rounded-10px bg-[var(--sct-soft)] px-14px py-10px"
      >
        <div class="flex flex-wrap items-center gap-8px">
          <span class="text-12px font-bold text-gray-500">高清导出：</span>
          <NSelect
            v-model:value="expScale"
            size="small"
            class="w-145px"
            :options="[
              { label: '2× 高清 (2400px)', value: 2 },
              { label: '3× 印刷级 (3600px)', value: 3 }
            ]"
          />
          <NSelect
            v-model:value="expType"
            size="small"
            class="w-95px"
            :options="[
              { label: 'PNG', value: 'image/png' },
              { label: 'JPG', value: 'image/jpeg' }
            ]"
          />
          <NButton type="primary" size="small" :loading="busy" @click="handleExportCurrent">
            <template #icon><SvgIcon icon="lucide:download" /></template>
            导出当前页
          </NButton>
          <NButton size="small" secondary :loading="busy" @click="handleExportBoth">
            <template #icon><SvgIcon icon="lucide:images" /></template>
            导出封面 + 内页
          </NButton>
        </div>

        <div class="flex flex-wrap items-center gap-8px">
          <span class="text-12px font-bold text-gray-500">A4 拼版与打印：</span>
          <NButton size="small" secondary :loading="busy" @click="handleDownloadSheet('front')">
            <template #icon><SvgIcon icon="lucide:file-down" /></template>
            A4 正面
          </NButton>
          <NButton size="small" secondary :loading="busy" @click="handleDownloadSheet('back')">
            <template #icon><SvgIcon icon="lucide:file-down" /></template>
            A4 背面
          </NButton>
          <NButton size="small" type="primary" ghost @click="handlePrintSheet">
            <template #icon><SvgIcon icon="lucide:printer" /></template>
            打印 A4 双面拼版
          </NButton>
        </div>
      </div>
    </NCard>

    <!-- 粘贴导入弹窗 -->
    <NModal v-model:show="importShow" preset="card" title="粘贴导入政治生日名单" class="w-600px">
      <div class="mb-8px text-12px leading-relaxed text-gray-500">
        每行一位同志，支持逗号（CSV）或 Tab（Excel 直接复制粘贴）分隔；留空列自动继承左侧表单当前设置：
      </div>
      <div class="mb-8px rounded-6px bg-[var(--sct-soft)] px-10px py-6px font-mono text-12px text-[var(--sct-ink)]">
        姓名, 入党日期, 寄语, 支部名称, 落款日期, 党龄
      </div>
      <NInput
        v-model:value="importText"
        type="textarea"
        :rows="7"
        placeholder="陈明远, 2021-05-20, 希望你牢记入党初心，发挥先锋模范作用。&#10;林嘉树, 2022-11-18&#10;宋知夏, 2020-07-01"
      />
      <template #footer>
        <div class="flex justify-end gap-8px">
          <NButton size="small" @click="importShow = false">取消</NButton>
          <NButton size="small" type="primary" @click="handlePasteImport">
            <template #icon><SvgIcon icon="lucide:check" /></template>
            导入并覆盖名单
          </NButton>
        </div>
      </template>
    </NModal>

    <!-- 制作与打印说明弹窗 -->
    <NModal v-model:show="helpShow" preset="card" title="政治生日贺卡 · 制作与打印说明" class="w-620px">
      <div class="flex flex-col gap-12px text-13px leading-relaxed text-[var(--sct-ink)]">
        <div>
          <div class="mb-4px font-bold text-[#A81C24]">一、制作流程</div>
          <ol class="ma-0 pl-18px">
            <li>
              在「内容与模板」中选择 6
              套中式党建模板之一，可直接从「支部在册党员」下拉框一键选人自动带出姓名与入党日期。
            </li>
            <li>在「版式与元素」中可微调字体（宋体/楷体/黑体）、字号缩放、烫金明暗、党徽与标准党旗显示开关。</li>
            <li>在「批量名单」中可一键载入支部全部党员或本月过政治生日的党员，打包导出高清 ZIP。</li>
          </ol>
        </div>
        <div>
          <div class="mb-4px font-bold text-[#A81C24]">二、A4 对折双面打印规范</div>
          <p class="ma-0">
            拼版按 A4 横向输出 2 页：第 1 页为封面与封底展开，第 2 页为内页（入党誓词 +
            政治生日寄语）展开。使用彩色打印机双面打印时请选择
            <b>「短边翻转」</b>
            ，打印后沿外框裁切标记裁下、沿中线虚线对折即成标准政治生日贺卡。
          </p>
        </div>
        <div>
          <div class="mb-4px font-bold text-[#A81C24]">三、权威图案与离线隐私</div>
          <p class="ma-0">
            党徽、党旗采用共产党员网（12371.cn）发布的标准规范图案，保持严格长宽比例与配色；全部画布渲染与 ZIP
            打包均在本机浏览器离线完成，不上传任何个人信息。
          </p>
        </div>
      </div>
      <template #footer>
        <div class="flex justify-end">
          <NButton type="primary" size="small" @click="helpShow = false">知道了</NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.pbc-tpl-btn {
  display: flex;
  flex-direction: column;
  padding: 0;
  background: var(--sct-soft);
  border: 1.5px solid var(--sct-border);
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    transform 0.15s ease;
}

.pbc-tpl-btn:hover {
  border-color: #d97706;
  transform: translateY(-1px);
}

.pbc-tpl-btn--active {
  border-color: #a81c24;
  box-shadow: 0 0 0 1px #a81c24;
}

.pbc-tpl-btn__name {
  display: block;
  width: 100%;
  padding: 4px 2px;
  font-size: 11px;
  font-weight: 600;
  text-align: center;
  color: var(--sct-ink);
  background: var(--sct-container);
  border-top: 1px solid var(--sct-border);
}

.pbc-tpl-btn--active .pbc-tpl-btn__name {
  color: #a81c24;
  background: var(--sct-err-soft);
}

.pbc-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 18px;
  background: var(--sct-soft);
  border: 1px solid var(--sct-border);
  border-radius: 12px;
  overflow: auto;
}

.pbc-canvas-frame {
  max-width: min(100%, 880px);
  margin: 0 auto;
  background: #fff;
  border: 1px solid var(--sct-border);
  border-radius: 6px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12);
  overflow: hidden;
}
</style>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import dayjs from 'dayjs';
import { APP_VERSION } from '@/constants/changelog';
import { isMacPlatform, useDesktopBridge } from '@/utils/desktop-bridge';
import type { CloseBehaviorPref, OpenModePref, PickedDirInfo } from '@/utils/desktop-bridge';
import { buildHandoverHtml } from '@/utils/handover';
import { saveFileWithPicker } from '@/utils/save-file';
import { applySctPackImport, exportSctPackBytes, inspectImportBytes } from '@/utils/sctpack';
import type { ExportCategoryKey, SctPackPayload, SctPackSummary } from '@/utils/sctpack';
import { useAppLockStore, LOCK_QUESTIONS } from '@/store/modules/applock';
import { useThemeStore } from '@/store/modules/theme';
import { useUpdaterStore } from '@/store/modules/updater';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useSctI18n } from '@/hooks/common/sct-i18n';
import {
  BACKUP_RING_SIZE,
  clearAllData,
  db,
  deleteBackupSnapshot,
  exportBackup,
  importBackup,
  listBackupRing,
  pushBackupRing
} from '@/db/db';
import { resetToSeed } from '@/db/seed';

defineOptions({ name: 'SettingsPage' });

const appLock = useAppLockStore();
const workStore = useWorkDataStore();
const themeStore = useThemeStore();
const updaterStore = useUpdaterStore();
const { bi } = useSctI18n();
const desktopBridge = useDesktopBridge();

// ---------------- 界面外观：密度与缩放快捷设置（与右侧主题抽屉实时同步） ----------------
const DENSITY_OPTIONS: Array<{ value: UnionKey.ThemeDensity; zh: string; en: string }> = [
  { value: 'compact', zh: '紧凑', en: 'Compact' },
  { value: 'comfortable', zh: '舒适（默认）', en: 'Comfortable' },
  { value: 'loose', zh: '宽松', en: 'Loose' }
];

function handleDensityChange(val: string) {
  themeStore.setDensity(val as UnionKey.ThemeDensity);
}

// ---------------- 自定义数据存储路径（桌面端） ----------------
const dirBusy = ref(false);
const dirConflictModalShow = ref(false);
const pendingPickedDir = ref<PickedDirInfo | null>(null);

const isDesktopManaged = computed(() => desktopBridge.runtimeMode.value !== 'web-standalone');

async function handlePickDataDir() {
  dirBusy.value = true;
  try {
    const res = await desktopBridge.pickDataDir();
    if (res.error) {
      window.$message?.warning(res.error);
      return;
    }
    if (res.cancelled || !res.info) return;
    if (res.info.path === desktopBridge.dataDirInfo.value?.currentDir) {
      window.$message?.info('所选目录与当前数据目录一致，无需变更');
      return;
    }
    if (res.info.hasSyncData) {
      pendingPickedDir.value = res.info;
      dirConflictModalShow.value = true;
    } else {
      await applyDataDirChange('migrate', res.info.path);
    }
  } finally {
    dirBusy.value = false;
  }
}

async function applyDataDirChange(mode: 'migrate' | 'load_existing' | 'reset_default', targetDir?: string) {
  dirBusy.value = true;
  try {
    const res = await desktopBridge.changeDataDir(mode, targetDir);
    if (!res.ok) {
      window.$message?.error(res.error || '更改数据存储路径失败');
      return;
    }
    dirConflictModalShow.value = false;
    pendingPickedDir.value = null;
    await listSnapshots();
    if (mode === 'load_existing') {
      window.$message?.success('已切换到目标数据目录并加载该目录已有数据（建议刷新页面以同步主题习惯）');
    } else if (mode === 'reset_default') {
      window.$message?.success('已迁移并恢复为默认数据存储目录');
    } else {
      window.$message?.success('数据、快照与偏好已完整迁移至新目录并生效');
    }
  } finally {
    dirBusy.value = false;
  }
}

async function handleOpenDataDir() {
  const ok = await desktopBridge.openDataDir();
  if (!ok) {
    window.$message?.info('纯网页模式下数据保存在浏览器 IndexedDB 中，桌面端支持直接打开本机数据目录');
  }
}

// ---------------- 默认打开方式（桌面端 / 浏览器） ----------------
const runtimeStatusLabel = computed(() => {
  if (desktopBridge.runtimeMode.value === 'tauri-desktop') {
    return bi('桌面端窗口（已开启本机同步）', 'Desktop App (Local Sync Active)');
  }
  if (desktopBridge.runtimeMode.value === 'tauri-browser') {
    return bi('浏览器模式（已连接桌面端实时同步）', 'Browser Mode (Synced with Desktop)');
  }
  return bi('纯网页模式（桌面安装包支持与浏览器无缝双向同步）', 'Standalone Web Mode');
});

const browserSelectOptions = computed(() =>
  desktopBridge.installedBrowsers.value.map(b => ({ label: b.name, value: b.id }))
);

async function handleOpenModeChange(mode: OpenModePref) {
  await desktopBridge.setDefaultOpenMode(mode);
  window.$message?.success(
    mode === 'browser' ? '默认打开方式已设为「浏览器」（下次启动桌面端生效）' : '默认打开方式已设为「桌面端」'
  );
}

async function handlePreferredBrowserChange(browserId: string) {
  await desktopBridge.setPreferredBrowser(browserId);
  const label = desktopBridge.installedBrowsers.value.find(b => b.id === browserId)?.name ?? '系统默认浏览器';
  window.$message?.success(`已将默认浏览器设为「${label}」`);
}

const closeMinimizeLabel = computed(() =>
  isMacPlatform ? bi('收起至程序坞', 'Hide to Dock') : bi('最小化到任务栏', 'Minimize to Taskbar')
);

async function handleCloseBehaviorChange(behavior: CloseBehaviorPref) {
  await desktopBridge.setCloseBehavior(behavior);
  const labelMap: Record<CloseBehaviorPref, string> = {
    ask: '每次点击关闭时询问',
    minimize: isMacPlatform ? '仅关闭窗口（收起至程序坞）' : '仅关闭窗口（最小化到任务栏）',
    exit: '直接退出软件'
  };
  window.$message?.success(`关闭窗口行为已设为「${labelMap[behavior]}」`);
}

async function copyBridgeUrl() {
  const url = desktopBridge.bridgeUrl.value;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(`${url}/`);
    window.$message?.success(`已复制本机访问地址：${url}/`);
  } catch {
    window.$message?.info(`本机访问地址：${url}/`);
  }
}

// ---------------- 支部名称设置 ----------------
const branchNameInput = ref('');
watch(
  () => workStore.branchName,
  val => {
    branchNameInput.value = val;
  },
  { immediate: true }
);

async function saveBranchNameSetting() {
  const clean = branchNameInput.value.trim();
  if (!clean) {
    window.$message?.warning('请输入党支部名称');
    return;
  }
  await workStore.setBranchName(clean);
  window.$message?.success('党支部名称已保存');
}

// ---------------- 专属格式 .sctpack 按模块勾选导出 & 交接文档 ----------------
const handoverBusy = ref(false);
const exportModalShow = ref(false);
const exportMode = ref<'backup' | 'handover'>('handover');
const exportCategories = ref<ExportCategoryKey[]>(['core', 'library']);
const exportUsePassphrase = ref(false);
const exportPassphrase = ref('');
const exportPassphraseConfirm = ref('');
const exportingPack = ref(false);

const EXPORT_CATEGORY_OPTIONS: Array<{
  key: ExportCategoryKey;
  title: string;
  desc: string;
}> = [
  {
    key: 'core',
    title: '核心党务台账',
    desc: '人员档案、党员发展、党费收缴、谈心谈话、党员积分与否决、三会一课/考勤、台历事件、党小组与团委席位'
  },
  {
    key: 'library',
    title: '材料库、资料库与流程图',
    desc: '内置与自定义材料模板、归档材料、知识库自定义条目、政策法规卡片与附件、学院版发展流程图'
  },
  {
    key: 'preferences',
    title: '个人界面与排版习惯',
    desc: '主题皮肤、深浅模式、界面密度、字号缩放、统计总览组件编排、表格列宽记忆、政治生日贺卡草稿'
  }
];

function openExportPackModal(mode: 'backup' | 'handover') {
  exportMode.value = mode;
  exportCategories.value = mode === 'backup' ? ['core', 'library', 'preferences'] : ['core', 'library'];
  exportUsePassphrase.value = false;
  exportPassphrase.value = '';
  exportPassphraseConfirm.value = '';
  exportModalShow.value = true;
}

async function confirmExportSctPack() {
  if (!exportCategories.value.length) {
    window.$message?.warning('请至少勾选一个要导出的模块分组');
    return;
  }
  if (exportUsePassphrase.value) {
    if (exportPassphrase.value.trim().length < 4) {
      window.$message?.warning('自定义交接口令至少需要 4 位字符');
      return;
    }
    if (exportPassphrase.value !== exportPassphraseConfirm.value) {
      window.$message?.warning('两次输入的交接口令不一致');
      return;
    }
  }
  exportingPack.value = true;
  try {
    const todayStr = dayjs().format('YYYY-MM-DD');
    const suggestedName =
      exportMode.value === 'handover' ? `三尺台交接包_${todayStr}.sctpack` : `三尺台备份_${todayStr}.sctpack`;
    const res = await saveFileWithPicker(
      async () => {
        const { bytes } = await exportSctPackBytes({
          categories: exportCategories.value,
          passphrase: exportUsePassphrase.value ? exportPassphrase.value : undefined
        });
        return new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' });
      },
      {
        suggestedName,
        types: [
          {
            description: '三尺台专属数据包 (.sctpack)',
            mime: 'application/octet-stream',
            extensions: ['.sctpack']
          }
        ]
      }
    );
    if (res.status === 'saved') {
      exportModalShow.value = false;
      window.$message?.success(
        exportUsePassphrase.value
          ? '专属加密数据包 (.sctpack) 已导出（已启用交接口令保护）'
          : '专属数据包 (.sctpack) 已加密封装导出'
      );
    }
  } catch (err) {
    window.$message?.error(`导出失败：${(err as Error).message}`);
  } finally {
    exportingPack.value = false;
  }
}

async function exportHandoverDoc() {
  handoverBusy.value = true;
  try {
    const res = await saveFileWithPicker(
      async () => {
        const shape = await exportBackup();
        const html = buildHandoverHtml(shape, workStore.branchName);
        return new Blob([html], { type: 'text/html;charset=utf-8' });
      },
      {
        suggestedName: `支部工作交接文档_${dayjs().format('YYYYMMDD')}.html`,
        types: [{ description: 'HTML 网页文档', mime: 'text/html', extensions: ['.html'] }]
      }
    );
    if (res.status === 'saved') {
      window.$message?.success('交接文档已导出（浏览器/Word 打开即可打印）');
    }
  } finally {
    handoverBusy.value = false;
  }
}

// ---------------- 统一导入流程（支持 .sctpack 与历史 .json + 口令解包 + 导入前预览） ----------------
const fileInput = ref<HTMLInputElement>();
const restoring = ref(false);
const pendingImportBytes = ref<Uint8Array | null>(null);
const pendingImportFilename = ref('');
const passphraseModalShow = ref(false);
const importPassphrase = ref('');
const passphraseError = ref('');

const importPreviewShow = ref(false);
const previewPayload = ref<SctPackPayload | null>(null);
const previewSummary = ref<SctPackSummary | null>(null);
const previewSelectedCats = ref<ExportCategoryKey[]>([]);
const applyingImport = ref(false);

function pickImportFile() {
  fileInput.value?.click();
}

async function processImportBytes(bytes: Uint8Array, passphrase?: string) {
  const result = await inspectImportBytes(bytes, passphrase);
  if (result.status === 'need-passphrase') {
    passphraseError.value = '';
    importPassphrase.value = '';
    passphraseModalShow.value = true;
    return;
  }
  if (result.status === 'wrong-passphrase') {
    passphraseError.value = result.message;
    passphraseModalShow.value = true;
    return;
  }
  if (result.status === 'invalid') {
    window.$message?.error(result.message);
    pendingImportBytes.value = null;
    return;
  }

  passphraseModalShow.value = false;
  previewPayload.value = result.payload;
  previewSummary.value = result.summary;
  previewSelectedCats.value = [...result.summary.categories];
  importPreviewShow.value = true;
}

async function handleFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  restoring.value = true;
  try {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    pendingImportBytes.value = bytes;
    pendingImportFilename.value = file.name;
    await processImportBytes(bytes);
  } catch (err) {
    window.$message?.error(`读取文件失败：${(err as Error).message}`);
  } finally {
    restoring.value = false;
    input.value = '';
  }
}

async function submitImportPassphrase() {
  if (!pendingImportBytes.value) return;
  if (!importPassphrase.value.trim()) {
    passphraseError.value = '请输入交接口令';
    return;
  }
  await processImportBytes(pendingImportBytes.value, importPassphrase.value);
}

async function confirmApplyImport() {
  if (!previewPayload.value || !previewSelectedCats.value.length) {
    window.$message?.warning('请至少勾选一个要导入的模块');
    return;
  }
  applyingImport.value = true;
  try {
    const { prefsApplied } = await applySctPackImport(previewPayload.value, previewSelectedCats.value);
    importPreviewShow.value = false;
    previewPayload.value = null;
    previewSummary.value = null;
    pendingImportBytes.value = null;
    await listSnapshots();
    if (prefsApplied > 0) {
      window.$message?.success('数据包已导入（含个人界面习惯，建议刷新页面以完整应用外观设置）');
    } else {
      window.$message?.success('数据包已精准导入（导入前已自动快照当前数据）');
    }
  } catch (err) {
    window.$message?.error(`导入失败：${(err as Error).message}`);
  } finally {
    applyingImport.value = false;
  }
}

// ---------------- 应用锁 ----------------
const lockSetupShow = ref(false);
const lockDisableShow = ref(false);
const lockPwdShow = ref(false);
const lockForm = reactive({
  pwd: '',
  confirm: '',
  question: LOCK_QUESTIONS[0],
  customQuestion: '',
  answer: '',
  idle: 0
});
const disablePwd = ref('');
const pwdForm = reactive({ old: '', new: '', confirm: '' });

const questionOptions = [
  ...LOCK_QUESTIONS.map(v => ({ label: v, value: v })),
  { label: '自定义问题…', value: '__custom__' }
];

const IDLE_OPTIONS = [
  { label: '不自动锁定', value: 0 },
  { label: '5 分钟无操作后锁定', value: 5 },
  { label: '15 分钟无操作后锁定', value: 15 },
  { label: '30 分钟无操作后锁定', value: 30 }
];

function toggleLock(enabled: boolean) {
  if (enabled) {
    Object.assign(lockForm, {
      pwd: '',
      confirm: '',
      question: LOCK_QUESTIONS[0],
      customQuestion: '',
      answer: '',
      idle: 0
    });
    lockSetupShow.value = true;
  } else {
    disablePwd.value = '';
    lockDisableShow.value = true;
  }
}

async function handleLockSetup() {
  if (lockForm.pwd !== lockForm.confirm) {
    window.$message?.warning('两次输入的密码不一致');
    return;
  }
  const q = lockForm.question === '__custom__' ? lockForm.customQuestion : lockForm.question;
  const ok = await appLock.enable(lockForm.pwd, q, lockForm.answer, lockForm.idle);
  if (ok) {
    lockSetupShow.value = false;
    window.$message?.success('应用锁已开启：重启或手动锁定后生效');
  }
}

async function handleLockDisable() {
  const ok = await appLock.disable(disablePwd.value);
  if (ok) {
    lockDisableShow.value = false;
    window.$message?.success('应用锁已关闭');
  }
}

async function handlePwdChange() {
  if (pwdForm.new !== pwdForm.confirm) {
    window.$message?.warning('两次输入的新密码不一致');
    return;
  }
  const ok = await appLock.changePassword(pwdForm.old, pwdForm.new);
  if (ok) {
    lockPwdShow.value = false;
    Object.assign(pwdForm, { old: '', new: '', confirm: '' });
    window.$message?.success('锁屏密码已修改');
  }
}

// ---------------- 快照（自动 10 份 + 手动 10 份独立环形，桌面端同步落盘） ----------------
interface SnapItem {
  key: string;
  kind: 'auto' | 'manual';
  ts: string;
  counts: string;
}
const autoSnapshots = ref<SnapItem[]>([]);
const manualSnapshots = ref<SnapItem[]>([]);

function toSnapItem(r: Awaited<ReturnType<typeof listBackupRing>>[number]): SnapItem {
  const ptsCount = r.shape.point_records?.length ?? 0;
  return {
    key: r.key,
    kind: r.kind,
    ts: r.ts,
    counts: `人员 ${r.shape.members?.length ?? 0} · 事项 ${r.shape.cal_events?.length ?? 0} · 党费 ${r.shape.fee_records?.length ?? 0}${ptsCount ? ` · 积分 ${ptsCount}` : ''}`
  };
}

async function listSnapshots() {
  const [autoRing, manualRing] = await Promise.all([listBackupRing('auto'), listBackupRing('manual')]);
  autoSnapshots.value = autoRing.map(toSnapItem);
  manualSnapshots.value = manualRing.map(toSnapItem);
  void desktopBridge.refreshDataDirInfo();
}

async function createManualSnapshot() {
  await pushBackupRing('manual');
  await listSnapshots();
  window.$message?.success(`手动快照已创建（环形保留最近 ${BACKUP_RING_SIZE} 份）`);
}

async function restoreSnapshot(key: string) {
  const ring = await listBackupRing();
  const target = ring.find(r => r.key === key);
  if (!target) return;
  await importBackup(target.shape);
  await listSnapshots();
  window.$message?.success('已恢复所选快照（恢复前已自动快照当前数据）');
}

const deleteSnapModalShow = ref(false);
const pendingDeleteSnap = ref<SnapItem | null>(null);
const deletingSnap = ref(false);

function openDeleteSnapshotConfirm(item: SnapItem) {
  pendingDeleteSnap.value = item;
  deleteSnapModalShow.value = true;
}

async function confirmDeleteSnapshot() {
  if (!pendingDeleteSnap.value) return;
  deletingSnap.value = true;
  try {
    await deleteBackupSnapshot(pendingDeleteSnap.value.key);
    deleteSnapModalShow.value = false;
    pendingDeleteSnap.value = null;
    await listSnapshots();
    window.$message?.success('快照已删除');
  } finally {
    deletingSnap.value = false;
  }
}

// ---------------- 演示数据（严格二次确认） ----------------
const DANGER_CONFIRM_PHRASE = '我已知晓该操作危险性，确认清除全部数据';
const dangerModalShow = ref(false);
const dangerAction = ref<'reset' | 'clear' | null>(null);
const dangerInput = ref('');
const dangerBusy = ref(false);
const resetting = ref(false);

const canConfirmDanger = computed(() => dangerInput.value.trim() === DANGER_CONFIRM_PHRASE);

function openDangerConfirm(action: 'reset' | 'clear') {
  dangerAction.value = action;
  dangerInput.value = '';
  dangerModalShow.value = true;
}

async function confirmDangerAction() {
  if (!canConfirmDanger.value || !dangerAction.value) return;
  dangerBusy.value = true;
  try {
    if (dangerAction.value === 'reset') {
      resetting.value = true;
      await resetToSeed();
      await db.meta.delete('academy-flow');
      window.$message?.success('已重置为演示种子数据');
    } else {
      await clearAllData();
      window.$message?.success('业务数据已清空（本地备份快照与 6 套内置材料模板已保留）');
    }
    dangerModalShow.value = false;
    dangerAction.value = null;
    dangerInput.value = '';
    await listSnapshots();
  } finally {
    resetting.value = false;
    dangerBusy.value = false;
  }
}

onMounted(listSnapshots);
</script>

<template>
  <div class="grid grid-cols-1 items-start gap-14px xl:grid-cols-12">
    <!-- 左栏（7/12 宽）：备份与恢复（10+10 快照） + 数据存储路径 + 「一键交接 / 演示数据」 -->
    <div class="flex flex-col gap-14px xl:col-span-7">
      <!-- 备份与恢复 -->
      <NCard :bordered="false">
        <template #header>
          <div class="flex items-center gap-8px">
            <SvgIcon icon="lucide:hard-drive-download" class="text-17px text-[#A81C24]" />
            <span class="font-bold">{{ bi('备份与恢复', 'Backup & Restore') }}</span>
            <NTag size="tiny" type="error" :bordered="false" round>.sctpack 加密封装</NTag>
          </div>
        </template>
        <template #header-extra>
          <NButton size="tiny" secondary @click="listSnapshots">
            <template #icon><SvgIcon icon="lucide:refresh-cw" /></template>
            {{ bi('刷新快照', 'Refresh') }}
          </NButton>
        </template>

        <NSpace vertical size="medium">
          <div class="flex flex-wrap items-center gap-8px">
            <NButton type="primary" size="small" @click="openExportPackModal('backup')">
              <template #icon><SvgIcon icon="lucide:download" /></template>
              {{ bi('导出数据包 (.sctpack)', 'Export .sctpack') }}
            </NButton>
            <NButton :loading="restoring" size="small" type="info" secondary @click="pickImportFile">
              <template #icon><SvgIcon icon="lucide:upload" /></template>
              {{ bi('导入数据包 / 恢复备份…', 'Import / Restore…') }}
            </NButton>
            <NButton size="small" secondary type="primary" @click="createManualSnapshot">
              <template #icon><SvgIcon icon="lucide:camera" /></template>
              {{ bi('创建手动快照', 'Save Manual Snapshot') }}
            </NButton>
            <input
              ref="fileInput"
              type="file"
              accept=".sctpack,.json,application/json,application/octet-stream"
              class="hidden"
              @change="handleFileChange"
            />
          </div>

          <!-- 自动快照（10 份）｜ 手动快照（10 份）左右双栏 -->
          <div class="grid grid-cols-1 gap-12px pt-2px md:grid-cols-2">
            <!-- 左：自动快照 -->
            <div class="rounded-10px border border-[var(--sct-border)] p-10px">
              <div
                class="mb-8px flex items-center justify-between gap-6px border-b border-dashed border-[var(--sct-border)] pb-6px"
              >
                <span class="flex items-center gap-5px text-12px font-bold text-[var(--sct-ink)]">
                  <SvgIcon icon="lucide:history" class="text-14px text-[#2563eb]" />
                  <span>
                    {{ bi(`自动快照（保留 ${BACKUP_RING_SIZE} 份）`, `Auto Snapshots (${BACKUP_RING_SIZE})`) }}
                  </span>
                </span>
                <NTag size="tiny" :bordered="false" round>{{ autoSnapshots.length }} / {{ BACKUP_RING_SIZE }}</NTag>
              </div>
              <div v-if="!autoSnapshots.length" class="py-12px text-center text-12px text-gray-400">
                {{ bi('暂无自动快照（导入/恢复前自动生成）', 'No auto snapshots yet') }}
              </div>
              <div v-else class="max-h-290px flex flex-col gap-6px overflow-y-auto pr-2px">
                <div
                  v-for="s in autoSnapshots"
                  :key="s.key"
                  class="flex items-center justify-between gap-6px rounded-8px bg-[var(--sct-soft)] px-9px py-7px"
                >
                  <div class="min-w-0">
                    <div class="text-12px font-bold font-mono">{{ s.ts.replace('T', ' ').slice(0, 19) }}</div>
                    <div class="truncate text-11px text-gray-500">{{ s.counts }}</div>
                  </div>
                  <div class="flex shrink-0 items-center gap-4px">
                    <NButton size="tiny" secondary type="primary" @click="restoreSnapshot(s.key)">
                      {{ bi('恢复', 'Restore') }}
                    </NButton>
                    <NButton size="tiny" quaternary type="error" @click="openDeleteSnapshotConfirm(s)">
                      <template #icon><SvgIcon icon="lucide:trash-2" class="text-12px" /></template>
                    </NButton>
                  </div>
                </div>
              </div>
            </div>

            <!-- 右：手动快照 -->
            <div class="rounded-10px border border-[var(--sct-border)] p-10px">
              <div
                class="mb-8px flex items-center justify-between gap-6px border-b border-dashed border-[var(--sct-border)] pb-6px"
              >
                <span class="flex items-center gap-5px text-12px font-bold text-[var(--sct-ink)]">
                  <SvgIcon icon="lucide:bookmark-check" class="text-14px text-[#16a34a]" />
                  <span>
                    {{ bi(`手动快照（保留 ${BACKUP_RING_SIZE} 份）`, `Manual Snapshots (${BACKUP_RING_SIZE})`) }}
                  </span>
                </span>
                <NTag size="tiny" :bordered="false" round>{{ manualSnapshots.length }} / {{ BACKUP_RING_SIZE }}</NTag>
              </div>
              <div v-if="!manualSnapshots.length" class="py-12px text-center text-12px text-gray-400">
                {{ bi('暂无手动快照（点上方「创建手动快照」保存）', 'No manual snapshots yet') }}
              </div>
              <div v-else class="max-h-290px flex flex-col gap-6px overflow-y-auto pr-2px">
                <div
                  v-for="s in manualSnapshots"
                  :key="s.key"
                  class="flex items-center justify-between gap-6px rounded-8px bg-[var(--sct-soft)] px-9px py-7px"
                >
                  <div class="min-w-0">
                    <div class="text-12px font-bold font-mono">{{ s.ts.replace('T', ' ').slice(0, 19) }}</div>
                    <div class="truncate text-11px text-gray-500">{{ s.counts }}</div>
                  </div>
                  <div class="flex shrink-0 items-center gap-4px">
                    <NButton size="tiny" secondary type="primary" @click="restoreSnapshot(s.key)">
                      {{ bi('恢复', 'Restore') }}
                    </NButton>
                    <NButton size="tiny" quaternary type="error" @click="openDeleteSnapshotConfirm(s)">
                      <template #icon><SvgIcon icon="lucide:trash-2" class="text-12px" /></template>
                    </NButton>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </NSpace>
      </NCard>

      <!-- 数据存储路径（桌面端可自定义目录，自动迁移业务数据、20 份快照与偏好设置） -->
      <NCard :bordered="false">
        <template #header>
          <div class="flex items-center gap-8px">
            <SvgIcon icon="lucide:folder-cog" class="text-17px text-[#2563eb]" />
            <span class="font-bold">{{ bi('数据存储路径', 'Data Storage Location') }}</span>
            <NTag
              v-if="desktopBridge.dataDirInfo.value"
              size="tiny"
              :type="desktopBridge.dataDirInfo.value.isCustom ? 'success' : 'default'"
              :bordered="false"
              round
            >
              {{
                desktopBridge.dataDirInfo.value.isCustom ? bi('自定义目录', 'Custom') : bi('系统默认目录', 'Default')
              }}
            </NTag>
          </div>
        </template>
        <NSpace vertical size="medium">
          <div
            v-if="isDesktopManaged && desktopBridge.dataDirInfo.value"
            class="rounded-8px border border-[var(--sct-border)] bg-[var(--sct-soft)] px-12px py-9px"
          >
            <div class="flex flex-wrap items-center justify-between gap-8px">
              <div class="min-w-0 flex-1">
                <div class="text-11px text-gray-400">{{ bi('当前数据目录', 'Active Data Folder') }}</div>
                <div class="mt-2px break-all font-mono text-12px font-semibold text-[var(--sct-ink)]">
                  {{ desktopBridge.dataDirInfo.value.currentDir }}
                </div>
              </div>
              <div class="flex shrink-0 flex-wrap gap-6px">
                <NButton size="tiny" type="primary" :loading="dirBusy" @click="handlePickDataDir">
                  <template #icon><SvgIcon icon="lucide:folder-input" /></template>
                  {{ bi('更改存储路径…', 'Change Folder…') }}
                </NButton>
                <NButton size="tiny" secondary @click="handleOpenDataDir">
                  <template #icon><SvgIcon icon="lucide:folder-open" /></template>
                  {{ bi('打开文件夹', 'Open Folder') }}
                </NButton>
                <NPopconfirm
                  v-if="desktopBridge.dataDirInfo.value.isCustom"
                  @positive-click="applyDataDirChange('reset_default')"
                >
                  <template #trigger>
                    <NButton size="tiny" quaternary>
                      {{ bi('恢复默认路径', 'Reset Default') }}
                    </NButton>
                  </template>
                  确认将数据迁移回系统默认目录？
                </NPopconfirm>
              </div>
            </div>
            <div class="mt-6px flex flex-wrap gap-12px text-11px text-gray-500">
              <span>磁盘自动快照：{{ desktopBridge.dataDirInfo.value.autoSnapshotCount }} 份</span>
              <span>磁盘手动快照：{{ desktopBridge.dataDirInfo.value.manualSnapshotCount }} 份</span>
              <span>升级保护快照：{{ desktopBridge.dataDirInfo.value.protectedSnapshotCount }} 份</span>
            </div>
          </div>
          <NAlert v-else type="info" :show-icon="false">
            {{ bi('网页模式下暂不支持更改本地目录，请使用桌面端。', 'Custom folder requires desktop app.') }}
          </NAlert>
        </NSpace>
      </NCard>

      <!-- 左栏下方：一键交接 + 演示数据 并排双列 -->
      <div class="grid grid-cols-1 gap-14px md:grid-cols-2">
        <!-- 一键交接 -->
        <NCard :bordered="false" class="h-full">
          <template #header>
            <div class="flex items-center gap-8px">
              <SvgIcon icon="lucide:package-check" class="text-17px text-[#A81C24]" />
              <span class="font-bold">{{ bi('一键交接', 'One-Click Handover') }}</span>
            </div>
          </template>
          <div class="flex flex-wrap gap-8px">
            <NButton type="primary" size="small" :loading="exportingPack" @click="openExportPackModal('handover')">
              <template #icon><SvgIcon icon="lucide:package" /></template>
              {{ bi('导出交接包', 'Export Handover') }}
            </NButton>
            <NButton size="small" type="info" secondary :loading="restoring" @click="pickImportFile">
              <template #icon><SvgIcon icon="lucide:package-open" /></template>
              {{ bi('导入交接包…', 'Import Handover…') }}
            </NButton>
            <NButton size="small" secondary :loading="handoverBusy" @click="exportHandoverDoc">
              <template #icon><SvgIcon icon="lucide:printer" /></template>
              {{ bi('生成交接文档', 'Handover Doc') }}
            </NButton>
          </div>
        </NCard>

        <!-- 演示数据 -->
        <NCard :bordered="false" class="h-full">
          <template #header>
            <div class="flex items-center gap-8px">
              <SvgIcon icon="lucide:database-backup" class="text-17px text-[#d97706]" />
              <span class="font-bold">{{ bi('演示数据', 'Demo Seed Data') }}</span>
            </div>
          </template>
          <div class="flex flex-wrap gap-8px">
            <NButton size="small" secondary :loading="resetting" @click="openDangerConfirm('reset')">
              <template #icon><SvgIcon icon="lucide:rotate-ccw" /></template>
              {{ bi('重置为演示种子', 'Reset Demo') }}
            </NButton>
            <NButton size="small" type="error" ghost @click="openDangerConfirm('clear')">
              <template #icon><SvgIcon icon="lucide:trash-2" /></template>
              {{ bi('清空业务数据', 'Clear All') }}
            </NButton>
          </div>
        </NCard>
      </div>
    </div>

    <!-- 右栏（5/12 宽）：「支部信息 + 应用锁」 + 「界面密度与缩放」 + 「窗口与打开方式」 + 「关于与自动更新」 -->
    <div class="flex flex-col gap-14px xl:col-span-5">
      <div class="grid grid-cols-1 gap-14px md:grid-cols-2">
        <!-- 支部基本信息 -->
        <NCard :bordered="false" class="h-full">
          <template #header>
            <div class="flex items-center gap-8px">
              <SvgIcon icon="lucide:landmark" class="text-17px text-[#A81C24]" />
              <span class="font-bold">{{ bi('支部基本信息', 'Branch Profile') }}</span>
            </div>
          </template>
          <div class="flex flex-col gap-8px">
            <NInput
              v-model:value="branchNameInput"
              size="small"
              :placeholder="bi('党支部全称…', 'Branch name…')"
              maxlength="40"
              @keyup.enter="saveBranchNameSetting"
            />
            <div class="flex justify-end">
              <NButton type="primary" size="tiny" @click="saveBranchNameSetting">
                <template #icon><SvgIcon icon="lucide:check" /></template>
                {{ bi('保存名称', 'Save Name') }}
              </NButton>
            </div>
          </div>
        </NCard>

        <!-- 应用锁 -->
        <NCard :bordered="false" class="h-full">
          <template #header>
            <div class="flex items-center gap-8px">
              <SvgIcon icon="lucide:shield-check" class="text-17px text-[#2563eb]" />
              <span class="font-bold">{{ bi('应用锁', 'App Lock') }}</span>
            </div>
          </template>
          <template #header-extra>
            <NSwitch :value="appLock.enabled" size="small" @update:value="toggleLock" />
          </template>
          <NSpace v-if="appLock.enabled" vertical size="small">
            <NSelect
              :value="appLock.idleMinutes"
              :options="IDLE_OPTIONS"
              size="small"
              @update:value="v => appLock.setIdleMinutes(v)"
            />
            <div class="flex flex-wrap gap-6px">
              <NButton size="tiny" secondary @click="lockPwdShow = true">
                <template #icon><SvgIcon icon="lucide:key-round" /></template>
                {{ bi('改密码', 'Password') }}
              </NButton>
              <NButton size="tiny" type="primary" @click="appLock.lock()">
                <template #icon><SvgIcon icon="lucide:lock" /></template>
                {{ bi('立即锁定', 'Lock') }}
              </NButton>
            </div>
          </NSpace>
          <div v-else class="flex items-center gap-6px text-13px text-[var(--sct-muted)]">
            <SvgIcon icon="lucide:lock-open" class="text-14px" />
            <span>{{ bi('未启用', 'Disabled') }}</span>
          </div>
        </NCard>
      </div>

      <!-- 界面密度与字号缩放（与右侧主题抽屉双向同步） -->
      <NCard :bordered="false">
        <template #header>
          <div class="flex items-center gap-8px">
            <SvgIcon icon="lucide:sliders-horizontal" class="text-17px text-[#A81C24]" />
            <span class="font-bold">{{ bi('界面密度与缩放', 'Density & Scaling') }}</span>
          </div>
        </template>
        <NSpace vertical size="medium">
          <div class="flex flex-wrap items-center justify-between gap-8px">
            <div class="text-13px font-medium">{{ bi('界面密度', 'Interface Density') }}</div>
            <NRadioGroup :value="themeStore.density" size="small" @update:value="handleDensityChange">
              <NRadioButton v-for="opt in DENSITY_OPTIONS" :key="opt.value" :value="opt.value">
                {{ bi(opt.zh, opt.en) }}
              </NRadioButton>
            </NRadioGroup>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-10px">
            <div class="text-13px font-medium">{{ bi('全局字号缩放', 'Global Font Scale') }}</div>
            <div class="flex items-center gap-8px">
              <div class="w-130px">
                <NSlider v-model:value="themeStore.fontConfig.scale" :min="85" :max="150" :step="5" />
              </div>
              <span class="w-42px text-right font-mono text-12px font-bold">{{ themeStore.fontConfig.scale }}%</span>
              <NButton
                v-if="themeStore.fontConfig.scale !== 100"
                size="tiny"
                quaternary
                @click="themeStore.fontConfig.scale = 100"
              >
                100%
              </NButton>
            </div>
          </div>
        </NSpace>
      </NCard>

      <!-- 窗口与打开方式 -->
      <NCard :bordered="false">
        <template #header>
          <div class="flex items-center gap-8px">
            <SvgIcon icon="lucide:app-window" class="text-17px text-[#A81C24]" />
            <span class="font-bold">{{ bi('窗口与打开方式', 'Window & Launch Mode') }}</span>
          </div>
        </template>
        <NSpace vertical size="medium">
          <div class="flex flex-wrap items-center justify-between gap-8px">
            <span class="text-13px font-medium">{{ bi('启动时默认使用', 'Launch Mode') }}</span>
            <NRadioGroup
              :value="desktopBridge.defaultOpenMode.value"
              size="small"
              @update:value="v => handleOpenModeChange(v as OpenModePref)"
            >
              <NRadioButton value="desktop">
                <span class="inline-flex items-center gap-4px">
                  <SvgIcon icon="lucide:monitor" class="text-13px" />
                  <span>{{ bi('桌面端', 'Desktop') }}</span>
                </span>
              </NRadioButton>
              <NRadioButton value="browser">
                <span class="inline-flex items-center gap-4px">
                  <SvgIcon icon="lucide:globe" class="text-13px" />
                  <span>{{ bi('浏览器', 'Browser') }}</span>
                </span>
              </NRadioButton>
            </NRadioGroup>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-8px">
            <span class="text-13px font-medium">{{ bi('指定打开浏览器', 'Preferred Browser') }}</span>
            <div class="w-196px">
              <NSelect
                :value="desktopBridge.preferredBrowser.value"
                :options="browserSelectOptions"
                size="small"
                @update:value="v => handlePreferredBrowserChange(String(v))"
              />
            </div>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-8px">
            <span class="text-13px font-medium">{{ bi('关闭窗口行为', 'Close Action') }}</span>
            <NRadioGroup
              :value="desktopBridge.closeBehavior.value"
              size="small"
              @update:value="v => handleCloseBehaviorChange(v as CloseBehaviorPref)"
            >
              <NRadioButton value="ask">{{ bi('每次询问', 'Ask') }}</NRadioButton>
              <NRadioButton value="minimize">{{ closeMinimizeLabel }}</NRadioButton>
              <NRadioButton value="exit">{{ bi('直接退出', 'Quit') }}</NRadioButton>
            </NRadioGroup>
          </div>
          <div
            class="flex flex-wrap items-center justify-between gap-8px rounded-8px bg-[var(--sct-soft)] px-10px py-7px text-12px text-gray-500"
          >
            <div class="flex flex-wrap items-center gap-6px">
              <span>
                {{ bi('运行环境：', 'Runtime: ') }}
                <strong>{{ runtimeStatusLabel }}</strong>
              </span>
              <NButton v-if="desktopBridge.bridgeUrl.value" size="tiny" text type="primary" @click="copyBridgeUrl">
                <template #icon><SvgIcon icon="lucide:copy" class="text-12px" /></template>
                {{ desktopBridge.bridgeUrl.value }}/
              </NButton>
            </div>
            <NButton
              v-if="desktopBridge.runtimeMode.value === 'tauri-browser'"
              size="tiny"
              type="primary"
              secondary
              @click="desktopBridge.returnToDesktopMode()"
            >
              <template #icon><SvgIcon icon="lucide:monitor" /></template>
              {{ bi('返回桌面端', 'Desktop') }}
            </NButton>
            <NButton v-else size="tiny" secondary @click="desktopBridge.openInBrowserMode()">
              <template #icon><SvgIcon icon="lucide:external-link" /></template>
              {{ bi('浏览器打开', 'Open Browser') }}
            </NButton>
          </div>
        </NSpace>
      </NCard>

      <!-- 关于三尺台与 GitHub Release 自动更新 -->
      <NCard :bordered="false">
        <template #header>
          <div class="flex items-center gap-8px">
            <SvgIcon icon="lucide:info" class="text-17px text-[#A81C24]" />
            <span class="font-bold">{{ bi('关于三尺台与软件更新', 'About & Auto Update') }}</span>
          </div>
        </template>
        <template #header-extra>
          <NButton
            size="tiny"
            type="primary"
            secondary
            :loading="updaterStore.checking"
            @click="updaterStore.checkForUpdates({ silent: false })"
          >
            <template #icon><SvgIcon icon="lucide:refresh-cw" /></template>
            {{ bi('检查更新', 'Check Update') }}
          </NButton>
        </template>
        <NSpace vertical size="small">
          <div class="rounded-8px border border-[var(--sct-border)] bg-[var(--sct-soft)] p-10px">
            <div class="flex flex-wrap items-center justify-between gap-8px">
              <div class="flex items-center gap-6px text-12px">
                <span class="font-semibold text-[var(--sct-ink)]">
                  {{ bi('启动时自动检测更新', 'Auto-check on Launch') }}
                </span>
                <NSwitch
                  :value="updaterStore.autoCheckEnabled"
                  size="small"
                  @update:value="v => updaterStore.setAutoCheckEnabled(v)"
                />
              </div>
              <div class="flex items-center gap-6px text-12px">
                <span class="text-gray-500">{{ bi('国内镜像加速', 'CN Mirror') }}</span>
                <NSwitch
                  :value="updaterStore.useMirror"
                  size="small"
                  @update:value="v => updaterStore.setUseMirror(v)"
                />
              </div>
            </div>
            <div
              v-if="updaterStore.hasAvailableUpdate || updaterStore.lastCheckedAt"
              class="mt-6px flex flex-wrap items-center justify-between gap-6px text-11px text-gray-500"
            >
              <span v-if="updaterStore.hasAvailableUpdate && updaterStore.release" class="font-semibold text-[#A81C24]">
                发现新版本 {{ updaterStore.release.latestVersion }}
              </span>
              <span v-else-if="updaterStore.lastCheckedAt">
                最近检查：{{ updaterStore.lastCheckedAt }} · 当前已是最新
              </span>
              <NButton
                v-if="updaterStore.hasAvailableUpdate"
                size="tiny"
                type="primary"
                @click="updaterStore.popupVisible = true"
              >
                打开更新弹窗
              </NButton>
            </div>
          </div>

          <NDescriptions :column="1" size="small" label-placement="left" bordered>
            <NDescriptionsItem :label="bi('版本', 'Version')">{{ APP_VERSION }}</NDescriptionsItem>
            <NDescriptionsItem :label="bi('开源技术栈', 'Open Source Stack')">
              Vue 3 · Naive UI · FullCalendar · ECharts · Dexie · Tauri
            </NDescriptionsItem>
          </NDescriptions>
        </NSpace>
      </NCard>
    </div>

    <!-- 导出专属数据包 (.sctpack) 选择模块与口令弹窗 -->
    <NModal
      v-model:show="exportModalShow"
      preset="card"
      :title="exportMode === 'handover' ? '导出工作交接包 (.sctpack)' : '导出数据备份 (.sctpack)'"
      class="w-540px"
      :mask-closable="false"
    >
      <div class="flex flex-col gap-12px">
        <div class="text-12px leading-relaxed text-gray-500">
          请选择需要打包导出的模块分组；文件将自动采用 AES-256-GCM 封装为 `.sctpack`
          专属格式，防止被文本编辑器直接窥视。
        </div>

        <NCheckboxGroup v-model:value="exportCategories" class="flex flex-col gap-8px">
          <div
            v-for="cat in EXPORT_CATEGORY_OPTIONS"
            :key="cat.key"
            class="rounded-8px border border-[var(--sct-border)] bg-[var(--sct-soft)] px-12px py-9px"
          >
            <NCheckbox :value="cat.key">
              <span class="text-13px font-bold text-[var(--sct-ink)]">{{ cat.title }}</span>
            </NCheckbox>
            <div class="mt-4px pl-22px text-11px leading-relaxed text-gray-500">{{ cat.desc }}</div>
          </div>
        </NCheckboxGroup>

        <div class="rounded-8px border border-[var(--sct-border)] p-10px">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-13px font-semibold text-[var(--sct-ink)]">设置额外交接口令（可选）</div>
              <div class="text-11px text-gray-400">
                开启后，接任人导入时必须输入正确口令才能解包；不开启则仅使用内置加密封装，导入免输密码。
              </div>
            </div>
            <NSwitch v-model:value="exportUsePassphrase" size="small" />
          </div>
          <div v-if="exportUsePassphrase" class="mt-10px grid grid-cols-1 gap-8px sm:grid-cols-2">
            <NInput
              v-model:value="exportPassphrase"
              type="password"
              show-password-on="mousedown"
              size="small"
              placeholder="输入交接口令（至少 4 位）"
            />
            <NInput
              v-model:value="exportPassphraseConfirm"
              type="password"
              show-password-on="mousedown"
              size="small"
              placeholder="再次确认口令"
            />
          </div>
        </div>
      </div>

      <template #footer>
        <div class="flex justify-end gap-8px">
          <NButton size="small" @click="exportModalShow = false">取消</NButton>
          <NButton
            size="small"
            type="primary"
            :loading="exportingPack"
            :disabled="!exportCategories.length"
            @click="confirmExportSctPack"
          >
            <template #icon><SvgIcon icon="lucide:download" /></template>
            导出 .sctpack 文件
          </NButton>
        </div>
      </template>
    </NModal>

    <!-- 导入交接口令弹窗 -->
    <NModal
      v-model:show="passphraseModalShow"
      preset="card"
      title="输入数据包交接口令"
      class="w-420px"
      :mask-closable="false"
    >
      <div class="flex flex-col gap-10px">
        <div class="text-12px text-gray-500">
          文件
          <strong>{{ pendingImportFilename }}</strong>
          启用了交接口令加密，请输入口令以校验并预览内容：
        </div>
        <NInput
          v-model:value="importPassphrase"
          type="password"
          show-password-on="mousedown"
          placeholder="请输入交接口令"
          @keyup.enter="submitImportPassphrase"
        />
        <div v-if="passphraseError" class="text-12px text-[#dc2626]">{{ passphraseError }}</div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-8px">
          <NButton size="small" @click="passphraseModalShow = false">取消</NButton>
          <NButton size="small" type="primary" @click="submitImportPassphrase">解密并预览</NButton>
        </div>
      </template>
    </NModal>

    <!-- 导入前内容预览与按模块精准替换弹窗 -->
    <NModal
      v-model:show="importPreviewShow"
      preset="card"
      title="导入预览 · 确认替换模块"
      class="w-540px"
      :mask-closable="false"
    >
      <div v-if="previewSummary" class="flex flex-col gap-12px">
        <NAlert v-if="previewSummary.isNewerSchema" type="warning" :show-icon="true">
          该数据包来自更高数据版本（Schema v{{
            previewSummary.schemaVersion
          }}），建议先升级三尺台后再导入，以免部分新字段丢失。
        </NAlert>
        <NDescriptions :column="2" size="small" label-placement="left" bordered>
          <NDescriptionsItem label="文件格式">{{ previewSummary.formatLabel }}</NDescriptionsItem>
          <NDescriptionsItem label="来源版本">{{ previewSummary.appVersion }}</NDescriptionsItem>
          <NDescriptionsItem label="支部名称">{{ previewSummary.branchName }}</NDescriptionsItem>
          <NDescriptionsItem label="导出时间">
            {{ previewSummary.exportedAt ? previewSummary.exportedAt.replace('T', ' ').slice(0, 19) : '—' }}
          </NDescriptionsItem>
        </NDescriptions>

        <div class="text-12px text-gray-500">
          勾选需要导入的模块（仅替换所选模块，未勾选模块保持本机现状；导入前会自动创建一份自动快照）：
        </div>
        <NCheckboxGroup v-model:value="previewSelectedCats" class="flex flex-col gap-8px">
          <div
            v-if="previewSummary.categories.includes('core')"
            class="rounded-8px border border-[var(--sct-border)] bg-[var(--sct-soft)] px-12px py-8px"
          >
            <NCheckbox value="core">
              <span class="font-bold">核心党务台账</span>
            </NCheckbox>
            <div class="mt-4px pl-22px text-11px text-gray-500">
              人员 {{ previewSummary.counts.members }} · 台历 {{ previewSummary.counts.calEvents }} · 党费
              {{ previewSummary.counts.feeRecords }} · 谈话 {{ previewSummary.counts.talks }} · 积分
              {{ previewSummary.counts.pointRecords }}
            </div>
          </div>
          <div
            v-if="previewSummary.categories.includes('library')"
            class="rounded-8px border border-[var(--sct-border)] bg-[var(--sct-soft)] px-12px py-8px"
          >
            <NCheckbox value="library">
              <span class="font-bold">材料库、资料库与流程图</span>
            </NCheckbox>
            <div class="mt-4px pl-22px text-11px text-gray-500">
              材料模板 {{ previewSummary.counts.docTemplates }} 套 · 归档文档 {{ previewSummary.counts.docs }} 份
            </div>
          </div>
          <div
            v-if="previewSummary.categories.includes('preferences')"
            class="rounded-8px border border-[var(--sct-border)] bg-[var(--sct-soft)] px-12px py-8px"
          >
            <NCheckbox value="preferences">
              <span class="font-bold">个人界面与排版习惯</span>
            </NCheckbox>
            <div class="mt-4px pl-22px text-11px text-gray-500">
              共 {{ previewSummary.counts.prefKeys }} 项主题/密度/缩放/看板与表格列宽配置
            </div>
          </div>
        </NCheckboxGroup>
      </div>
      <template #footer>
        <div class="flex justify-end gap-8px">
          <NButton size="small" @click="importPreviewShow = false">取消</NButton>
          <NButton
            size="small"
            type="primary"
            :loading="applyingImport"
            :disabled="!previewSelectedCats.length"
            @click="confirmApplyImport"
          >
            <template #icon><SvgIcon icon="lucide:check" /></template>
            确认导入所选模块
          </NButton>
        </div>
      </template>
    </NModal>

    <!-- 更改存储目录冲突处理弹窗（目标目录已有数据时让用户二选一） -->
    <NModal
      v-model:show="dirConflictModalShow"
      preset="card"
      title="目标目录已存在三尺台数据"
      class="w-500px"
      :mask-closable="false"
    >
      <div v-if="pendingPickedDir" class="flex flex-col gap-12px text-13px">
        <div class="rounded-8px bg-[var(--sct-soft)] p-10px">
          <div class="break-all font-mono text-12px font-bold text-[var(--sct-ink)]">{{ pendingPickedDir.path }}</div>
          <div class="mt-4px text-12px text-gray-500">
            支部：{{ pendingPickedDir.branchName || '未知' }} · 成员 {{ pendingPickedDir.memberCount }} 人 · 磁盘快照
            {{ pendingPickedDir.autoSnapshotCount + pendingPickedDir.manualSnapshotCount }} 份
          </div>
        </div>
        <div class="text-12px leading-relaxed text-gray-500">
          请选择如何处理该目录中的已有数据：
          <ul class="my-4px pl-18px">
            <li>
              <strong>加载目标目录已有数据</strong>
              ：直接切换并载入该目录中的台账（适合换机或连接网盘同步目录）。
            </li>
            <li>
              <strong>用当前数据迁移覆盖</strong>
              ：将本机当前数据迁入该目录（原目录旧文件会自动留存一份保护备份）。
            </li>
          </ul>
        </div>
      </div>
      <template #footer>
        <div class="flex flex-wrap justify-end gap-8px">
          <NButton size="small" @click="dirConflictModalShow = false">取消</NButton>
          <NButton
            size="small"
            type="warning"
            secondary
            :loading="dirBusy"
            @click="applyDataDirChange('migrate', pendingPickedDir?.path)"
          >
            用当前数据迁移覆盖
          </NButton>
          <NButton
            size="small"
            type="primary"
            :loading="dirBusy"
            @click="applyDataDirChange('load_existing', pendingPickedDir?.path)"
          >
            加载目标目录已有数据
          </NButton>
        </div>
      </template>
    </NModal>

    <!-- 应用锁：启用设置 -->
    <NModal v-model:show="lockSetupShow" preset="card" title="启用应用锁" class="w-480px" :mask-closable="false">
      <NForm label-placement="left" label-width="116" size="small">
        <NFormItem required>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:lock" class="sct-field-icon" />
              <span>锁屏密码</span>
            </span>
          </template>
          <NInput
            v-model:value="lockForm.pwd"
            type="password"
            show-password-on="mousedown"
            placeholder="至少 4 位"
            :maxlength="32"
          />
        </NFormItem>
        <NFormItem required>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:shield-check" class="sct-field-icon" />
              <span>确认密码</span>
            </span>
          </template>
          <NInput v-model:value="lockForm.confirm" type="password" show-password-on="mousedown" :maxlength="32" />
        </NFormItem>
        <NFormItem required>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:help-circle" class="sct-field-icon" />
              <span>找回问题</span>
            </span>
          </template>
          <NSelect v-model:value="lockForm.question" :options="questionOptions" />
        </NFormItem>
        <NFormItem v-if="lockForm.question === '__custom__'" required>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:edit-3" class="sct-field-icon" />
              <span>自定义问题</span>
            </span>
          </template>
          <NInput v-model:value="lockForm.customQuestion" placeholder="输入自定义问题" />
        </NFormItem>
        <NFormItem required>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:key" class="sct-field-icon" />
              <span>答案</span>
            </span>
          </template>
          <NInput v-model:value="lockForm.answer" placeholder="答案（不区分首尾空格）" />
        </NFormItem>
        <NFormItem>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:timer" class="sct-field-icon" />
              <span>闲置锁定</span>
            </span>
          </template>
          <NSelect v-model:value="lockForm.idle" :options="IDLE_OPTIONS" size="small" class="w-full" />
        </NFormItem>
      </NForm>
      <div class="text-11px text-gray-400">提示：应用锁为隐私遮挡；请牢记密保答案，忘记密码时可用其解锁。</div>
      <template #footer>
        <div class="flex justify-end gap-8px">
          <NButton @click="lockSetupShow = false">取消</NButton>
          <NButton type="primary" @click="handleLockSetup">启用</NButton>
        </div>
      </template>
    </NModal>

    <!-- 应用锁：关闭确认 -->
    <NModal v-model:show="lockDisableShow" preset="card" title="关闭应用锁" class="w-440px" :mask-closable="false">
      <NForm label-placement="left" label-width="116" size="small">
        <NFormItem required>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:lock" class="sct-field-icon" />
              <span>密码</span>
            </span>
          </template>
          <NInput
            v-model:value="disablePwd"
            type="password"
            show-password-on="mousedown"
            @keyup.enter="handleLockDisable"
          />
        </NFormItem>
      </NForm>
      <template #footer>
        <div class="flex justify-end gap-8px">
          <NButton @click="lockDisableShow = false">取消</NButton>
          <NButton type="primary" @click="handleLockDisable">确认关闭</NButton>
        </div>
      </template>
    </NModal>

    <!-- 应用锁：修改密码 -->
    <NModal v-model:show="lockPwdShow" preset="card" title="修改锁屏密码" class="w-460px" :mask-closable="false">
      <NForm label-placement="left" label-width="116" size="small">
        <NFormItem required>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:key-round" class="sct-field-icon" />
              <span>原密码</span>
            </span>
          </template>
          <NInput v-model:value="pwdForm.old" type="password" show-password-on="mousedown" />
        </NFormItem>
        <NFormItem required>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:lock" class="sct-field-icon" />
              <span>新密码</span>
            </span>
          </template>
          <NInput
            v-model:value="pwdForm.new"
            type="password"
            show-password-on="mousedown"
            placeholder="至少 4 位"
            :maxlength="32"
          />
        </NFormItem>
        <NFormItem required>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:shield-check" class="sct-field-icon" />
              <span>确认新密码</span>
            </span>
          </template>
          <NInput v-model:value="pwdForm.confirm" type="password" show-password-on="mousedown" :maxlength="32" />
        </NFormItem>
      </NForm>
      <template #footer>
        <div class="flex justify-end gap-8px">
          <NButton @click="lockPwdShow = false">取消</NButton>
          <NButton type="primary" @click="handlePwdChange">保存</NButton>
        </div>
      </template>
    </NModal>

    <!-- 快照删除：二次确认弹窗 -->
    <NModal
      v-model:show="deleteSnapModalShow"
      preset="card"
      :title="bi('确认删除快照', 'Confirm Snapshot Deletion')"
      class="w-440px"
      :mask-closable="false"
    >
      <div class="flex flex-col gap-10px text-13px leading-relaxed">
        <div>
          {{
            bi(
              '确定要永久删除以下本地快照吗？删除后将无法通过该快照恢复数据。',
              'Are you sure you want to permanently delete this local snapshot? This cannot be undone.'
            )
          }}
        </div>
        <div v-if="pendingDeleteSnap" class="rounded-8px bg-[var(--sct-soft)] px-12px py-10px">
          <div class="font-bold">{{ pendingDeleteSnap.ts.replace('T', ' ').slice(0, 19) }}</div>
          <div class="mt-2px text-12px text-gray-500">{{ pendingDeleteSnap.counts }}</div>
        </div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-8px">
          <NButton @click="deleteSnapModalShow = false">{{ bi('取消', 'Cancel') }}</NButton>
          <NButton type="error" :loading="deletingSnap" @click="confirmDeleteSnapshot">
            <template #icon><SvgIcon icon="lucide:trash-2" /></template>
            {{ bi('确认删除', 'Confirm Delete') }}
          </NButton>
        </div>
      </template>
    </NModal>

    <!-- 重置演示种子 / 清空业务数据：严格二次确认弹窗 -->
    <NModal
      v-model:show="dangerModalShow"
      preset="card"
      :title="
        dangerAction === 'reset'
          ? bi('危险操作确认：重置为演示种子', 'Dangerous Action: Reset to Demo Seed')
          : bi('危险操作确认：清空全部业务数据', 'Dangerous Action: Clear All Business Data')
      "
      class="w-520px"
      :mask-closable="false"
    >
      <div class="flex flex-col gap-12px text-13px leading-relaxed">
        <NAlert type="error" :show-icon="true">
          <template v-if="dangerAction === 'reset'">
            此操作将
            <strong>覆盖并清空当前全部业务数据</strong>
            ，还原为内置 22 人演示种子数据。若尚未导出 `.sctpack` 备份，当前录入的真实数据将无法找回。
          </template>
          <template v-else>
            此操作将
            <strong>永久清空当前全部成员、台历、三会一课、党员发展、党费、谈话与文档数据</strong>
            （保留本地备份快照与 6 套内置材料模板）。操作不可撤销！
          </template>
        </NAlert>
        <div class="text-12px text-gray-600">为防止误操作，请在下方输入框中完整输入以下确认文字：</div>
        <div
          class="select-all rounded-6px border border-red-200 bg-red-50/70 px-12px py-8px text-13px text-red-700 font-semibold dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
        >
          {{ DANGER_CONFIRM_PHRASE }}
        </div>
        <NInput
          v-model:value="dangerInput"
          :placeholder="`请输入：${DANGER_CONFIRM_PHRASE}`"
          clearable
          @keyup.enter="confirmDangerAction"
        />
      </div>
      <template #footer>
        <div class="flex justify-end gap-8px">
          <NButton @click="dangerModalShow = false">{{ bi('取消', 'Cancel') }}</NButton>
          <NButton type="error" :disabled="!canConfirmDanger" :loading="dangerBusy" @click="confirmDangerAction">
            <template #icon><SvgIcon icon="lucide:alert-triangle" /></template>
            {{ dangerAction === 'reset' ? bi('确认重置数据', 'Confirm Reset') : bi('确认清空数据', 'Confirm Clear') }}
          </NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>

<style scoped></style>

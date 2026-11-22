<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import dayjs from 'dayjs';
import { useDesktopBridge } from '@/utils/desktop-bridge';
import type { OpenModePref } from '@/utils/desktop-bridge';
import { buildHandoverHtml } from '@/utils/handover';
import { saveFileWithPicker } from '@/utils/save-file';
import { useAppLockStore, LOCK_QUESTIONS } from '@/store/modules/applock';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useSctI18n } from '@/hooks/common/sct-i18n';
import {
  clearAllData,
  db,
  deleteBackupSnapshot,
  exportBackup,
  importBackup,
  listBackupRing,
  pushBackupRing
} from '@/db/db';
import type { BackupShape } from '@/db/db';
import { resetToSeed } from '@/db/seed';

defineOptions({ name: 'SettingsPage' });

const appLock = useAppLockStore();
const workStore = useWorkDataStore();
const { bi } = useSctI18n();
const desktopBridge = useDesktopBridge();
const APP_VERSION = 'v0.2.4';

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

async function handleOpenModeChange(mode: OpenModePref) {
  await desktopBridge.setDefaultOpenMode(mode);
  window.$message?.success(
    mode === 'browser' ? '默认打开方式已设为「浏览器」（下次启动桌面端生效）' : '默认打开方式已设为「桌面端」'
  );
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

// ---------------- 一键交接包 ----------------
const handoverBusy = ref(false);

async function exportHandoverData() {
  handoverBusy.value = true;
  try {
    const res = await saveFileWithPicker(
      async () => {
        const shape = await exportBackup();
        return new Blob([JSON.stringify(shape, null, 2)], { type: 'application/json;charset=utf-8' });
      },
      {
        suggestedName: '交接数据包.json',
        types: [{ description: 'JSON 数据文件', mime: 'application/json', extensions: ['.json'] }]
      }
    );
    if (res.status === 'saved') {
      window.$message?.success('交接数据包已导出（接任人通过「从备份恢复」导入）');
    }
  } finally {
    handoverBusy.value = false;
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

// ---------------- 一键备份 / 恢复（A20） ----------------
async function handleExport() {
  const res = await saveFileWithPicker(
    async () => {
      const shape = await exportBackup();
      const json = JSON.stringify(shape, null, 2);
      return new Blob([json], { type: 'application/json;charset=utf-8' });
    },
    {
      suggestedName: `三尺台备份_${new Date().toISOString().slice(0, 10)}.json`,
      types: [{ description: 'JSON 备份文件', mime: 'application/json', extensions: ['.json'] }]
    }
  );
  if (res.status === 'saved') {
    window.$message?.success('备份已导出（含成员/台历/台账/谈话/文档全部数据）');
  }
}

const fileInput = ref<HTMLInputElement>();
const restoring = ref(false);

function pickFile() {
  fileInput.value?.click();
}

async function handleFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  restoring.value = true;
  try {
    const text = await file.text();
    const shape = JSON.parse(text) as BackupShape;
    if (!shape || typeof shape !== 'object' || !Array.isArray(shape.members)) {
      throw new Error('格式不符：缺少 members 字段');
    }
    await importBackup(shape);
    window.$message?.success('备份已恢复（恢复前已自动快照当前数据）');
    listSnapshots();
  } catch (err) {
    window.$message?.error(`恢复失败：${(err as Error).message}`);
  } finally {
    restoring.value = false;
    input.value = '';
  }
}

// ---------------- 快照 ----------------
interface SnapItem {
  key: string;
  ts: string;
  counts: string;
}
const snapshots = ref<SnapItem[]>([]);

async function listSnapshots() {
  const ring = await listBackupRing();
  snapshots.value = ring.map(r => ({
    key: r.key,
    ts: r.ts,
    counts: `人员 ${r.shape.members?.length ?? 0} · 事项 ${r.shape.cal_events?.length ?? 0} · 党费 ${r.shape.fee_records?.length ?? 0}`
  }));
}

async function createSnapshot() {
  await pushBackupRing();
  await listSnapshots();
  window.$message?.success('快照已创建（环形保留最近 5 份）');
}

async function restoreSnapshot(key: string) {
  const ring = await listBackupRing();
  const target = ring.find(r => r.key === key);
  if (!target) return;
  await importBackup(target.shape);
  await listSnapshots();
  window.$message?.success('已恢复所选快照');
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
      await db.meta.delete('academy-flow'); // 学院版自定义节点一并还原
      window.$message?.success('已重置为演示种子数据');
    } else {
      await clearAllData();
      window.$message?.success('业务数据已清空（本地备份快照保留）');
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
  <div class="grid grid-cols-1 gap-14px lg:grid-cols-2">
    <!-- 备份与恢复 -->
    <NCard :bordered="false" :title="bi('备份与恢复', 'Backup & Restore')">
      <NSpace vertical size="large">
        <div class="text-13px leading-relaxed text-gray-500">
          {{
            bi(
              '数据 100% 存于本机浏览器（IndexedDB）。换机/重装前请导出备份文件；导入备份会先自动快照当前数据，可随时回退。',
              'Data is 100% stored locally in browser IndexedDB. Export a JSON backup before migrating; importing automatically creates a snapshot first.'
            )
          }}
        </div>
        <div class="flex gap-8px">
          <NButton type="primary" @click="handleExport">
            <template #icon><SvgIcon icon="lucide:download" /></template>
            {{ bi('一键备份（导出 JSON）', 'One-Click Backup (Export JSON)') }}
          </NButton>
          <NButton :loading="restoring" secondary @click="pickFile">
            <template #icon><SvgIcon icon="lucide:upload" /></template>
            {{ bi('从备份恢复…', 'Restore from Backup…') }}
          </NButton>
          <input
            ref="fileInput"
            type="file"
            accept=".json,application/json"
            class="hidden"
            @change="handleFileChange"
          />
        </div>

        <NDivider title-placement="left" style="font-size: 13px">
          {{ bi('自动快照（环形 5 份）', 'Auto Snapshots (Ring of 5)') }}
        </NDivider>
        <div class="flex items-center gap-8px">
          <NButton size="small" secondary @click="createSnapshot">
            <template #icon><SvgIcon icon="lucide:camera" /></template>
            {{ bi('创建快照', 'Create Snapshot') }}
          </NButton>
          <NButton size="small" secondary @click="listSnapshots">
            <template #icon><SvgIcon icon="lucide:refresh-cw" /></template>
            {{ bi('刷新', 'Refresh') }}
          </NButton>
        </div>
        <div v-if="!snapshots.length" class="text-12px text-gray-400">{{ bi('暂无快照', 'No snapshots yet') }}</div>
        <div
          v-for="s in snapshots"
          :key="s.key"
          class="flex items-center justify-between gap-8px rounded-8px bg-[var(--sct-soft)] px-10px py-8px"
        >
          <div class="min-w-0">
            <div class="text-13px font-bold">{{ s.ts.replace('T', ' ').slice(0, 19) }}</div>
            <div class="text-11px text-gray-500">{{ s.counts }}</div>
          </div>
          <div class="flex shrink-0 items-center gap-6px">
            <NButton size="tiny" secondary type="primary" @click="restoreSnapshot(s.key)">
              <template #icon><SvgIcon icon="lucide:rotate-ccw" /></template>
              {{ bi('恢复此快照', 'Restore') }}
            </NButton>
            <NButton size="tiny" secondary type="error" @click="openDeleteSnapshotConfirm(s)">
              <template #icon><SvgIcon icon="lucide:trash-2" /></template>
              {{ bi('删除', 'Delete') }}
            </NButton>
          </div>
        </div>
      </NSpace>
    </NCard>

    <div class="flex flex-col gap-14px">
      <!-- 支部基本信息 -->
      <NCard :bordered="false" :title="bi('支部基本信息', 'Party Branch Profile')">
        <NSpace vertical size="medium">
          <div class="text-13px leading-relaxed text-gray-500">
            {{
              bi(
                '设置本工作台所属党支部名称。修改后将实时显示在顶栏右上角，并同步应用到交接文档、签到表及政治生日贺卡落款。',
                'Set the current Party Branch name. Displayed in the top header and synced to handover docs, sign-in sheets, and birthday cards.'
              )
            }}
          </div>
          <div class="flex items-center gap-8px">
            <NInput
              v-model:value="branchNameInput"
              :placeholder="bi('请输入党支部全称，如：计算机学院第一研究生党支部', 'Enter full Party Branch name…')"
              maxlength="40"
              @keyup.enter="saveBranchNameSetting"
            />
            <NButton type="primary" @click="saveBranchNameSetting">
              <template #icon><SvgIcon icon="lucide:check" /></template>
              {{ bi('保存名称', 'Save Name') }}
            </NButton>
          </div>
        </NSpace>
      </NCard>

      <!-- 默认打开方式 -->
      <NCard :bordered="false" :title="bi('默认打开方式', 'Default Open Mode')">
        <NSpace vertical size="medium">
          <div class="text-13px leading-relaxed text-gray-500">
            {{
              bi(
                '桌面安装包内置仅本机 127.0.0.1 同步服务：选择「桌面端」启动时弹出独立窗口；选择「浏览器」启动时自动在系统默认浏览器打开，且桌面端与浏览器始终读写同一份本机数据。',
                'Desktop app includes a loopback-only 127.0.0.1 bridge: choose Desktop or Browser as default launch mode with real-time local data sync.'
              )
            }}
          </div>
          <div class="flex flex-wrap items-center justify-between gap-10px">
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
          <div
            class="flex flex-wrap items-center justify-between gap-8px rounded-8px bg-[var(--sct-soft)] px-10px py-7px text-12px text-gray-500"
          >
            <span>
              {{ bi('当前运行环境：', 'Current Runtime: ') }}
              <strong>{{ runtimeStatusLabel }}</strong>
            </span>
            <NButton
              v-if="desktopBridge.runtimeMode.value === 'tauri-browser'"
              size="tiny"
              type="primary"
              secondary
              @click="desktopBridge.returnToDesktopMode()"
            >
              <template #icon><SvgIcon icon="lucide:monitor" /></template>
              {{ bi('返回桌面端', 'Return to Desktop') }}
            </NButton>
            <NButton v-else size="tiny" secondary @click="desktopBridge.openInBrowserMode()">
              <template #icon><SvgIcon icon="lucide:external-link" /></template>
              {{ bi('在浏览器中打开', 'Open in Browser') }}
            </NButton>
          </div>
        </NSpace>
      </NCard>

      <!-- 一键交接 -->
      <NCard :bordered="false" :title="bi('一键交接', 'One-Click Handover')">
        <NSpace vertical size="large">
          <div class="text-13px leading-relaxed text-gray-500">
            {{
              bi(
                '离任交接两件套：①「交接数据包」= 全量台账 JSON，接任人导入即接续；②「交接文档」= 自动生成的可打印文档（任期大事记 / 待办 / 发展节点 / 党费欠缴 / 台账摘要 / 交接说明）。',
                'Term handover kit: 1) Full Ledger JSON Data Package; 2) Printable HTML Handover Document (events, pending milestones, dues summary & notes).'
              )
            }}
          </div>
          <div class="flex gap-8px">
            <NButton type="primary" size="small" :loading="handoverBusy" @click="exportHandoverData">
              <template #icon><SvgIcon icon="lucide:package" /></template>
              {{ bi('导出交接数据包', 'Export Handover Data') }}
            </NButton>
            <NButton size="small" secondary :loading="handoverBusy" @click="exportHandoverDoc">
              <template #icon><SvgIcon icon="lucide:printer" /></template>
              {{ bi('生成交接文档', 'Generate Handover Doc') }}
            </NButton>
          </div>
        </NSpace>
      </NCard>

      <!-- 应用锁 -->
      <NCard :bordered="false" :title="bi('应用锁', 'App Lock')">
        <NSpace vertical size="large">
          <div class="text-13px leading-relaxed text-gray-500">
            {{
              bi(
                '启用后，启动工作台需输入密码；页眉可随时手动锁定，支持闲置自动锁定与密保答案找回。密码仅在本机存哈希，用于隐私遮挡。',
                'When enabled, requires password on startup or manual lock from header, with idle auto-lock and security question recovery.'
              )
            }}
          </div>
          <div class="flex items-center justify-between">
            <span class="text-13px">{{ bi('启用应用锁', 'Enable App Lock') }}</span>
            <NSwitch :value="appLock.enabled" @update:value="toggleLock" />
          </div>
          <template v-if="appLock.enabled">
            <div class="flex items-center justify-between">
              <span class="text-13px">{{ bi('闲置自动锁定', 'Idle Auto-Lock') }}</span>
              <NSelect
                :value="appLock.idleMinutes"
                :options="IDLE_OPTIONS"
                size="small"
                class="w-220px"
                @update:value="v => appLock.setIdleMinutes(v)"
              />
            </div>
            <div class="flex gap-8px">
              <NButton size="small" secondary @click="lockPwdShow = true">
                <template #icon><SvgIcon icon="lucide:key-round" /></template>
                {{ bi('修改密码', 'Change Password') }}
              </NButton>
              <NButton size="small" type="primary" @click="appLock.lock()">
                <template #icon><SvgIcon icon="lucide:lock" /></template>
                {{ bi('立即锁定', 'Lock Now') }}
              </NButton>
            </div>
            <div class="text-12px text-gray-400">
              {{ bi('找回问题：', 'Recovery Question: ') }}{{ appLock.question }}
            </div>
          </template>
        </NSpace>
      </NCard>

      <!-- 演示数据 -->
      <NCard :bordered="false" :title="bi('演示数据', 'Demo Seed Data')">
        <NSpace vertical size="large">
          <div class="text-13px leading-relaxed text-gray-500">
            {{
              bi(
                '内置一套虚构演示数据（22 名成员、一学期台历节奏、党费/谈话/模板样例，全部化名脱敏）。可用于体验与截图演示。',
                'Built-in desensitized demo dataset (22 members, full semester schedule, dues, talks & templates) for testing and evaluation.'
              )
            }}
          </div>
          <div class="flex gap-8px">
            <NButton size="small" secondary :loading="resetting" @click="openDangerConfirm('reset')">
              <template #icon><SvgIcon icon="lucide:rotate-ccw" /></template>
              {{ bi('重置为演示种子', 'Reset to Demo Seed') }}
            </NButton>
            <NButton size="small" type="error" ghost @click="openDangerConfirm('clear')">
              <template #icon><SvgIcon icon="lucide:trash-2" /></template>
              {{ bi('清空业务数据', 'Clear All Data') }}
            </NButton>
          </div>
        </NSpace>
      </NCard>

      <!-- 关于 -->
      <NCard :bordered="false" :title="bi('关于三尺台', 'About 三尺台')">
        <NSpace vertical size="large">
          <div class="text-13px leading-relaxed text-gray-600">
            {{
              bi(
                '学工工作平台（v0.2.4）——党支部书记个人离线工作台。主视图台历，配套三会一课排期、党员发展、党费收缴、谈心谈话、知识库与政策文件库。数据纯本地，无账号、无网络请求。',
                'Student & Party Affairs Workbench (v0.2.4) — Offline-first personal workspace for Party Branch Secretaries. Calendar-driven with full ledger, knowledge base, and policy archives.'
              )
            }}
          </div>
          <NDescriptions :column="1" size="small" label-placement="left" bordered>
            <NDescriptionsItem :label="bi('版本', 'Version')">{{ APP_VERSION }}</NDescriptionsItem>
            <NDescriptionsItem :label="bi('第三方开源组件', 'Open Source Stack')">
              Vue 3 · Naive UI · FullCalendar · ECharts · Dexie · Tauri（MIT / Apache-2.0）
            </NDescriptionsItem>
            <NDescriptionsItem :label="bi('隐私声明', 'Privacy Notice')">
              {{
                bi(
                  '默认不采集身份证号；手机号为选填敏感字段；导出报表不含敏感列',
                  'No ID numbers collected; all data stored locally in IndexedDB; exports exclude sensitive columns'
                )
              }}
            </NDescriptionsItem>
          </NDescriptions>
        </NSpace>
      </NCard>
    </div>

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
            ，还原为内置 22 人演示种子数据。若尚未导出 JSON 备份，当前录入的真实数据将无法找回。
          </template>
          <template v-else>
            此操作将
            <strong>永久清空当前全部成员、台历、三会一课、党员发展、党费、谈话与文档数据</strong>
            （仅保留本地备份快照）。操作不可撤销！
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

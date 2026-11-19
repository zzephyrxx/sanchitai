<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import dayjs from 'dayjs';
import { saveAs } from 'file-saver';
import { db, exportBackup, importBackup, pushBackupRing, listBackupRing, clearAllData, type BackupShape } from '@/db/db';
import { resetToSeed } from '@/db/seed';
import { useAppLockStore, LOCK_QUESTIONS } from '@/store/modules/applock';
import { buildHandoverHtml } from '@/utils/handover';

defineOptions({ name: 'SettingsPage' });

const appLock = useAppLockStore();
const APP_VERSION = 'v0.2.0';

// ---------------- 一键交接包 ----------------
const handoverBusy = ref(false);

async function exportHandoverData() {
  handoverBusy.value = true;
  try {
    const shape = await exportBackup();
    saveAs(new Blob([JSON.stringify(shape, null, 2)], { type: 'application/json;charset=utf-8' }), '交接数据包.json');
    window.$message?.success('交接数据包已导出（接任人通过「从备份恢复」导入）');
  } finally {
    handoverBusy.value = false;
  }
}

async function exportHandoverDoc() {
  handoverBusy.value = true;
  try {
    const shape = await exportBackup();
    const html = buildHandoverHtml(shape, '智感硕博党支部（演示）');
    saveAs(new Blob([html], { type: 'text/html;charset=utf-8' }), `支部工作交接文档_${dayjs().format('YYYYMMDD')}.html`);
    window.$message?.success('交接文档已导出（浏览器/Word 打开即可打印）');
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

const questionOptions = [...LOCK_QUESTIONS.map(v => ({ label: v, value: v })), { label: '自定义问题…', value: '__custom__' }];

const IDLE_OPTIONS = [
  { label: '不自动锁定', value: 0 },
  { label: '5 分钟无操作后锁定', value: 5 },
  { label: '15 分钟无操作后锁定', value: 15 },
  { label: '30 分钟无操作后锁定', value: 30 }
];

function toggleLock(enabled: boolean) {
  if (enabled) {
    Object.assign(lockForm, { pwd: '', confirm: '', question: LOCK_QUESTIONS[0], customQuestion: '', answer: '', idle: 0 });
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
  const shape = await exportBackup();
  const json = JSON.stringify(shape, null, 2);
  saveAs(new Blob([json], { type: 'application/json;charset=utf-8' }), `三尺台备份_${new Date().toISOString().slice(0, 10)}.json`);
  window.$message?.success('备份已导出（含成员/台历/台账/谈话/文档全部数据）');
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
  window.$message?.success('已恢复所选快照');
}

// ---------------- 演示数据 ----------------
const resetting = ref(false);
async function handleReset() {
  resetting.value = true;
  try {
    await resetToSeed();
    await db.meta.delete('academy-flow'); // 学院版自定义节点一并还原
    window.$message?.success('已重置为演示种子数据');
    listSnapshots();
  } finally {
    resetting.value = false;
  }
}

async function handleClear() {
  await clearAllData();
  await db.meta.delete('seed_v1');
  window.$message?.success('业务数据已清空（备份快照保留）');
  listSnapshots();
}

onMounted(listSnapshots);
</script>

<template>
  <div class="grid grid-cols-1 gap-14px lg:grid-cols-2">
    <!-- 备份与恢复 -->
    <NCard :bordered="false" title="备份与恢复">
      <NSpace vertical size="large">
        <div class="text-13px leading-relaxed text-gray-500">
          数据 100% 存于本机浏览器（IndexedDB）。换机/重装前请导出备份文件；导入备份会先自动快照当前数据，可随时回退。
        </div>
        <div class="flex gap-8px">
          <NButton type="primary" @click="handleExport">一键备份（导出 JSON）</NButton>
          <NButton :loading="restoring" @click="pickFile">从备份恢复…</NButton>
          <input ref="fileInput" type="file" accept=".json,application/json" class="hidden" @change="handleFileChange" />
        </div>

        <NDivider title-placement="left" style="font-size: 13px">自动快照（环形 5 份）</NDivider>
        <div class="flex items-center gap-8px">
          <NButton size="small" @click="createSnapshot">创建快照</NButton>
          <NButton size="small" @click="listSnapshots">刷新</NButton>
        </div>
        <div v-if="!snapshots.length" class="text-12px text-gray-400">暂无快照</div>
        <div v-for="s in snapshots" :key="s.key" class="flex items-center justify-between rounded-8px bg-[var(--sct-soft)] px-10px py-8px">
          <div>
            <div class="text-13px font-bold">{{ s.ts.replace('T', ' ').slice(0, 19) }}</div>
            <div class="text-11px text-gray-500">{{ s.counts }}</div>
          </div>
          <NButton size="tiny" @click="restoreSnapshot(s.key)">恢复此快照</NButton>
        </div>
      </NSpace>
    </NCard>

    <div class="flex flex-col gap-14px">
      <!-- 一键交接 -->
      <NCard :bordered="false" title="一键交接">
        <NSpace vertical size="large">
          <div class="text-13px leading-relaxed text-gray-500">
            离任交接两件套：①「交接数据包」= 全量台账 JSON，接任人导入即接续；②「交接文档」= 自动生成的可打印文档（任期大事记 / 待办 / 发展节点 / 党费欠缴 / 台账摘要 / 交接说明）。
          </div>
          <div class="flex gap-8px">
            <NButton type="primary" size="small" :loading="handoverBusy" @click="exportHandoverData">导出交接数据包</NButton>
            <NButton size="small" :loading="handoverBusy" @click="exportHandoverDoc">生成交接文档</NButton>
          </div>
        </NSpace>
      </NCard>

      <!-- 应用锁 -->
      <NCard :bordered="false" title="应用锁">
        <NSpace vertical size="large">
          <div class="text-13px leading-relaxed text-gray-500">
            启用后，启动工作台需输入密码；页眉可随时手动锁定，支持闲置自动锁定与密保答案找回。密码仅在本机存哈希，用于隐私遮挡。
          </div>
          <div class="flex items-center justify-between">
            <span class="text-13px">启用应用锁</span>
            <NSwitch :value="appLock.enabled" @update:value="toggleLock" />
          </div>
          <template v-if="appLock.enabled">
            <div class="flex items-center justify-between">
              <span class="text-13px">闲置自动锁定</span>
              <NSelect :value="appLock.idleMinutes" :options="IDLE_OPTIONS" size="small" class="w-220px" @update:value="v => appLock.setIdleMinutes(v)" />
            </div>
            <div class="flex gap-8px">
              <NButton size="small" @click="lockPwdShow = true">修改密码</NButton>
              <NButton size="small" type="primary" @click="appLock.lock()">立即锁定</NButton>
            </div>
            <div class="text-12px text-gray-400">找回问题：{{ appLock.question }}</div>
          </template>
        </NSpace>
      </NCard>

      <!-- 演示数据 -->
      <NCard :bordered="false" title="演示数据">
        <NSpace vertical size="large">
          <div class="text-13px leading-relaxed text-gray-500">
            内置一套虚构演示数据（22 名成员、一学期台历节奏、党费/谈话/模板样例，全部化名脱敏）。可用于体验与截图演示。
          </div>
          <div class="flex gap-8px">
            <NButton size="small" :loading="resetting" @click="handleReset">重置为演示种子</NButton>
            <NButton size="small" type="error" ghost @click="handleClear">清空业务数据</NButton>
          </div>
        </NSpace>
      </NCard>

      <!-- 关于 -->
      <NCard :bordered="false" title="关于三尺台">
        <NSpace vertical size="large">
          <div class="text-13px leading-relaxed text-gray-600">
            学工工作平台（v0.2.0）——党支部书记个人离线工作台。主视图台历，配套三会一课排期、党员发展台账、党费台账、谈心谈话、知识库与政策文件库。数据纯本地，无账号、无网络请求。
          </div>
          <NDescriptions :column="1" size="small" label-placement="left" bordered>
            <NDescriptionsItem label="版本">{{ APP_VERSION }}</NDescriptionsItem>
            <NDescriptionsItem label="第三方开源组件">Vue 3 · Naive UI · Schedule-X · ECharts · Dexie · Tauri（MIT / Apache-2.0）</NDescriptionsItem>
            <NDescriptionsItem label="隐私声明">默认不采集身份证号；手机号为选填敏感字段；导出报表不含敏感列</NDescriptionsItem>
          </NDescriptions>
        </NSpace>
      </NCard>
    </div>

    <!-- 应用锁：启用设置 -->
    <NModal v-model:show="lockSetupShow" preset="card" title="启用应用锁" class="w-440px" :mask-closable="false">
      <NForm label-placement="left" label-width="96" size="small">
        <NFormItem label="锁屏密码" required>
          <NInput v-model:value="lockForm.pwd" type="password" show-password-on="mousedown" placeholder="至少 4 位" :maxlength="32" />
        </NFormItem>
        <NFormItem label="确认密码" required>
          <NInput v-model:value="lockForm.confirm" type="password" show-password-on="mousedown" :maxlength="32" />
        </NFormItem>
        <NFormItem label="找回问题" required>
          <NSelect v-model:value="lockForm.question" :options="questionOptions" />
        </NFormItem>
        <NFormItem v-if="lockForm.question === '__custom__'" label="自定义问题" required>
          <NInput v-model:value="lockForm.customQuestion" placeholder="输入自定义问题" />
        </NFormItem>
        <NFormItem label="答案" required>
          <NInput v-model:value="lockForm.answer" placeholder="答案（不区分首尾空格）" />
        </NFormItem>
        <NFormItem label="闲置锁定">
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
    <NModal v-model:show="lockDisableShow" preset="card" title="关闭应用锁" class="w-380px" :mask-closable="false">
      <NForm label-placement="left" label-width="80" size="small">
        <NFormItem label="密码" required>
          <NInput v-model:value="disablePwd" type="password" show-password-on="mousedown" @keyup.enter="handleLockDisable" />
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
    <NModal v-model:show="lockPwdShow" preset="card" title="修改锁屏密码" class="w-400px" :mask-closable="false">
      <NForm label-placement="left" label-width="80" size="small">
        <NFormItem label="原密码" required>
          <NInput v-model:value="pwdForm.old" type="password" show-password-on="mousedown" />
        </NFormItem>
        <NFormItem label="新密码" required>
          <NInput v-model:value="pwdForm.new" type="password" show-password-on="mousedown" placeholder="至少 4 位" :maxlength="32" />
        </NFormItem>
        <NFormItem label="确认新密码" required>
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
  </div>
</template>

<style scoped></style>

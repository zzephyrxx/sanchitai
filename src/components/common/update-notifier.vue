<script setup lang="ts">
import { computed } from 'vue';
import { useUpdaterStore } from '@/store/modules/updater';

defineOptions({ name: 'UpdateNotifier' });

const updater = useUpdaterStore();

const formattedSize = computed(() => {
  const bytes = updater.release?.assetSize ?? 0;
  if (!bytes) return '';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
});

const shortNotes = computed(() => {
  const raw = (updater.release?.releaseNotes || '').trim();
  if (!raw) return '包含新功能改进与问题修复，建议升级以获得最佳体验。';
  return raw.length > 220 ? `${raw.slice(0, 220)}…` : raw;
});
</script>

<template>
  <Teleport to="body">
    <Transition name="sct-update-slide">
      <div
        v-if="updater.popupVisible && updater.release?.hasUpdate"
        class="sct-update-toast"
        role="dialog"
        aria-label="发现新版本"
      >
        <div class="flex items-start justify-between gap-10px">
          <div class="flex items-center gap-8px">
            <span class="inline-flex size-28px items-center justify-center rounded-8px bg-[#A81C24]/12 text-[#A81C24]">
              <SvgIcon icon="lucide:sparkles" class="text-16px" />
            </span>
            <div>
              <div class="flex items-center gap-6px text-13px font-bold text-[var(--sct-ink)]">
                <span>发现新版本 {{ updater.release.latestVersion }}</span>
                <NTag v-if="formattedSize" size="tiny" :bordered="false" round>{{ formattedSize }}</NTag>
              </div>
              <div class="text-11px text-gray-400">
                当前 {{ updater.release.currentVersion }} · 升级前将自动保存防冲突保护快照
              </div>
            </div>
          </div>
          <NButton size="tiny" quaternary circle @click="updater.dismissPopup()">
            <template #icon><SvgIcon icon="lucide:x" class="text-13px" /></template>
          </NButton>
        </div>

        <div
          class="mt-10px max-h-92px overflow-y-auto whitespace-pre-wrap rounded-8px bg-[var(--sct-soft)] px-10px py-7px text-11px leading-relaxed text-gray-600 dark:text-gray-300"
        >
          {{ shortNotes }}
        </div>

        <!-- 升级前自动保护快照提示 -->
        <div v-if="updater.backingUpBeforeUpdate" class="mt-8px flex items-center gap-6px text-11px text-[#2563eb]">
          <SvgIcon icon="lucide:shield-check" class="text-13px" />
          <span>正在自动创建升级前 .sctpack 保护快照…</span>
        </div>

        <!-- 下载进度条 -->
        <div v-if="updater.downloading" class="mt-10px flex flex-col gap-4px">
          <NProgress
            type="line"
            :percentage="Math.round(updater.progress.percent)"
            indicator-placement="inside"
            processing
            color="#A81C24"
          />
          <div class="flex justify-between text-11px text-gray-400">
            <span>正在下载 {{ updater.release.assetName }}</span>
            <span>
              {{ (updater.progress.downloaded / (1024 * 1024)).toFixed(1) }} /
              {{ (updater.progress.total / (1024 * 1024)).toFixed(1) }} MB
            </span>
          </div>
        </div>

        <div
          v-if="updater.protectedSnapshotPath && !updater.backingUpBeforeUpdate"
          class="mt-6px truncate text-10px text-[#16a34a]"
          :title="updater.protectedSnapshotPath"
        >
          ✓ 已创建升级前保护快照
        </div>

        <div class="mt-12px flex flex-wrap items-center justify-between gap-6px">
          <NButton size="tiny" text @click="updater.ignoreCurrentRelease()">忽略此版本</NButton>
          <div class="flex items-center gap-6px">
            <NButton
              v-if="updater.downloadedPath"
              size="small"
              type="success"
              @click="updater.installDownloadedUpdate()"
            >
              <template #icon><SvgIcon icon="lucide:package-open" /></template>
              立即打开安装器
            </NButton>
            <NButton
              v-else
              size="small"
              type="primary"
              :loading="updater.downloading || updater.backingUpBeforeUpdate"
              @click="updater.startDownloadUpdate()"
            >
              <template #icon><SvgIcon icon="lucide:download" /></template>
              {{ updater.isDesktopNative ? '自动下载更新' : '前往下载页' }}
            </NButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sct-update-toast {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 9500;
  width: min(370px, calc(100vw - 32px));
  padding: 14px;
  border-radius: 12px;
  background: var(--sct-container, #ffffff);
  border: 1px solid var(--sct-border, #e5e7eb);
  box-shadow: 0 14px 36px rgba(15, 23, 42, 0.16);
}
.sct-update-slide-enter-active,
.sct-update-slide-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.22s ease;
}
.sct-update-slide-enter-from,
.sct-update-slide-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.98);
}
</style>

<script setup lang="ts">
import { computed } from 'vue';
import { useUpdaterStore } from '@/store/modules/updater';
import { useSctI18n } from '@/hooks/common/sct-i18n';

defineOptions({ name: 'UpdateNotifier' });

const updater = useUpdaterStore();
const { isEn } = useSctI18n();

interface ParsedNoteItem {
  title?: string;
  text: string;
}

interface ParsedNoteSection {
  heading?: string;
  items: ParsedNoteItem[];
}

function cleanInlineMarkdown(raw: string): string {
  return raw
    .replace(/&nbsp;/gi, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanHeading(raw: string): string {
  return cleanInlineMarkdown(raw.replace(/^#{1,6}\s*/, ''))
    .replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, '')
    .trim();
}

function isNoiseSection(heading: string): boolean {
  return /安装包|升级说明|assets\s*&?\s*upgrade|upgrade\s+guide|view\s+changes/i.test(heading);
}

/** 解析 GitHub Release Note Markdown，按当前语言自动拆段并结构化渲染 */
const parsedSections = computed<ParsedNoteSection[]>(() => {
  const rawAll = (updater.release?.releaseNotes || '').replace(/\r\n/g, '\n').trim();
  if (!rawAll) {
    return [{ items: [{ text: '包含新功能改进与问题修复，建议升级以获得最佳体验。' }] }];
  }

  // 双语 Release Note 通常以 `---` 分隔中/英两部分，按当前语言仅展示对应段
  const parts = rawAll
    .split(/\n\s*---+\s*\n/)
    .map(p => p.trim())
    .filter(Boolean);
  let targetBlock = rawAll;
  if (parts.length >= 2) {
    const zhPart = parts.find(p => /[\u4E00-\u9FA5]/.test(p)) ?? parts[0];
    const enPart = parts.find(p => !/[\u4E00-\u9FA5]/.test(p)) ?? parts[parts.length - 1];
    targetBlock = isEn.value ? enPart : zhPart;
  }

  const sections: ParsedNoteSection[] = [];
  let current: ParsedNoteSection | null = null;
  let skipSection = false;

  for (const rawLine of targetBlock.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/view\s+changes\s+on\s+github/i.test(line)) continue;

    if (/^#{1,6}\s+/.test(line)) {
      const heading = cleanHeading(line);
      if (!heading || isNoiseSection(heading)) {
        skipSection = true;
        current = null;
        continue;
      }
      skipSection = false;
      current = { heading, items: [] };
      sections.push(current);
      continue;
    }

    if (skipSection) continue;

    const bulletMatch = line.match(/^[-*•]\s+(.+)$/);
    const contentRaw = bulletMatch ? bulletMatch[1] : line;
    const boldTitleMatch = contentRaw.match(/^\*\*([^*]+)\*\*\s*(?:`[^`]+`\s*)?[：:]\s*(.+)$/);

    const item: ParsedNoteItem = boldTitleMatch
      ? {
          title: cleanInlineMarkdown(boldTitleMatch[1]),
          text: cleanInlineMarkdown(boldTitleMatch[2])
        }
      : { text: cleanInlineMarkdown(contentRaw) };

    if (!item.text && !item.title) continue;

    if (!current) {
      current = { items: [] };
      sections.push(current);
    }
    current.items.push(item);
  }

  const nonEmpty = sections.filter(s => s.items.length > 0);
  if (nonEmpty.length > 0) return nonEmpty;
  return [{ items: [{ text: cleanInlineMarkdown(targetBlock) || '包含新功能改进与问题修复，建议升级。' }] }];
});

const formattedSize = computed(() => {
  const bytes = updater.release?.assetSize ?? 0;
  if (!bytes) return '';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
});

const progressPercent = computed(() => Math.min(100, Math.max(0, Math.round(updater.progress.percent))));
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
            <span
              class="inline-flex size-28px shrink-0 items-center justify-center rounded-8px bg-[#A81C24]/12 text-[#A81C24]"
            >
              <SvgIcon icon="lucide:sparkles" class="text-16px" />
            </span>
            <div class="min-w-0">
              <div class="flex items-center gap-6px text-13px font-bold text-[var(--sct-ink)]">
                <span>发现新版本 {{ updater.release.latestVersion }}</span>
                <NTag v-if="formattedSize" size="tiny" :bordered="false" round :title="updater.release.assetName || ''">
                  {{ formattedSize }}
                </NTag>
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

        <!-- 结构化解析后的更新摘要（自动过滤 Markdown 符号与双语重复段） -->
        <div class="sct-update-notes mt-10px">
          <div v-for="(sec, sIdx) in parsedSections" :key="sIdx" class="sct-update-section">
            <div v-if="sec.heading" class="sct-update-section-title">
              {{ sec.heading }}
            </div>
            <ul class="m-0 list-none p-0 flex flex-col gap-5px">
              <li v-for="(item, iIdx) in sec.items" :key="iIdx" class="flex items-start gap-6px leading-relaxed">
                <span class="mt-6px size-4px shrink-0 rounded-full bg-[#A81C24]/70" />
                <span class="min-w-0 flex-1 text-11.5px text-gray-600 dark:text-gray-300">
                  <strong v-if="item.title" class="font-semibold text-[var(--sct-ink)]">{{ item.title }}：</strong>
                  <span>{{ item.text }}</span>
                </span>
              </li>
            </ul>
          </div>
        </div>

        <!-- 升级前自动保护快照提示 -->
        <div v-if="updater.backingUpBeforeUpdate" class="mt-8px flex items-center gap-6px text-11px text-[#2563eb]">
          <SvgIcon icon="lucide:shield-check" class="text-13px" />
          <span>正在自动创建升级前保护快照…</span>
        </div>

        <!-- 纤细下载进度条 -->
        <div v-if="updater.downloading" class="mt-10px flex flex-col gap-5px">
          <NProgress
            type="line"
            :percentage="progressPercent"
            :height="4"
            :border-radius="999"
            :show-indicator="false"
            processing
            color="#A81C24"
            rail-color="var(--sct-border)"
          />
          <div class="flex items-center justify-between gap-8px text-11px text-gray-400">
            <span class="truncate">正在下载 {{ updater.release.assetName }}</span>
            <span class="shrink-0 font-mono">
              <template v-if="updater.progress.total > 0">
                {{ progressPercent }}% · {{ (updater.progress.downloaded / (1024 * 1024)).toFixed(1) }} /
                {{ (updater.progress.total / (1024 * 1024)).toFixed(1) }} MB
              </template>
              <template v-else>{{ (updater.progress.downloaded / (1024 * 1024)).toFixed(1) }} MB</template>
            </span>
          </div>
        </div>

        <div
          v-if="updater.protectedSnapshotPath && !updater.backingUpBeforeUpdate"
          class="mt-7px truncate text-10.5px text-[#16a34a]"
          :title="updater.protectedSnapshotPath"
        >
          ✓ 已创建升级前保护快照（可在「设置 → 自动快照」随时恢复）
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
  width: min(392px, calc(100vw - 32px));
  padding: 14px;
  border-radius: 12px;
  background: var(--sct-container, #ffffff);
  border: 1px solid var(--sct-border, #e5e7eb);
  box-shadow: 0 14px 36px rgba(15, 23, 42, 0.16);
}
.sct-update-notes {
  max-height: 176px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-radius: 8px;
  background: var(--sct-soft);
  padding: 10px 11px;
}
.sct-update-section {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.sct-update-section-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--sct-ink);
  letter-spacing: 0.02em;
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

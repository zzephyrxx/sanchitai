<script setup lang="ts">
/**
 * 侧栏左下角「模块管理」入口与轻量管理弹窗
 * - 位于「使用指南」正上方，方便直接自定义左侧菜单栏可见模块
 * - 除「统计总览 / 人员花名册 / 系统设置」核心必留外，全部台账与资料库模块均可自由开关
 * - 关闭仅隐藏菜单入口，历史数据安全保留
 */
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { RouteKey } from '@elegant-router/types';
import { DEFAULT_ENABLED_MODULES, WORKSHOP_MODULES, WORKSHOP_MODULE_GROUPS } from '@/constants/workspace-presets';
import type { WorkshopModuleGroup } from '@/constants/workspace-presets';
import { useTabStore } from '@/store/modules/tab';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useSctI18n } from '@/hooks/common/sct-i18n';

defineOptions({ name: 'ModuleManagerButton' });

withDefaults(defineProps<{ collapsed?: boolean; floating?: boolean }>(), {
  collapsed: false,
  floating: false
});

const router = useRouter();
const tabStore = useTabStore();
const workStore = useWorkDataStore();
const { bi } = useSctI18n();

const modalShow = ref(false);

const enabledModules = computed(() => workStore.workspaceConfig.enabledModules);
const enabledCount = computed(() => WORKSHOP_MODULES.filter(m => enabledModules.value[m.key]).length);

const groupedModules = computed(() =>
  WORKSHOP_MODULE_GROUPS.map(g => ({
    ...g,
    items: WORKSHOP_MODULES.filter(m => m.group === g.key)
  }))
);

async function redirectIfCurrentRouteDisabled(nextEnabled: Record<Sct.OptionalModuleKey, boolean>) {
  const currentName = String(router.currentRoute.value.name ?? '');
  const matchedMod = WORKSHOP_MODULES.find(m => m.routeName === currentName);
  if (matchedMod && !nextEnabled[matchedMod.key]) {
    await tabStore.removeTabByRouteName(currentName as RouteKey);
    if (String(router.currentRoute.value.name ?? '') === currentName) {
      await router.push({ name: 'dashboard' });
    }
  }
}

async function toggleModule(key: Sct.OptionalModuleKey, val: boolean) {
  const nextEnabled = {
    ...enabledModules.value,
    [key]: val
  };
  await workStore.updateWorkspaceConfig({ enabledModules: nextEnabled });
  if (!val) {
    await redirectIfCurrentRouteDisabled(nextEnabled);
  }
}

async function enableAllModules() {
  await workStore.updateWorkspaceConfig({
    enabledModules: { ...DEFAULT_ENABLED_MODULES }
  });
  window.$message?.success('已开启全部功能模块');
}

async function toggleGroupAll(group: WorkshopModuleGroup, val: boolean) {
  const patch: Partial<Record<Sct.OptionalModuleKey, boolean>> = {};
  for (const m of WORKSHOP_MODULES) {
    if (m.group === group) patch[m.key] = val;
  }
  const nextEnabled = {
    ...enabledModules.value,
    ...patch
  };
  await workStore.updateWorkspaceConfig({ enabledModules: nextEnabled });
  if (!val) {
    await redirectIfCurrentRouteDisabled(nextEnabled);
  }
}

function jumpToModule(routeName?: string) {
  if (!routeName) return;
  modalShow.value = false;
  void router.push({ name: routeName });
}
</script>

<template>
  <div data-tour="module-manager" :class="floating ? '' : 'px-10px pt-6px pb-2px'">
    <button
      v-if="!collapsed"
      type="button"
      class="sider-mod-trigger w-full flex items-center justify-between gap-8px px-12px py-8px text-13.5px"
      :class="{ 'sider-mod-trigger--floating': floating }"
      :title="bi('模块管理', 'Module Manager')"
      @click="modalShow = true"
    >
      <span class="flex min-w-0 items-center gap-10px">
        <SvgIcon icon="lucide:blocks" class="shrink-0 text-17px opacity-80" />
        <span class="truncate">{{ bi('模块管理', 'Modules') }}</span>
      </span>
      <span class="font-mono text-11px opacity-60">{{ enabledCount }}/{{ WORKSHOP_MODULES.length }}</span>
    </button>
    <button
      v-else
      type="button"
      class="sider-mod-trigger mx-auto flex size-36px items-center justify-center"
      :class="{ 'sider-mod-trigger--floating': floating }"
      :title="bi('模块管理', 'Module Manager')"
      @click="modalShow = true"
    >
      <SvgIcon icon="lucide:blocks" class="text-18px opacity-80" />
    </button>

    <NModal v-model:show="modalShow" preset="card" class="w-700px max-w-95vw" :bordered="false">
      <template #header>
        <div class="flex flex-wrap items-center gap-8px">
          <SvgIcon icon="lucide:blocks" class="text-17px text-[#A81C24]" />
          <span class="text-15px font-bold">{{ bi('左侧菜单模块管理', 'Sidebar Module Manager') }}</span>
          <NTag size="tiny" type="info" :bordered="false" round>
            已启 {{ enabledCount }}/{{ WORKSHOP_MODULES.length }}
          </NTag>
        </div>
      </template>

      <template #header-extra>
        <NButton size="tiny" secondary :disabled="enabledCount === WORKSHOP_MODULES.length" @click="enableAllModules">
          <template #icon><SvgIcon icon="lucide:check-check" /></template>
          全部开启
        </NButton>
      </template>

      <div class="flex flex-col gap-14px">
        <div
          class="flex flex-wrap items-center justify-between gap-6px rounded-8px border border-[var(--sct-border)] bg-[var(--sct-soft)] px-12px py-8px text-12px text-[var(--sct-muted)]"
        >
          <span>关闭模块仅隐藏左侧菜单栏入口，历史台账数据永久安全保留。</span>
          <span class="font-medium text-[var(--sct-ink)]">常驻核心：统计总览 · 人员花名册 · 设置</span>
        </div>

        <div class="max-h-62vh flex flex-col gap-14px overflow-y-auto pr-2px">
          <div v-for="grp in groupedModules" :key="grp.key" class="flex flex-col gap-8px">
            <div class="flex items-center justify-between">
              <span class="text-12.5px font-bold text-[var(--sct-ink)]">{{ bi(grp.titleZh, grp.titleEn) }}</span>
              <div class="flex items-center gap-6px">
                <NButton size="tiny" quaternary @click="toggleGroupAll(grp.key, true)">全开</NButton>
                <NButton size="tiny" quaternary @click="toggleGroupAll(grp.key, false)">全关</NButton>
              </div>
            </div>

            <div class="grid grid-cols-1 gap-8px sm:grid-cols-2">
              <div
                v-for="mod in grp.items"
                :key="mod.key"
                class="mod-card flex items-start justify-between gap-10px rounded-8px border border-[var(--sct-border)] bg-[var(--sct-page)] px-12px py-10px transition-all"
                :class="{ 'opacity-60': !enabledModules[mod.key] }"
              >
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-6px">
                    <SvgIcon :icon="mod.icon" class="shrink-0 text-15px" :style="{ color: mod.color }" />
                    <button
                      v-if="mod.routeName && enabledModules[mod.key]"
                      type="button"
                      class="cursor-pointer border-0 bg-transparent p-0 text-left text-13px font-bold text-[var(--sct-ink)] hover:text-[#A81C24]"
                      @click="jumpToModule(mod.routeName)"
                    >
                      {{ bi(mod.titleZh, mod.titleEn) }}
                    </button>
                    <span v-else class="text-13px font-bold text-[var(--sct-ink)]">
                      {{ bi(mod.titleZh, mod.titleEn) }}
                    </span>
                    <NTag v-if="mod.badgeZh" size="tiny" :bordered="false">{{ mod.badgeZh }}</NTag>
                  </div>
                  <div class="mt-3px text-11.5px text-[var(--sct-muted)] leading-snug">
                    {{ bi(mod.descZh, mod.descEn) }}
                  </div>
                </div>
                <NSwitch
                  :value="enabledModules[mod.key]"
                  size="small"
                  class="mt-2px shrink-0"
                  @update:value="val => toggleModule(mod.key, val)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="flex justify-end">
          <NButton size="small" type="primary" @click="modalShow = false">完成</NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.sider-mod-trigger {
  border: none;
  background: transparent;
  color: var(--sct-muted);
  border-radius: 6px;
  cursor: pointer;
  transition:
    color 0.15s ease,
    background-color 0.15s ease;
}

.sider-mod-trigger:hover {
  color: var(--sct-ink);
  background: var(--sct-soft);
}

.sider-mod-trigger--floating {
  border: 1px solid var(--sct-border);
  background: var(--sct-container);
  color: var(--sct-ink);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
}

.sider-mod-trigger--floating:hover {
  background: var(--sct-soft);
}
</style>

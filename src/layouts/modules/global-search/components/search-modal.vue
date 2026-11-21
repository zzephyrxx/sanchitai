<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { onKeyStroke } from '@vueuse/core';
import { $t } from '@/locales';
import { useAppStore } from '@/store/modules/app';
import { useRouteStore } from '@/store/modules/route';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useSctI18n } from '@/hooks/common/sct-i18n';
import { KNOWLEDGE_ITEMS } from '@/constants/knowledge-data';
import SearchFooter from './search-footer.vue';

defineOptions({ name: 'SearchModal' });

interface GlobalSearchItem {
  id: string;
  category: string;
  icon: string;
  title: string;
  subtitle: string;
  routePath: string;
  badge?: string;
}

const router = useRouter();
const appStore = useAppStore();
const routeStore = useRouteStore();
const workStore = useWorkDataStore();
const { bi, tMemberType, tEventStatus } = useSctI18n();

const isMobile = computed(() => appStore.isMobile);
const visible = defineModel<boolean>('show', { required: true });

const keyword = ref('');
const activeId = ref('');

/** 全域索引：功能菜单 + 在册人员 + 台历/三会一课事项 + 谈心谈话 + 知识库图解 + 材料库模板与归档 */
const allSearchItems = computed<GlobalSearchItem[]>(() => {
  const items: GlobalSearchItem[] = [];

  // 1. 路由菜单
  routeStore.searchMenus.forEach(menu => {
    const title = menu.i18nKey ? $t(menu.i18nKey) : menu.label;
    items.push({
      id: `menu-${menu.routePath}`,
      category: bi('功能菜单', 'Menu'),
      icon: 'lucide:compass',
      title,
      subtitle: menu.routePath,
      routePath: menu.routePath,
      badge: bi('页面', 'Page')
    });
  });

  // 2. 在册人员
  workStore.members.forEach(m => {
    items.push({
      id: `member-${m.id}`,
      category: bi('在册人员', 'Members'),
      icon: 'lucide:user',
      title: `${m.name}（${m.code}）`,
      subtitle: [tMemberType(m.type), m.role, m.group, m.grade, m.major].filter(Boolean).join(' · '),
      routePath: '/ledger/members',
      badge: tMemberType(m.type)
    });
  });

  // 3. 台历 & 三会一课事项
  workStore.calEvents.forEach(ev => {
    const isMeeting = ['支委会', '党员大会', '党小组会', '党课', '主题党日', '组织生活会', '民主评议'].includes(
      ev.kind ?? ''
    );
    items.push({
      id: `event-${ev.id}`,
      category: isMeeting ? bi('三会一课', 'Meetings') : bi('台历日程', 'Calendar'),
      icon: isMeeting ? 'lucide:calendar-check-2' : 'lucide:calendar-days',
      title: ev.title,
      subtitle: [ev.date, ev.kind || ev.category, ev.location, workStore.memberName(ev.owner)]
        .filter(Boolean)
        .join(' · '),
      routePath: isMeeting ? '/ledger/meetings' : '/calendar',
      badge: tEventStatus(ev.status)
    });
  });

  // 4. 谈心谈话
  workStore.talks.forEach(t => {
    const names = t.member_ids.map(id => workStore.memberName(id)).join('、');
    items.push({
      id: `talk-${t.id}`,
      category: bi('谈心谈话', 'Talks'),
      icon: 'lucide:messages-square',
      title: `${names} · ${t.type}`,
      subtitle: `${t.date} · ${t.content}`,
      routePath: '/ledger/talks',
      badge: t.date
    });
  });

  // 5. 知识库图解
  KNOWLEDGE_ITEMS.forEach(k => {
    items.push({
      id: `kb-${k.id}`,
      category: bi('知识库', 'Knowledge'),
      icon: 'lucide:graduation-cap',
      title: k.title,
      subtitle: k.category,
      routePath: '/library/knowledge',
      badge: k.category
    });
  });

  // 6. 材料库模板与归档文档
  workStore.docTemplates.forEach(tpl => {
    items.push({
      id: `tpl-${tpl.id}`,
      category: bi('材料模板', 'Templates'),
      icon: 'lucide:file-code',
      title: tpl.name,
      subtitle: `${tpl.category} · ${tpl.placeholders.join(' / ')}`,
      routePath: '/library/docs',
      badge: tpl.category
    });
  });

  workStore.docsList.forEach(doc => {
    items.push({
      id: `doc-${doc.id}`,
      category: bi('归档材料', 'Archived Docs'),
      icon: 'lucide:folder-open',
      title: doc.title,
      subtitle: doc.body.slice(0, 60).replace(/\s+/g, ' '),
      routePath: '/library/docs',
      badge: doc.created_at.slice(0, 10)
    });
  });

  return items;
});

const resultOptions = computed<GlobalSearchItem[]>(() => {
  const kw = keyword.value.toLowerCase().trim();
  if (!kw) {
    // 未输入关键词时默认展示高频功能菜单与近期事项，避免空白无反馈
    return allSearchItems.value.slice(0, 10);
  }
  return allSearchItems.value
    .filter(
      item =>
        item.title.toLowerCase().includes(kw) ||
        item.subtitle.toLowerCase().includes(kw) ||
        item.category.toLowerCase().includes(kw)
    )
    .slice(0, 24);
});

watch(
  resultOptions,
  list => {
    if (!list.length) {
      activeId.value = '';
    } else if (!list.some(i => i.id === activeId.value)) {
      activeId.value = list[0].id;
    }
  },
  { immediate: true }
);

function handleClose() {
  visible.value = false;
  keyword.value = '';
}

function handleUp() {
  const list = resultOptions.value;
  if (!list.length) return;
  const idx = list.findIndex(item => item.id === activeId.value);
  const prevIdx = idx <= 0 ? list.length - 1 : idx - 1;
  activeId.value = list[prevIdx].id;
}

function handleDown() {
  const list = resultOptions.value;
  if (!list.length) return;
  const idx = list.findIndex(item => item.id === activeId.value);
  const nextIdx = idx < 0 || idx === list.length - 1 ? 0 : idx + 1;
  activeId.value = list[nextIdx].id;
}

function selectItem(item: GlobalSearchItem) {
  handleClose();
  void router.push(item.routePath);
}

function handleEnter() {
  if (!visible.value) return;
  const target = resultOptions.value.find(i => i.id === activeId.value) ?? resultOptions.value[0];
  if (!target) return;
  selectItem(target);
}

// 快捷键：Cmd/Ctrl + K 呼出或关闭全局搜索
onKeyStroke('k', e => {
  if (e.metaKey || e.ctrlKey) {
    e.preventDefault();
    visible.value = !visible.value;
  }
});
onKeyStroke('Escape', () => {
  if (visible.value) handleClose();
});
onKeyStroke('Enter', () => {
  if (visible.value) handleEnter();
});
onKeyStroke('ArrowUp', e => {
  if (visible.value) {
    e.preventDefault();
    handleUp();
  }
});
onKeyStroke('ArrowDown', e => {
  if (visible.value) {
    e.preventDefault();
    handleDown();
  }
});
</script>

<template>
  <NModal
    v-model:show="visible"
    :segmented="{ footer: 'soft' }"
    :closable="false"
    preset="card"
    auto-focus
    footer-style="padding: 0; margin: 0"
    class="fixed left-0 right-0"
    :class="[isMobile ? 'size-full top-0px rounded-0' : 'w-660px top-56px']"
  >
    <NInputGroup>
      <NInput
        v-model:value="keyword"
        clearable
        size="large"
        :placeholder="
          bi(
            '搜索功能菜单、党员姓名/编号、三会一课、台历事项、谈心谈话、知识库图解、材料模板…',
            'Search menus, members, meetings, calendar events, talks, knowledge base, templates…'
          )
        "
      >
        <template #prefix>
          <SvgIcon icon="lucide:search" class="text-16px text-gray-400" />
        </template>
      </NInput>
      <NButton v-if="isMobile" type="primary" ghost @click="handleClose">{{ $t('common.cancel') }}</NButton>
    </NInputGroup>

    <div class="mt-14px">
      <div class="mb-8px flex items-center justify-between text-11px text-gray-400">
        <span>
          {{
            keyword.trim()
              ? bi(`找到 ${resultOptions.length} 条匹配结果`, `Found ${resultOptions.length} results`)
              : bi('快捷导航与高频事项（输入关键词可检索全库数据）', 'Quick Navigation (Type to search across all data)')
          }}
        </span>
        <span class="font-mono">⌘K / Ctrl+K</span>
      </div>

      <NEmpty v-if="resultOptions.length === 0" :description="$t('common.noData')" class="py-28px" />
      <NScrollbar v-else class="max-h-380px">
        <div class="flex flex-col gap-6px pr-4px pb-8px">
          <div
            v-for="item in resultOptions"
            :key="item.id"
            class="flex cursor-pointer items-center justify-between gap-12px rounded-8px border px-12px py-9px transition"
            :style="{
              borderColor: item.id === activeId ? 'var(--sct-accent)' : 'var(--sct-border)',
              backgroundColor: item.id === activeId ? 'var(--sct-soft)' : 'var(--sct-container)'
            }"
            @mouseenter="activeId = item.id"
            @click="selectItem(item)"
          >
            <div class="min-w-0 flex flex-1 items-center gap-10px">
              <span
                class="size-30px flex flex-shrink-0 items-center justify-center rounded-6px"
                style="background: var(--sct-soft); color: var(--sct-ink)"
              >
                <SvgIcon :icon="item.icon" class="text-15px" />
              </span>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-8px">
                  <span class="rounded-4px bg-[var(--sct-soft)] px-6px py-1px text-10px font-bold text-[var(--sct-muted)]">
                    {{ item.category }}
                  </span>
                  <span class="truncate text-13px font-bold text-[var(--sct-ink)]">{{ item.title }}</span>
                </div>
                <div class="mt-2px truncate text-11px text-[var(--sct-muted)]">{{ item.subtitle }}</div>
              </div>
            </div>
            <div class="flex flex-shrink-0 items-center gap-8px">
              <NTag v-if="item.badge" size="tiny" :bordered="false">{{ item.badge }}</NTag>
              <SvgIcon icon="lucide:corner-down-left" class="text-14px text-gray-400" />
            </div>
          </div>
        </div>
      </NScrollbar>
    </div>
    <template #footer>
      <SearchFooter v-if="!isMobile" />
    </template>
  </NModal>
</template>

<style lang="scss" scoped></style>

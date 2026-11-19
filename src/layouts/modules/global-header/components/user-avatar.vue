<script setup lang="ts">
import { computed } from 'vue';
import type { VNode } from 'vue';
import { $t } from '@/locales';
import { useAuthStore } from '@/store/modules/auth';
import { useAppLockStore } from '@/store/modules/applock';
import { useSvgIcon } from '@/hooks/common/icon';

defineOptions({
  name: 'UserAvatar'
});

const authStore = useAuthStore();
const appLock = useAppLockStore();
const { SvgIconVNode } = useSvgIcon();

type DropdownKey = 'lock';

type DropdownOption =
  | {
      key: DropdownKey;
      label: string;
      icon?: () => VNode;
    }
  | {
      type: 'divider';
      key: string;
    };

const options = computed(() => {
  const opts: DropdownOption[] = [
    {
      label: '锁定工作台',
      key: 'lock',
      icon: SvgIconVNode({ icon: 'lucide:lock', fontSize: 18 })
    }
  ];

  return opts;
});

function handleAction(key: DropdownKey) {
  if (key === 'lock') {
    appLock.lock();
  }
}
</script>

<template>
  <NDropdown :options="options" @select="handleAction">
    <div class="flex-y-center cursor-pointer justify-center px-8px py-4px">
      <NAvatar :size="30" round :style="{ backgroundColor: '#F7E3E4', color: '#A81C24' }">
        <span class="text-13px font-bold">{{ authStore.userInfo.userName.slice(0, 1) }}</span>
      </NAvatar>
    </div>
  </NDropdown>
</template>

<style scoped></style>

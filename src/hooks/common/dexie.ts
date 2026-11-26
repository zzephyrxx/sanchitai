/**
 * Dexie liveQuery → Vue 响应式 ref
 *
 * 用法：const members = useDexieLive(() => db.members.toArray(), []);
 * 任何对该表的写入都会自动推送最新结果，无需手动 reload。
 */
import { onScopeDispose, ref } from 'vue';
import type { Ref } from 'vue';
import { liveQuery } from 'dexie';

export function useDexieLive<T>(querier: () => Promise<T> | T, initial: T): Ref<T> {
  const data = ref(initial) as Ref<T>;

  const subscription = liveQuery(querier).subscribe({
    next: value => {
      data.value = value;
    },
    error: err => {
      // eslint-disable-next-line no-console
      console.error('[dexie-live]', err);
    }
  });

  onScopeDispose(() => {
    subscription.unsubscribe();
  });

  return data;
}

import { computed, reactive, ref } from 'vue';
import { defineStore } from 'pinia';
import { SetupStoreId } from '@/enum';

/**
 * 三尺台：本地单机用户
 *
 * 纯离线工作台，无账号体系、无网络请求。
 * 保留 roles=['R_SUPER'] 以复用底座 static 模式的超管放行逻辑。
 */
export const useAuthStore = defineStore(SetupStoreId.Auth, () => {
  const token = ref('local');

  const userInfo: Api.Auth.UserInfo = reactive({
    userId: 'local',
    userName: '支部书记',
    roles: ['R_SUPER'],
    buttons: []
  });

  /** is super role in static route */
  const isStaticSuper = computed(() => {
    const { VITE_AUTH_ROUTE_MODE, VITE_STATIC_SUPER_ROLE } = import.meta.env;

    return VITE_AUTH_ROUTE_MODE === 'static' && userInfo.roles.includes(VITE_STATIC_SUPER_ROLE);
  });

  /** Is login：单机恒为 true */
  const isLogin = computed(() => true);

  const loginLoading = ref(false);

  /** Login（单机版占位：登录页不可达，仅保留方法签名兼容底座组件） */
  async function login(_userName?: string, _password?: string, _redirect = true) {
    // no-op：三尺台为本地单机应用，无需登录
  }

  /** Reset auth store（单机无登出，空操作） */
  function resetStore() {
    // no-op
  }

  async function initUserInfo() {
    // no-op：本地用户无需拉取
  }

  return {
    token,
    userInfo,
    isStaticSuper,
    isLogin,
    loginLoading,
    login,
    resetStore,
    initUserInfo
  };
});

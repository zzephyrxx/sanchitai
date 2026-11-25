import { computed, effectScope, onScopeDispose, ref, toRefs, watch } from 'vue';
import type { Ref } from 'vue';
import { useDateFormat, useEventListener, useNow, usePreferredColorScheme } from '@vueuse/core';
import { defineStore } from 'pinia';
import { getPaletteColorByNumber } from '@sa/color';
import { localStg } from '@/utils/storage';
import { SetupStoreId } from '@/enum';
import { useAuthStore } from '../auth';
import {
  addThemeVarsToGlobal,
  createThemeToken,
  getNaiveTheme,
  initThemeSettings,
  toggleAuxiliaryColorModes,
  toggleCssDarkMode
} from './shared';

/** Theme store */
export const useThemeStore = defineStore(SetupStoreId.Theme, () => {
  const scope = effectScope();
  const osTheme = usePreferredColorScheme();
  const authStore = useAuthStore();

  /** Theme settings */
  const settings: Ref<App.Theme.ThemeSetting> = ref(initThemeSettings());

  /** Optional NaiveUI theme overrides from preset */
  const naiveThemeOverrides: Ref<App.Theme.NaiveUIThemeOverride | undefined> = ref(undefined);

  /** Watermark time instance with controls */
  const { now: watermarkTime, pause: pauseWatermarkTime, resume: resumeWatermarkTime } = useNow({ controls: true });

  /** Dark mode */
  const darkMode = computed(() => {
    if (settings.value.themeScheme === 'auto') {
      return osTheme.value === 'dark';
    }
    return settings.value.themeScheme === 'dark';
  });

  /** grayscale mode */
  const grayscaleMode = computed(() => settings.value.grayscale);

  /** colourWeakness mode */
  const colourWeaknessMode = computed(() => settings.value.colourWeakness);

  const PRESET_PRIMARY_DEFAULTS: Record<UnionKey.ThemePreset, { light: string; dark: string }> = {
    default: { light: '#2B2926', dark: '#4F6EF7' },
    'crm-frosted-glass': { light: '#1E6B4B', dark: '#34B37E' }
  };

  const BUILTIN_PRIMARY_SET = new Set(['#2B2926', '#4F6EF7', '#1E5C42', '#2D8660', '#1E6B4B', '#34B37E']);

  function getPresetDefaultPrimary(preset: UnionKey.ThemePreset, isDark: boolean): string {
    const key: UnionKey.ThemePreset = preset === 'crm-frosted-glass' ? 'crm-frosted-glass' : 'default';
    return PRESET_PRIMARY_DEFAULTS[key][isDark ? 'dark' : 'light'];
  }

  /**
   * Theme colors：完全尊重用户在主题配置中自定义的 themeColor / otherColor；
   * 仅在切换皮肤或深浅模式且当前仍处于内置默认色时，自动匹配对应皮肤默认主色。
   */
  const themeColors = computed(() => {
    const { themeColor, otherColor, isInfoFollowPrimary } = settings.value;
    const primary = themeColor || getPresetDefaultPrimary(settings.value.themePreset ?? 'default', darkMode.value);

    const colors: App.Theme.ThemeColor = {
      primary,
      ...otherColor,
      info: isInfoFollowPrimary ? primary : otherColor.info
    };
    return colors;
  });

  // 迁移旧缓存：旧版切电子纸或深色时未同步写回 settings.themeColor，启动时若为内置旧默认色则自动对齐当前皮肤/深浅默认色
  (() => {
    const cur = (settings.value.themeColor || '').toUpperCase();
    const preset: UnionKey.ThemePreset =
      settings.value.themePreset === 'crm-frosted-glass' ? 'crm-frosted-glass' : 'default';
    if (!cur || BUILTIN_PRIMARY_SET.has(cur)) {
      settings.value.themeColor = getPresetDefaultPrimary(preset, darkMode.value);
    }
  })();

  /** 按当前 preset 动态覆盖 layout/container/base-text 表面 token */
  const effectiveTokens = computed<App.Theme.ThemeSetting['tokens']>(() => {
    const preset: UnionKey.ThemePreset =
      settings.value.themePreset === 'crm-frosted-glass' ? 'crm-frosted-glass' : 'default';
    const base = settings.value.tokens;
    if (preset === 'crm-frosted-glass') {
      return {
        light: {
          ...base.light,
          colors: {
            container: 'rgb(251, 250, 246)',
            layout: 'rgb(244, 242, 236)',
            inverted: 'rgb(22, 21, 15)',
            'base-text': 'rgb(22, 21, 15)'
          }
        },
        dark: {
          ...base.dark,
          colors: {
            container: 'rgb(28, 27, 22)',
            layout: 'rgb(20, 19, 15)',
            inverted: 'rgb(38, 36, 29)',
            'base-text': 'rgb(244, 242, 236)'
          }
        }
      };
    }
    return base;
  });

  /** Naive theme */
  const naiveTheme = computed(() => getNaiveTheme(themeColors.value, settings.value, naiveThemeOverrides.value));

  /**
   * Settings json
   *
   * It is for copy settings
   */
  const settingsJson = computed(() => JSON.stringify(settings.value));

  /** Watermark time date formatter */
  const formattedWatermarkTime = computed(() => {
    const { watermark } = settings.value;
    const date = useDateFormat(watermarkTime, watermark.timeFormat);
    return date.value;
  });

  /** Watermark content */
  const watermarkContent = computed(() => {
    const { watermark } = settings.value;

    if (watermark.enableUserName && authStore.userInfo.userName) {
      return authStore.userInfo.userName;
    }

    if (watermark.enableTime) {
      return formattedWatermarkTime.value;
    }

    return watermark.text;
  });

  /** Reset store */
  function resetStore() {
    const themeStore = useThemeStore();

    themeStore.$reset();
  }

  /**
   * Set theme scheme
   *
   * @param themeScheme
   */
  function setThemeScheme(themeScheme: UnionKey.ThemeScheme) {
    settings.value.themeScheme = themeScheme;
  }

  /**
   * Toggle theme scheme（圆形扩散）
   *
   * @param [event] 触发事件
   */
  function toggleThemeSchemeWithTransition(event?: MouseEvent) {
    const themeSchemes: UnionKey.ThemeScheme[] = ['light', 'dark'];
    const currentIndex = themeSchemes.findIndex(item => item === settings.value.themeScheme);
    const next = themeSchemes[(currentIndex + 1) % themeSchemes.length];

    applyViewTransition(() => {
      setThemeScheme(next);
    }, event);
  }

  /**
   * Set grayscale value
   *
   * @param isGrayscale
   */
  function setGrayscale(isGrayscale: boolean) {
    settings.value.grayscale = isGrayscale;
  }

  /**
   * Set colourWeakness value
   *
   * @param isColourWeakness
   */
  function setColourWeakness(isColourWeakness: boolean) {
    settings.value.colourWeakness = isColourWeakness;
  }

  const SANS_FONT_STACKS: Record<UnionKey.ThemeFontSans, string> = {
    system:
      "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
    pingfang: "'PingFang SC', 'Hiragino Sans GB', -apple-system, BlinkMacSystemFont, sans-serif",
    yahei: "'Microsoft YaHei UI', 'Microsoft YaHei', 'Segoe UI', sans-serif",
    harmony: "'HarmonyOS Sans SC', 'MiSans', 'Alibaba PuHuiTi 3.0', 'PingFang SC', sans-serif",
    'noto-sans': "'Noto Sans SC', 'Source Han Sans SC', 'Source Han Sans CN', 'PingFang SC', sans-serif",
    inter: "'Inter', 'SF Pro Text', 'Segoe UI', 'Roboto', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    georgia: "'Georgia', 'Times New Roman', 'Noto Serif SC', 'Songti SC', serif",
    songti: "'Songti SC', 'STSong', 'Noto Serif SC', 'Source Han Serif SC', 'SimSun', serif",
    kaiti: "'Kaiti SC', 'STKaiti', 'KaiTi', 'AR PL UKai CN', serif",
    fangsong: "'FangSong_GB2312', 'STFangsong', 'FangSong', 'Songti SC', serif"
  };

  const HEADING_FONT_STACKS: Record<UnionKey.ThemeFontHeading, string> = {
    'follow-sans': 'var(--sct-font-sans)',
    songti: "'Songti SC', 'STSong', 'Noto Serif SC', 'SimSun', serif",
    kaiti: "'Kaiti SC', 'STKaiti', 'KaiTi', serif",
    fangsong: "'FangSong_GB2312', 'STFangsong', 'FangSong', serif",
    heiti: "'PingFang SC', 'Heiti SC', 'STHeiti', 'Microsoft YaHei', sans-serif",
    georgia: "'Georgia', 'Instrument Serif', 'Times New Roman', 'Songti SC', serif",
    inter: "'Inter', 'SF Pro Display', 'Helvetica Neue', 'PingFang SC', sans-serif"
  };

  const MONO_FONT_STACKS: Record<UnionKey.ThemeFontMono, string> = {
    'ibm-plex': "'IBM Plex Mono', 'SF Mono', 'JetBrains Mono', ui-monospace, Menlo, monospace",
    jetbrains: "'JetBrains Mono', 'Fira Code', 'SF Mono', ui-monospace, Menlo, monospace",
    'fira-code': "'Fira Code', 'JetBrains Mono', 'Cascadia Code', ui-monospace, monospace",
    'sf-mono': "'SF Mono', 'Menlo', 'Monaco', ui-monospace, monospace",
    consolas: "'Consolas', 'Cascadia Mono', 'Courier New', ui-monospace, monospace",
    'source-code': "'Source Code Pro', 'Ubuntu Mono', 'DejaVu Sans Mono', ui-monospace, monospace"
  };

  /**
   * 将三类全局字体（正文 / 标题 / 等宽数字）及全局缩放比例同步到 html/body
   * 注意：严禁在 html/body 上使用 CSS `zoom`（会导致 Vueuc VFollower / Floating Popover 坐标计算与实际渲染脱节而错位），
   * 改为同步 `--sct-font-scale` 并在 `getNaiveTheme` + `sct-theme.css` 中按比例缩放全部字号。
   */
  function applyFontVars() {
    if (!settings.value.fontConfig) {
      settings.value.fontConfig = {
        sans: 'system',
        heading: 'follow-sans',
        mono: 'ibm-plex',
        scale: 100
      };
    }
    if (typeof settings.value.fontConfig.scale !== 'number' || Number.isNaN(settings.value.fontConfig.scale)) {
      settings.value.fontConfig.scale = 100;
    }
    const { sans, heading, mono, scale } = settings.value.fontConfig;
    const sansStack = SANS_FONT_STACKS[sans] ?? SANS_FONT_STACKS.system;
    const headingStack = heading === 'follow-sans' ? sansStack : (HEADING_FONT_STACKS[heading] ?? sansStack);
    const monoStack = MONO_FONT_STACKS[mono] ?? MONO_FONT_STACKS['ibm-plex'];
    const clampedScale = Math.min(150, Math.max(85, scale));
    const ratio = clampedScale / 100;
    // 对党员发展泳道与党费表格额外增加约 10% 的缩放响应幅度
    const boostedRatio = ratio === 1 ? 1 : Number((1 + (ratio - 1) * 1.1).toFixed(3));

    const rootStyle = document.documentElement.style;
    rootStyle.removeProperty('zoom');
    rootStyle.setProperty('--sct-font-sans', sansStack);
    rootStyle.setProperty('--sct-font-heading', headingStack);
    rootStyle.setProperty('--sct-font-mono', monoStack);
    rootStyle.setProperty('--sct-font-scale', String(ratio));
    rootStyle.setProperty('--sct-font-scale-boost', String(boostedRatio));
    rootStyle.setProperty('font-size', `${Math.round(16 * ratio * 100) / 100}px`);
  }

  /** 应用界面密度标记（紧凑 / 舒适 / 宽松） */
  function applyDensityAttr() {
    const raw = settings.value.density;
    const density: UnionKey.ThemeDensity = raw === 'compact' || raw === 'loose' ? raw : 'comfortable';
    if (raw !== density) {
      settings.value.density = density;
    }
    document.documentElement.dataset.density = density;
    const scaleMap: Record<UnionKey.ThemeDensity, number> = {
      compact: 0.78,
      comfortable: 1,
      loose: 1.24
    };
    document.documentElement.style.setProperty('--sct-density-scale', String(scaleMap[density]));
  }

  function setDensity(density: UnionKey.ThemeDensity) {
    settings.value.density = density;
    applyDensityAttr();
    cacheThemeSettings();
  }

  /**
   * 应用主题皮肤标记（驱动 --sct-* 表面变量）
   */
  function applyPresetAttr() {
    const raw = settings.value.themePreset;
    const preset: UnionKey.ThemePreset = raw === 'crm-frosted-glass' ? 'crm-frosted-glass' : 'default';
    if (raw !== preset) {
      settings.value.themePreset = preset;
    }
    document.documentElement.dataset.preset = preset;
  }

  /**
   * 设置主题皮肤（圆形扩散切换）
   *
   * @param preset 主题皮肤
   * @param [event] 触发事件（用于 View Transitions 圆形扩散起点）
   */
  function setThemePreset(preset: UnionKey.ThemePreset, event?: MouseEvent) {
    applyViewTransition(() => {
      const normalized: UnionKey.ThemePreset = preset === 'crm-frosted-glass' ? 'crm-frosted-glass' : 'default';
      settings.value.themePreset = normalized;
      settings.value.themeRadius = normalized === 'crm-frosted-glass' ? 0 : 6;
      settings.value.themeColor = getPresetDefaultPrimary(normalized, darkMode.value);
      if (normalized === 'crm-frosted-glass') {
        settings.value.otherColor.warning = '#B7791F';
        settings.value.otherColor.success = '#1E6B4B';
      } else {
        settings.value.otherColor.warning = '#faad14';
        settings.value.otherColor.success = '#52c41a';
      }
      applyPresetAttr();
      setupThemeVarsToGlobal();
      cacheThemeSettings();
    }, event);
  }

  /** 恢复当前皮肤与深浅模式下的默认配色 */
  function resetPresetColors() {
    const normalized: UnionKey.ThemePreset =
      settings.value.themePreset === 'crm-frosted-glass' ? 'crm-frosted-glass' : 'default';
    settings.value.themeColor = getPresetDefaultPrimary(normalized, darkMode.value);
    if (normalized === 'crm-frosted-glass') {
      settings.value.otherColor = {
        info: '#16150F',
        success: '#1E6B4B',
        warning: '#B7791F',
        error: '#A81C24'
      };
    } else {
      settings.value.otherColor = {
        info: '#2080f0',
        success: '#52c41a',
        warning: '#faad14',
        error: '#d43030'
      };
    }
    setupThemeVarsToGlobal();
    cacheThemeSettings();
  }

  /**
   * View Transitions 圆形扩散包装：从点击位置扩散切换；不支持时降级为即时切换
   */
  function applyViewTransition(mutate: () => void, event?: MouseEvent) {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };

    if (!doc.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      mutate();
      return;
    }

    const x = event?.clientX ?? window.innerWidth - 40;
    const y = event?.clientY ?? 40;
    const endRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));

    const transition = doc.startViewTransition(() => {
      mutate();
    });

    transition.ready
      .then(() => {
        document.documentElement.animate(
          {
            clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`]
          },
          {
            duration: 450,
            easing: 'ease-in-out',
            pseudoElement: '::view-transition-new(root)'
          }
        );
      })
      .catch(() => {
        /* 过渡被打断时忽略 */
      });
  }

  /** Toggle theme scheme */
  function toggleThemeScheme() {
    const themeSchemes: UnionKey.ThemeScheme[] = ['light', 'dark', 'auto'];

    const index = themeSchemes.findIndex(item => item === settings.value.themeScheme);

    const nextIndex = index === themeSchemes.length - 1 ? 0 : index + 1;

    const nextThemeScheme = themeSchemes[nextIndex];

    setThemeScheme(nextThemeScheme);
  }

  /**
   * Update theme colors
   *
   * @param key Theme color key
   * @param color Theme color
   */
  function updateThemeColors(key: App.Theme.ThemeColorKey, color: string) {
    let colorValue = color;

    if (settings.value.recommendColor) {
      // get a color palette by provided color and color name, and use the suitable color

      colorValue = getPaletteColorByNumber(color, 500, true);
    }

    if (key === 'primary') {
      settings.value.themeColor = colorValue;
    } else {
      settings.value.otherColor[key] = colorValue;
    }
  }

  /**
   * Set theme layout
   *
   * @param mode Theme layout mode
   */
  function setThemeLayout(mode: UnionKey.ThemeLayoutMode) {
    settings.value.layout.mode = mode;
  }

  /** Setup theme vars to global */
  function setupThemeVarsToGlobal() {
    const { themeTokens, darkThemeTokens } = createThemeToken(
      themeColors.value,
      effectiveTokens.value,
      settings.value.recommendColor
    );
    addThemeVarsToGlobal(themeTokens, darkThemeTokens);
    // 同步全局强调色变量 --sct-accent，使电子纸与自定义组件的强调色实时跟随用户所选主色
    document.documentElement.style.setProperty('--sct-accent', themeColors.value.primary);
  }

  /**
   * Set watermark enable user name
   *
   * @param enable Whether to enable user name watermark
   */
  function setWatermarkEnableUserName(enable: boolean) {
    settings.value.watermark.enableUserName = enable;

    if (enable) {
      settings.value.watermark.enableTime = false;
    }
  }

  /**
   * Set watermark enable time
   *
   * @param enable Whether to enable time watermark
   */
  function setWatermarkEnableTime(enable: boolean) {
    settings.value.watermark.enableTime = enable;

    if (enable) {
      settings.value.watermark.enableUserName = false;
    }
  }

  /**
   * Set NaiveUI theme overrides
   *
   * @param overrides NaiveUI theme overrides or undefined to clear
   */
  function setNaiveThemeOverrides(overrides?: App.Theme.NaiveUIThemeOverride) {
    naiveThemeOverrides.value = overrides;
  }

  /** Only run timer when watermark is visible and time display is enabled */
  function updateWatermarkTimer() {
    const { watermark } = settings.value;
    const shouldRunTimer = watermark.visible && watermark.enableTime;

    if (shouldRunTimer) {
      resumeWatermarkTime();
    } else {
      pauseWatermarkTime();
    }
  }

  /** Cache theme settings（始终持久化到 localStorage，防止刷新页面丢失主题/字体/圆角等用户配置） */
  function cacheThemeSettings() {
    localStg.set('themeSettings', settings.value);
  }

  // cache theme settings when page is closed or refreshed
  useEventListener(window, 'beforeunload', () => {
    cacheThemeSettings();
  });

  // 深度监听 settings 任意改动并即时持久化到 localStorage
  watch(
    settings,
    () => {
      cacheThemeSettings();
    },
    { deep: true }
  );

  // watch store
  scope.run(() => {
    // watch dark mode
    watch(
      darkMode,
      val => {
        toggleCssDarkMode(val);
        localStg.set('darkMode', val);
        const cur = (settings.value.themeColor || '').toUpperCase();
        if (!cur || BUILTIN_PRIMARY_SET.has(cur)) {
          const preset: UnionKey.ThemePreset =
            settings.value.themePreset === 'crm-frosted-glass' ? 'crm-frosted-glass' : 'default';
          settings.value.themeColor = getPresetDefaultPrimary(preset, val);
        }
      },
      { immediate: true }
    );

    watch(
      [grayscaleMode, colourWeaknessMode],
      val => {
        toggleAuxiliaryColorModes(val[0], val[1]);
      },
      { immediate: true }
    );

    // themeColors change, update css vars and storage theme color
    watch(
      themeColors,
      val => {
        setupThemeVarsToGlobal();
        localStg.set('themeColor', val.primary);
      },
      { immediate: true }
    );

    // watch watermark settings to control timer
    watch(
      () => [settings.value.watermark.visible, settings.value.watermark.enableTime],
      () => {
        updateWatermarkTimer();
      },
      { immediate: true }
    );
  });

  /** On scope dispose */
  onScopeDispose(() => {
    scope.stop();
  });

  // 应用皮肤标记
  watch(
    () => settings.value.themePreset,
    () => {
      applyPresetAttr();
    },
    { immediate: true }
  );

  // 应用界面密度标记
  watch(
    () => settings.value.density,
    () => {
      applyDensityAttr();
      cacheThemeSettings();
    },
    { immediate: true }
  );

  // 应用全局字体配置（正文 / 标题 / 等宽数字）
  watch(
    () => settings.value.fontConfig,
    () => {
      applyFontVars();
      cacheThemeSettings();
    },
    { deep: true, immediate: true }
  );

  return {
    ...toRefs(settings.value),
    darkMode,
    themeColors,
    naiveTheme,
    settingsJson,
    watermarkContent,
    setGrayscale,
    setColourWeakness,
    resetStore,
    setThemeScheme,
    toggleThemeScheme,
    toggleThemeSchemeWithTransition,
    setThemePreset,
    setDensity,
    resetPresetColors,
    updateThemeColors,
    setThemeLayout,
    setWatermarkEnableUserName,
    setWatermarkEnableTime,
    setNaiveThemeOverrides
  };
});

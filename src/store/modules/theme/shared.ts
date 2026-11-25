import type { GlobalThemeOverrides } from 'naive-ui';
import { defu } from 'defu';
import { addColorAlpha, getColorPalette, getPaletteColorByNumber, getRgb } from '@sa/color';
import { DARK_CLASS } from '@/constants/app';
import { toggleHtmlClass } from '@/utils/common';
import { localStg } from '@/utils/storage';
import { overrideThemeSettings, themeSettings } from '@/theme/settings';
import { themeVars } from '@/theme/vars';

/** Init theme settings（开发与生产环境均持久化用户主题与字体设置，刷新页面不丢失） */
export function initThemeSettings() {
  const localSettings = localStg.get('themeSettings');

  let settings = defu(localSettings, themeSettings);

  // 确保旧缓存下也默认开启顶栏多语言切换与全局搜索入口
  if (settings.header) {
    settings.header.multilingual = { visible: true };
    settings.header.globalSearch = { visible: true };
  }

  const isOverride = localStg.get('overrideThemeFlag') === BUILD_TIME;

  if (!isOverride) {
    settings = defu(overrideThemeSettings, settings);

    localStg.set('overrideThemeFlag', BUILD_TIME);
  }

  return settings;
}

/**
 * create theme token css vars value by theme settings
 *
 * @param colors Theme colors
 * @param tokens Theme setting tokens
 * @param [recommended=false] Use recommended color. Default is `false`
 */
export function createThemeToken(
  colors: App.Theme.ThemeColor,
  tokens?: App.Theme.ThemeSetting['tokens'],
  recommended = false
) {
  const paletteColors = createThemePaletteColors(colors, recommended);

  const { light, dark } = tokens || themeSettings.tokens;

  const themeTokens: App.Theme.ThemeTokenCSSVars = {
    colors: {
      ...paletteColors,
      nprogress: paletteColors.primary,
      ...light.colors
    },
    boxShadow: {
      ...light.boxShadow
    }
  };

  const darkThemeTokens: App.Theme.ThemeTokenCSSVars = {
    colors: {
      ...themeTokens.colors,
      ...dark?.colors
    },
    boxShadow: {
      ...themeTokens.boxShadow,
      ...dark?.boxShadow
    }
  };

  return {
    themeTokens,
    darkThemeTokens
  };
}

/**
 * Create theme palette colors
 *
 * @param colors Theme colors
 * @param [recommended=false] Use recommended color. Default is `false`
 */
function createThemePaletteColors(colors: App.Theme.ThemeColor, recommended = false) {
  const colorKeys = Object.keys(colors) as App.Theme.ThemeColorKey[];
  const colorPaletteVar = {} as App.Theme.ThemePaletteColor;

  colorKeys.forEach(key => {
    const colorMap = getColorPalette(colors[key], recommended);

    colorPaletteVar[key] = colorMap.get(500)!;

    colorMap.forEach((hex, number) => {
      colorPaletteVar[`${key}-${number}`] = hex;
    });
  });

  return colorPaletteVar;
}

/**
 * Get css var by tokens
 *
 * @param tokens Theme base tokens
 */
function getCssVarByTokens(tokens: App.Theme.BaseToken) {
  const styles: string[] = [];

  function removeVarPrefix(value: string) {
    return value.replace('var(', '').replace(')', '');
  }

  function removeRgbPrefix(value: string) {
    return value.replace('rgb(', '').replace(')', '');
  }

  for (const [key, tokenValues] of Object.entries(themeVars)) {
    for (const [tokenKey, tokenValue] of Object.entries(tokenValues)) {
      let cssVarsKey = removeVarPrefix(tokenValue);
      let cssValue = tokens[key][tokenKey];

      if (key === 'colors') {
        cssVarsKey = removeRgbPrefix(cssVarsKey);
        const { r, g, b } = getRgb(cssValue);
        cssValue = `${r} ${g} ${b}`;
      }

      styles.push(`${cssVarsKey}: ${cssValue}`);
    }
  }

  const styleStr = styles.join(';');

  return styleStr;
}

/**
 * Add theme vars to global
 *
 * @param tokens
 */
export function addThemeVarsToGlobal(tokens: App.Theme.BaseToken, darkTokens: App.Theme.BaseToken) {
  const cssVarStr = getCssVarByTokens(tokens);
  const darkCssVarStr = getCssVarByTokens(darkTokens);

  const css = `
    :root {
      ${cssVarStr}
    }
  `;

  const darkCss = `
    html.${DARK_CLASS} {
      ${darkCssVarStr}
    }
  `;

  const styleId = 'theme-vars';

  const style = document.querySelector(`#${styleId}`) || document.createElement('style');

  style.id = styleId;

  style.textContent = css + darkCss;

  document.head.appendChild(style);
}

/**
 * Toggle css dark mode
 *
 * @param darkMode Is dark mode
 */
export function toggleCssDarkMode(darkMode = false) {
  const { add, remove } = toggleHtmlClass(DARK_CLASS);

  if (darkMode) {
    add();
  } else {
    remove();
  }
}

/**
 * Toggle auxiliary color modes
 *
 * @param grayscaleMode
 * @param colourWeakness
 */
export function toggleAuxiliaryColorModes(grayscaleMode = false, colourWeakness = false) {
  const htmlElement = document.documentElement;
  const filterValue = [grayscaleMode ? 'grayscale(100%)' : '', colourWeakness ? 'invert(80%)' : '']
    .filter(Boolean)
    .join(' ');
  if (filterValue) {
    htmlElement.style.filter = filterValue;
  } else {
    htmlElement.style.removeProperty('filter');
  }
}

type NaiveColorScene = '' | 'Suppl' | 'Hover' | 'Pressed' | 'Active';
type NaiveColorKey = `${App.Theme.ThemeColorKey}Color${NaiveColorScene}`;
type NaiveThemeColor = Partial<Record<NaiveColorKey, string>>;
interface NaiveColorAction {
  scene: NaiveColorScene;
  handler: (color: string) => string;
}

/**
 * Get naive theme colors
 *
 * @param colors Theme colors
 * @param [recommended=false] Use recommended color. Default is `false`
 */
function getNaiveThemeColors(colors: App.Theme.ThemeColor, recommended = false) {
  const colorActions: NaiveColorAction[] = [
    { scene: '', handler: color => color },
    { scene: 'Suppl', handler: color => color },
    { scene: 'Hover', handler: color => getPaletteColorByNumber(color, 500, recommended) },
    { scene: 'Pressed', handler: color => getPaletteColorByNumber(color, 700, recommended) },
    { scene: 'Active', handler: color => addColorAlpha(color, 0.1) }
  ];

  const themeColors: NaiveThemeColor = {};

  const colorEntries = Object.entries(colors) as [App.Theme.ThemeColorKey, string][];

  colorEntries.forEach(color => {
    colorActions.forEach(action => {
      const [colorType, colorValue] = color;
      const colorKey: NaiveColorKey = `${colorType}Color${action.scene}`;
      themeColors[colorKey] = action.handler(colorValue);
    });
  });

  return themeColors;
}

/**
 * Get naive theme
 *
 * @param colors Theme colors
 * @param settings Theme settings object
 * @param overrides Optional manual overrides from preset
 */
export function getNaiveTheme(
  colors: App.Theme.ThemeColor,
  settings: App.Theme.ThemeSetting,
  overrides?: GlobalThemeOverrides
) {
  const { primary: colorLoading } = colors;
  const rawScale = settings.fontConfig?.scale;
  const scaleRatio =
    typeof rawScale === 'number' && !Number.isNaN(rawScale) ? Math.min(150, Math.max(85, rawScale)) / 100 : 1;
  const px = (base: number) => `${Math.round(base * scaleRatio * 10) / 10}px`;
  const isEPaper = settings.themePreset === 'crm-frosted-glass';
  const density = settings.density ?? 'comfortable';
  const cardPad =
    density === 'compact'
      ? { sm: '8px 12px 8px 12px', md: '10px 14px 10px 14px', lg: '12px 16px 12px 16px', hu: '14px 18px 14px 18px' }
      : density === 'loose'
        ? { sm: '18px 22px 18px 22px', md: '22px 26px 22px 26px', lg: '24px 30px 24px 30px', hu: '28px 34px 28px 34px' }
        : isEPaper
          ? {
              sm: '16px 16px 14px 16px',
              md: '18px 20px 18px 20px',
              lg: '20px 24px 20px 24px',
              hu: '24px 28px 24px 28px'
            }
          : {
              sm: '12px 16px 12px 16px',
              md: '16px 20px 18px 20px',
              lg: '18px 24px 20px 24px',
              hu: '20px 28px 24px 28px'
            };
  const tableCellPad =
    density === 'compact'
      ? { sm: '5px 8px', md: '7px 10px', lg: '9px 12px' }
      : density === 'loose'
        ? { sm: '12px 14px', md: '14px 16px', lg: '16px 18px' }
        : { sm: '8px 10px', md: '10px 12px', lg: '12px 14px' };

  const theme: GlobalThemeOverrides = {
    common: {
      ...getNaiveThemeColors(colors, settings.recommendColor),
      borderRadius: isEPaper ? '0px' : '6px',
      fontSize: px(14),
      fontSizeMini: px(12),
      fontSizeTiny: px(12),
      fontSizeSmall: px(13),
      fontSizeMedium: px(14),
      fontSizeLarge: px(15),
      fontSizeHuge: px(16)
    },
    Card: {
      paddingSmall: cardPad.sm,
      paddingMedium: cardPad.md,
      paddingLarge: cardPad.lg,
      paddingHuge: cardPad.hu
    },
    DataTable: {
      tdPaddingSmall: tableCellPad.sm,
      thPaddingSmall: tableCellPad.sm,
      tdPaddingMedium: tableCellPad.md,
      thPaddingMedium: tableCellPad.md,
      tdPaddingLarge: tableCellPad.lg,
      thPaddingLarge: tableCellPad.lg
    },
    Button: {
      textColorPrimary: '#ffffff',
      textColorHoverPrimary: '#ffffff',
      textColorPressedPrimary: '#ffffff',
      textColorFocusPrimary: '#ffffff',
      textColorDisabledPrimary: '#ffffff',
      textColorInfo: '#ffffff',
      textColorHoverInfo: '#ffffff',
      textColorPressedInfo: '#ffffff',
      textColorFocusInfo: '#ffffff',
      textColorDisabledInfo: '#ffffff',
      textColorSuccess: '#ffffff',
      textColorHoverSuccess: '#ffffff',
      textColorPressedSuccess: '#ffffff',
      textColorFocusSuccess: '#ffffff',
      textColorDisabledSuccess: '#ffffff',
      textColorWarning: '#ffffff',
      textColorHoverWarning: '#ffffff',
      textColorPressedWarning: '#ffffff',
      textColorFocusWarning: '#ffffff',
      textColorDisabledWarning: '#ffffff',
      textColorError: '#ffffff',
      textColorHoverError: '#ffffff',
      textColorPressedError: '#ffffff',
      textColorFocusError: '#ffffff',
      textColorDisabledError: '#ffffff'
    },
    LoadingBar: {
      colorLoading
    },
    Tag: {
      borderRadius: `${settings.themeRadius}px`
    }
  };

  // If there are overrides, merge them with priority
  // overrides has higher priority than auto-generated theme
  return overrides ? defu(overrides, theme) : theme;
}

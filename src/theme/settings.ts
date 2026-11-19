/** Default theme settings */
export const themeSettings: App.Theme.ThemeSetting = {
  themeScheme: 'light',
  grayscale: false,
  colourWeakness: false,
  recommendColor: false,
  // 主色改用墨色（中式简约：红仅作点睛/语义色，不再全局铺开）
  themeColor: '#2B2926',
  themeRadius: 6,
  otherColor: {
    info: '#2080f0',
    success: '#52c41a',
    warning: '#faad14',
    error: '#d43030'
  },
  isInfoFollowPrimary: false,
  layout: {
    mode: 'vertical',
    scrollMode: 'content'
  },
  page: {
    // 简约优先：关闭页面切换动画（也避免非可见窗口/系统级 reduced motion 下过渡冻结）
    animate: false,
    animateMode: 'fade-slide'
  },
  header: {
    height: 56,
    breadcrumb: {
      visible: true,
      showIcon: true
    },
    multilingual: {
      visible: false
    },
    globalSearch: {
      visible: false
    }
  },
  tab: {
    visible: false,
    cache: true,
    height: 44,
    mode: 'chrome',
    closeTabByMiddleClick: false
  },
  fixedHeaderAndTab: true,
  sider: {
    inverted: false,
    width: 220,
    collapsedWidth: 64,
    mixWidth: 90,
    mixCollapsedWidth: 64,
    mixChildMenuWidth: 200,
    autoSelectFirstMenu: false
  },
  footer: {
    visible: false,
    fixed: false,
    height: 48,
    right: true
  },
  watermark: {
    visible: false,
    text: '三尺台',
    enableUserName: false,
    enableTime: false,
    timeFormat: 'YYYY-MM-DD HH:mm'
  },
  tokens: {
    light: {
      colors: {
        container: 'rgb(255, 255, 255)',
        layout: 'rgb(250, 248, 244)',
        inverted: 'rgb(26, 26, 28)',
        'base-text': 'rgb(43, 43, 43)'
      },
      boxShadow: {
        header: '0 1px 2px rgb(64, 40, 40, 0.05)',
        sider: '1px 0 4px 0 rgb(64, 40, 40, 0.04)',
        tab: '0 1px 2px rgb(64, 40, 40, 0.05)'
      }
    },
    dark: {
      colors: {
        container: 'rgb(28, 28, 28)',
        layout: 'rgb(18, 18, 18)',
        'base-text': 'rgb(224, 224, 224)'
      }
    }
  }
};

/**
 * Override theme settings
 *
 * If publish new version, use `overrideThemeSettings` to override certain theme settings
 */
export const overrideThemeSettings: Partial<App.Theme.ThemeSetting> = {};

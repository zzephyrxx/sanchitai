<script setup lang="ts">
/**
 * 统计总览 vue-data-ui 创意可视化组件集（v0.2.7）
 * - 统一响应「墨韵 / KONTUR 电子纸」双皮肤与「深 / 浅」四态配色
 * - 6 套组件：
 *   1. healthRadar      : 支部党建健康五维雷达（VueUiRadar）
 *   2. pointsGauge      : 党员积分 60+40 仪表盘 + 履职三项均分（VueUiGauge）
 *   3. volunteerDonut   : 志愿服务时长来源环 + 志愿之星 Top 3（VueUiDonut）
 *   4. lifecycleWaffle  : 成员全生命周期与转接态方格矩阵（VueUiWaffle）
 *   5. talksThermometer : 年度谈心谈话覆盖温度计 + 待谈提醒（VueUiThermometer）
 *   6. groupOnion       : 党小组综合活力同心环（VueUiOnion）
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { VueUiDonut, VueUiGauge, VueUiOnion, VueUiRadar, VueUiThermometer, VueUiWaffle } from 'vue-data-ui';
import type {
  VueUiDonutConfig,
  VueUiDonutDatasetItem,
  VueUiGaugeConfig,
  VueUiGaugeDataset,
  VueUiOnionConfig,
  VueUiOnionDatasetItem,
  VueUiRadarConfig,
  VueUiRadarDataset,
  VueUiThermometerConfig,
  VueUiThermometerDataset,
  VueUiWaffleConfig,
  VueUiWaffleDatasetItem
} from 'vue-data-ui';
import 'vue-data-ui/style.css';
import dayjs from 'dayjs';
import { getMemberLifecycle } from '@/constants/workspace-presets';
import { computeMemberYearPoints, formatScore, roundScore } from '@/utils/party-points';
import { roundHours } from '@/utils/volunteer';
import { useThemeStore } from '@/store/modules/theme';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useSctI18n } from '@/hooks/common/sct-i18n';

defineOptions({ name: 'DashboardVduiWidgets' });

export type VduiWidgetId =
  | 'healthRadar'
  | 'pointsGauge'
  | 'volunteerDonut'
  | 'lifecycleWaffle'
  | 'talksThermometer'
  | 'groupOnion';

defineProps<{
  widgetId: VduiWidgetId;
}>();

const router = useRouter();
const workStore = useWorkDataStore();
const themeStore = useThemeStore();
const { bi } = useSctI18n();

const currentYear = dayjs().year();
const yearStr = String(currentYear);
const yearPrefix = `${yearStr}-`;

// ---------------- 主题感知配色（兼容墨韵/电子纸 × 深/浅四态） ----------------
const isDark = computed(() => themeStore.darkMode);
const isEpaper = computed(() => themeStore.themePreset === 'crm-frosted-glass');

const palette = computed(() => {
  const dark = isDark.value;
  const epaper = isEpaper.value;
  const accent = epaper ? (dark ? '#34B37E' : '#1E6B4B') : dark ? '#E0555D' : '#A81C24';
  const secondary = epaper ? (dark ? '#60A5FA' : '#1D4ED8') : dark ? '#60A5FA' : '#2563EB';
  const emerald = dark ? '#34D399' : '#16A34A';
  const teal = dark ? '#2DD4BF' : '#0F766E';
  const amber = dark ? '#FBBF24' : '#D97706';
  const crimson = dark ? '#F87171' : '#DC2626';
  const slate = dark ? '#94A3B8' : '#64748B';
  return {
    bg: 'transparent',
    ink: dark ? '#E5E3DE' : '#2B2926',
    muted: dark ? '#9CA3AF' : '#6B7280',
    grid: dark ? '#374151' : '#D6D2C8',
    track: dark ? '#272C36' : '#ECEAE4',
    accent,
    secondary,
    emerald,
    teal,
    amber,
    crimson,
    slate,
    series: [accent, secondary, emerald, amber, teal, '#8B5CF6']
  };
});

// ---------------- 基础聚合数据（仅统计在册口径，防归档脏数据） ----------------
const activePartyMembers = computed(() =>
  workStore.activeMembers.filter(m => m.type === '正式党员' || m.type === '预备党员')
);

const yearPointSummaries = computed(() => {
  const scheme = workStore.activePointScheme;
  const vetoMap = new Map(workStore.pointVetoes.filter(v => v.year === currentYear).map(v => [v.member_id, v]));
  const recMap = new Map<string, Sct.PointRecord[]>();
  for (const r of workStore.pointRecords) {
    if (r.year !== currentYear) continue;
    const arr = recMap.get(r.member_id);
    if (arr) arr.push(r);
    else recMap.set(r.member_id, [r]);
  }
  return activePartyMembers.value.map(m =>
    computeMemberYearPoints(m, currentYear, recMap.get(m.id) ?? [], vetoMap.get(m.id), scheme)
  );
});

const attendanceRatePct = computed(() => {
  const yearEventIds = new Set(
    workStore.calEvents.filter(e => e.date.startsWith(yearPrefix) && e.status !== '已取消').map(e => e.id)
  );
  const rows = workStore.attendance.filter(a => yearEventIds.has(a.event_id));
  if (!rows.length) return 100;
  const present = rows.filter(a => a.status === '到会' || a.status === '迟到').length;
  return Math.round((present / rows.length) * 100);
});

const feeOnTimeRatePct = computed(() => {
  const activeIds = new Set(workStore.inBranchRosterMembers.map(m => m.id));
  const rows = workStore.feeRecords.filter(
    f => f.year_month.startsWith(yearPrefix) && f.status !== '未在校' && activeIds.has(f.member_id)
  );
  if (!rows.length) return 100;
  const ok = rows.filter(f => f.status === '已缴' || f.status === '减免').length;
  return Math.round((ok / rows.length) * 100);
});

const talksCoverageStats = computed(() => {
  const coveredSet = new Set(workStore.talks.filter(t => t.date.startsWith(yearPrefix)).flatMap(t => t.member_ids));
  const total = activePartyMembers.value.length;
  const uncovered = activePartyMembers.value.filter(m => !coveredSet.has(m.id));
  const covered = total - uncovered.length;
  const pct = total ? Math.round((covered / total) * 100) : 0;
  return { total, covered, uncovered, pct };
});

const volunteerStats = computed(() => {
  const verifiedActs = workStore.volunteerActivities.filter(
    a => a.status === '已认定' && a.date.startsWith(yearPrefix)
  );
  const bySource = new Map<Sct.VolunteerSource, number>();
  const byMember = new Map<string, { name: string; hours: number; count: number }>();
  let totalHours = 0;

  for (const act of verifiedActs) {
    let actHours = 0;
    for (const p of act.participants) {
      const h = Number(p.hours) || 0;
      actHours += h;
      const cur = byMember.get(p.member_id) ?? { name: p.name_snapshot, hours: 0, count: 0 };
      cur.hours = roundHours(cur.hours + h);
      cur.count += 1;
      byMember.set(p.member_id, cur);
    }
    totalHours = roundHours(totalHours + actHours);
    bySource.set(act.source, roundHours((bySource.get(act.source) ?? 0) + actHours));
  }

  const activeIds = new Set(workStore.activeMembers.map(m => m.id));
  const activeParticipantCount = [...byMember.keys()].filter(id => activeIds.has(id)).length;
  const participationPct = workStore.activeMembers.length
    ? Math.round((activeParticipantCount / workStore.activeMembers.length) * 100)
    : 0;

  const topMembers = [...byMember.entries()]
    .map(([id, stat]) => ({ id, ...stat }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 3);

  return {
    activityCount: verifiedActs.length,
    totalHours,
    bySource,
    topMembers,
    participationPct
  };
});

const pointsStats = computed(() => {
  const list = yearPointSummaries.value;
  if (!list.length) {
    return {
      avg: 0,
      passRate: 100,
      excellent: 0,
      good: 0,
      pass: 0,
      warn: 0,
      avgStudy: 0,
      avgPractice: 0,
      avgVol: 0
    };
  }
  const avg = roundScore(list.reduce((acc, s) => acc + s.totalScore, 0) / list.length);
  const warn = list.filter(s => s.isWarning).length;
  const excellent = list.filter(s => !s.isWarning && s.totalScore >= 85).length;
  const good = list.filter(s => !s.isWarning && s.totalScore >= 75 && s.totalScore < 85).length;
  const pass = list.filter(s => !s.isWarning && s.totalScore < 75).length;
  const passRate = Math.round(((list.length - warn) / list.length) * 100);
  const avgStudy = roundScore(list.reduce((acc, s) => acc + s.dutyStudyScore, 0) / list.length);
  const avgPractice = roundScore(list.reduce((acc, s) => acc + s.dutyPracticeScore, 0) / list.length);
  const avgVol = roundScore(list.reduce((acc, s) => acc + s.dutyVolunteerScore, 0) / list.length);
  return { avg, passRate, excellent, good, pass, warn, avgStudy, avgPractice, avgVol };
});

// ---------------- 1. 支部党建健康五维雷达（VueUiRadar） ----------------
const radarDataset = computed<VueUiRadarDataset>(() => ({
  categories: [
    {
      name: bi('支部综合指数', 'Branch Index'),
      color: palette.value.accent
    }
  ],
  series: [
    { name: bi('会议出勤', 'Attend'), values: [attendanceRatePct.value], target: 100 },
    { name: bi('党费按期', 'Dues'), values: [feeOnTimeRatePct.value], target: 100 },
    { name: bi('谈话覆盖', 'Talks'), values: [talksCoverageStats.value.pct], target: 100 },
    { name: bi('志愿参与', 'Volunteer'), values: [volunteerStats.value.participationPct], target: 100 },
    { name: bi('积分合格', 'Points'), values: [pointsStats.value.passRate], target: 100 }
  ]
}));

const radarConfig = computed<VueUiRadarConfig>(() => ({
  userOptions: { show: false },
  table: { show: false },
  style: {
    fontFamily: 'inherit',
    chart: {
      backgroundColor: palette.value.bg,
      color: palette.value.ink,
      layout: {
        plots: { show: true, radius: 3.5 },
        outerPolygon: { stroke: palette.value.grid, strokeWidth: 1 },
        dataPolygon: {
          strokeWidth: 2,
          transparent: false,
          opacity: isDark.value ? 28 : 20,
          useGradient: false
        },
        grid: {
          show: true,
          stroke: palette.value.grid,
          strokeWidth: 0.7,
          graduations: 4
        },
        labels: {
          dataLabels: {
            show: true,
            fontSize: 12,
            color: palette.value.ink
          }
        }
      },
      legend: { show: false },
      tooltip: {
        show: true,
        backgroundColor: isDark.value ? '#1E222A' : '#FFFFFF',
        color: palette.value.ink,
        borderColor: palette.value.grid,
        showPercentage: false
      }
    }
  }
}));

// ---------------- 2. 党员积分 60+40 仪表盘（VueUiGauge） ----------------
const gaugeDataset = computed<VueUiGaugeDataset>(() => ({
  value: Math.min(100, Math.max(0, pointsStats.value.avg)),
  series: [
    { from: 0, to: 60, color: palette.value.crimson, name: '预警' },
    { from: 60, to: 75, color: palette.value.amber, name: '合格' },
    { from: 75, to: 85, color: palette.value.secondary, name: '良好' },
    { from: 85, to: 100, color: palette.value.emerald, name: '优秀' }
  ]
}));

const gaugeLegendColor = computed(() => {
  const avg = pointsStats.value.avg;
  if (avg < 60) return palette.value.crimson;
  if (avg < 75) return palette.value.amber;
  if (avg < 85) return palette.value.secondary;
  return palette.value.emerald;
});

const gaugeConfig = computed<VueUiGaugeConfig>(() => ({
  userOptions: { show: false },
  style: {
    fontFamily: 'inherit',
    chart: {
      backgroundColor: palette.value.bg,
      color: palette.value.ink,
      layout: {
        track: { size: 0.9, useGradient: false },
        markers: {
          show: true,
          color: palette.value.muted,
          bold: false,
          fontSizeRatio: 0.85,
          offsetY: 0
        },
        pointer: {
          type: 'rounded',
          size: 0.88,
          stroke: palette.value.ink,
          strokeWidth: 8,
          useRatingColor: false,
          color: palette.value.ink,
          circle: {
            radius: 8,
            stroke: palette.value.ink,
            strokeWidth: 2,
            color: isDark.value ? '#1E222A' : '#FFFFFF'
          }
        },
        segmentNames: { show: false }
      },
      legend: {
        show: true,
        fontSize: 34,
        suffix: ' 分',
        roundingValue: 1,
        showPlusSymbol: false,
        useRatingColor: false,
        color: gaugeLegendColor.value
      }
    }
  }
}));

// ---------------- 3. 志愿服务时长来源环（VueUiDonut） ----------------
const volunteerDonutDataset = computed<VueUiDonutDatasetItem[]>(() => {
  const sources: Array<{ key: Sct.VolunteerSource; color: string }> = [
    { key: '支部内部', color: palette.value.accent },
    { key: '校院活动', color: palette.value.emerald },
    { key: '社会公益', color: palette.value.secondary },
    { key: '其他', color: palette.value.amber }
  ];
  return sources
    .map(s => ({
      name: s.key,
      values: [volunteerStats.value.bySource.get(s.key) ?? 0],
      color: s.color
    }))
    .filter(item => item.values[0] > 0);
});

const volunteerDonutConfig = computed<VueUiDonutConfig>(() => ({
  userOptions: { show: false },
  table: { show: false },
  style: {
    fontFamily: 'inherit',
    chart: {
      backgroundColor: palette.value.bg,
      color: palette.value.ink,
      useGradient: false,
      layout: {
        curvedMarkers: !isEpaper.value,
        donut: {
          strokeWidth: 52,
          borderWidth: 1,
          useShadow: false
        },
        labels: {
          dataLabels: { show: false },
          percentage: { show: true, color: palette.value.ink, bold: true, fontSize: 13 },
          name: { show: true, color: palette.value.muted, fontSize: 11 },
          hollow: {
            show: true,
            total: {
              show: true,
              text: bi('年度总时长', 'Hours'),
              color: palette.value.muted,
              fontSize: 13,
              offsetY: -8,
              value: {
                color: palette.value.ink,
                fontSize: 22,
                bold: true,
                suffix: 'h',
                offsetY: 4,
                rounding: 1
              }
            },
            average: { show: false }
          }
        }
      },
      legend: {
        show: true,
        backgroundColor: palette.value.bg,
        color: palette.value.ink,
        fontSize: 11,
        roundingValue: 1,
        roundingPercentage: 0
      },
      tooltip: {
        show: true,
        backgroundColor: isDark.value ? '#1E222A' : '#FFFFFF',
        color: palette.value.ink,
        borderColor: palette.value.grid
      }
    }
  }
}));

// ---------------- 4. 成员全生命周期与转接态方格矩阵（VueUiWaffle） ----------------
const lifecycleSummary = computed(() => {
  const counts = {
    activeNormal: 0,
    transferringOut: 0,
    incomingAudit: 0,
    floating: 0,
    archived: 0
  };
  for (const m of workStore.members) {
    const st = getMemberLifecycle(m);
    if (st === '在册正常') counts.activeNormal += 1;
    else if (st === '转出办理中') counts.transferringOut += 1;
    else if (st === '转入待核查') counts.incomingAudit += 1;
    else if (st === '流出党员' || st === '流入党员') counts.floating += 1;
    else counts.archived += 1;
  }
  return counts;
});

const waffleDataset = computed<VueUiWaffleDatasetItem[]>(() =>
  [
    { name: '在册正常', values: [lifecycleSummary.value.activeNormal], color: palette.value.emerald },
    { name: '转出办理中', values: [lifecycleSummary.value.transferringOut], color: palette.value.crimson },
    { name: '转入待核查', values: [lifecycleSummary.value.incomingAudit], color: palette.value.amber },
    { name: '流动党员', values: [lifecycleSummary.value.floating], color: palette.value.secondary },
    { name: '历史归档', values: [lifecycleSummary.value.archived], color: palette.value.slate }
  ].filter(item => item.values[0] > 0)
);

const waffleConfig = computed<VueUiWaffleConfig>(() => ({
  userOptions: { show: false },
  table: { show: false },
  style: {
    fontFamily: 'inherit',
    chart: {
      backgroundColor: palette.value.bg,
      color: palette.value.ink,
      layout: {
        grid: {
          size: 10,
          spaceBetween: 2.5,
          vertical: false
        },
        rect: {
          rounded: !isEpaper.value,
          rounding: isEpaper.value ? 0 : 2,
          stroke: isDark.value ? '#12161f' : '#ffffff',
          strokeWidth: 0.5,
          useGradient: false,
          selection: {
            unselectedOpacity: 0.5,
            wrap: {
              show: true,
              stroke: palette.value.ink,
              strokeWidth: 2
            }
          }
        },
        labels: {
          captions: { show: false }
        }
      },
      legend: {
        show: true,
        backgroundColor: palette.value.bg,
        color: palette.value.ink,
        fontSize: 11,
        roundingValue: 0,
        roundingPercentage: 0
      },
      tooltip: {
        show: true,
        backgroundColor: isDark.value ? '#1E222A' : '#FFFFFF',
        color: palette.value.ink,
        borderColor: palette.value.grid
      }
    }
  }
}));

// ---------------- 5. 年度谈心谈话覆盖温度计（VueUiThermometer） ----------------
const thermometerDataset = computed<VueUiThermometerDataset>(() => ({
  value: talksCoverageStats.value.pct,
  from: 0,
  to: 100,
  steps: 5,
  colors: {
    from: palette.value.accent,
    to: palette.value.emerald
  }
}));

const thermometerConfig = computed<VueUiThermometerConfig>(() => ({
  userOptions: { show: false },
  style: {
    fontFamily: 'inherit',
    chart: {
      backgroundColor: palette.value.bg,
      color: palette.value.ink,
      height: 185,
      thermometer: { width: 32 },
      padding: { top: 8, bottom: 8, left: 10, right: 10 },
      graduations: {
        show: true,
        sides: 'both',
        stroke: palette.value.grid,
        strokeWidth: 1,
        showIntermediate: true
      },
      label: {
        fontSize: 16,
        rounding: 0,
        bold: true,
        color: palette.value.ink,
        suffix: '%'
      }
    }
  }
}));

// ---------------- 6. 党小组综合活力同心环（VueUiOnion） ----------------
const groupOnionDataset = computed<VueUiOnionDatasetItem[]>(() => {
  const yearEvents = new Set(
    workStore.calEvents.filter(e => e.date.startsWith(yearPrefix) && e.status !== '已取消').map(e => e.id)
  );
  const volHoursByMember = new Map<string, number>();
  for (const act of workStore.volunteerActivities) {
    if (act.status !== '已认定' || !act.date.startsWith(yearPrefix)) continue;
    for (const p of act.participants) {
      volHoursByMember.set(p.member_id, (volHoursByMember.get(p.member_id) ?? 0) + (Number(p.hours) || 0));
    }
  }
  const talkedSet = new Set(workStore.talks.filter(t => t.date.startsWith(yearPrefix)).flatMap(t => t.member_ids));

  const nonEmptyGroups = workStore.partyGroupNames
    .map(groupName => ({
      groupName,
      members: workStore.activeMembers.filter(m => (m.group ?? '').trim() === groupName)
    }))
    .filter(g => g.members.length > 0)
    .slice(0, 5);

  return nonEmptyGroups.map(({ groupName, members }, idx) => {
    const memberIds = new Set(members.map(m => m.id));

    // 综合活力分：考勤出勤率 40% + 谈话覆盖率 30% + 志愿参与率 30%
    const attRows = workStore.attendance.filter(a => yearEvents.has(a.event_id) && memberIds.has(a.member_id));
    const attRate = attRows.length
      ? (attRows.filter(a => a.status === '到会' || a.status === '迟到').length / attRows.length) * 100
      : 80;
    const talkedRate = (members.filter(m => talkedSet.has(m.id)).length / members.length) * 100;
    const volRate = (members.filter(m => (volHoursByMember.get(m.id) ?? 0) > 0).length / members.length) * 100;
    const composite = Math.min(100, Math.max(0, Math.round(attRate * 0.4 + talkedRate * 0.3 + volRate * 0.3)));

    return {
      name: `${groupName} (${members.length}人)`,
      percentage: composite,
      value: composite,
      suffix: '分',
      color: palette.value.series[idx % palette.value.series.length]
    };
  });
});

const onionConfig = computed<VueUiOnionConfig>(() => ({
  userOptions: { show: false },
  table: { show: false },
  style: {
    fontFamily: 'inherit',
    chart: {
      backgroundColor: palette.value.bg,
      color: palette.value.ink,
      layout: {
        maxThickness: 46,
        gutter: { color: palette.value.track, width: 0.62 },
        track: { width: 0.62 },
        labels: {
          show: true,
          fontSize: 12,
          color: palette.value.ink,
          roundingValue: 0,
          roundingPercentage: 0,
          bold: true,
          value: { show: true },
          percentage: { show: false }
        }
      },
      legend: {
        show: true,
        backgroundColor: palette.value.bg,
        color: palette.value.ink,
        fontSize: 11,
        roundingValue: 0,
        roundingPercentage: 0,
        showPercentage: false
      },
      tooltip: {
        show: true,
        backgroundColor: isDark.value ? '#1E222A' : '#FFFFFF',
        color: palette.value.ink,
        borderColor: palette.value.grid
      }
    }
  }
}));
</script>

<template>
  <!-- 1. 支部党建健康五维雷达 -->
  <NCard v-if="widgetId === 'healthRadar'" :bordered="false" class="h-full rounded-16px">
    <template #header>
      <div class="flex items-center gap-7px">
        <SvgIcon icon="lucide:radar" class="text-15px text-[var(--sct-accent)]" />
        <span>{{ bi('支部党建健康雷达', 'Branch Health Radar') }}</span>
      </div>
    </template>
    <template #header-extra>
      <span class="font-mono text-11px text-[var(--sct-muted)]">{{ yearStr }} 年度五维</span>
    </template>
    <div class="vdui-box mx-auto max-w-290px">
      <VueUiRadar :dataset="radarDataset" :config="radarConfig" />
    </div>
    <div class="mt-4px flex flex-wrap justify-center gap-x-10px gap-y-4px font-mono text-11px text-[var(--sct-muted)]">
      <span>出勤 {{ attendanceRatePct }}%</span>
      <span>党费 {{ feeOnTimeRatePct }}%</span>
      <span>谈话 {{ talksCoverageStats.pct }}%</span>
      <span>志愿 {{ volunteerStats.participationPct }}%</span>
      <span>积分 {{ pointsStats.passRate }}%</span>
    </div>
  </NCard>

  <!-- 2. 党员积分 60+40 仪表盘 -->
  <NCard v-else-if="widgetId === 'pointsGauge'" :bordered="false" class="h-full rounded-16px">
    <template #header>
      <div class="flex items-center gap-7px">
        <SvgIcon icon="lucide:gauge" class="text-15px text-[#d97706]" />
        <span>{{ bi('党员积分 60+40 仪表', 'Party Points Gauge') }}</span>
      </div>
    </template>
    <template #header-extra>
      <NButton size="tiny" quaternary type="primary" @click="router.push('/ledger/points')">积分台账 →</NButton>
    </template>
    <div class="vdui-box mx-auto max-w-250px">
      <VueUiGauge :dataset="gaugeDataset" :config="gaugeConfig" />
    </div>
    <div class="mt-4px grid grid-cols-4 gap-6px text-center text-11px">
      <div class="rounded-6px bg-[var(--sct-soft)] py-4px">
        <div class="text-[var(--sct-muted)]">优秀</div>
        <div class="font-mono font-bold text-[#16a34a]">{{ pointsStats.excellent }}</div>
      </div>
      <div class="rounded-6px bg-[var(--sct-soft)] py-4px">
        <div class="text-[var(--sct-muted)]">良好</div>
        <div class="font-mono font-bold text-[#2563eb]">{{ pointsStats.good }}</div>
      </div>
      <div class="rounded-6px bg-[var(--sct-soft)] py-4px">
        <div class="text-[var(--sct-muted)]">合格</div>
        <div class="font-mono font-bold text-[#d97706]">{{ pointsStats.pass }}</div>
      </div>
      <div class="rounded-6px bg-[var(--sct-soft)] py-4px">
        <div class="text-[var(--sct-muted)]">预警</div>
        <div class="font-mono font-bold text-[#dc2626]">{{ pointsStats.warn }}</div>
      </div>
    </div>
    <div class="mt-6px flex justify-between font-mono text-11px text-[var(--sct-muted)]">
      <span>履职均分 · 学 {{ formatScore(pointsStats.avgStudy) }}</span>
      <span>践 {{ formatScore(pointsStats.avgPractice) }}</span>
      <span>志 {{ formatScore(pointsStats.avgVol) }}</span>
    </div>
  </NCard>

  <!-- 3. 志愿服务时长统计卡 -->
  <NCard v-else-if="widgetId === 'volunteerDonut'" :bordered="false" class="h-full rounded-16px">
    <template #header>
      <div class="flex items-center gap-7px">
        <SvgIcon icon="lucide:heart-handshake" class="text-15px text-[#16a34a]" />
        <span>{{ bi('志愿服务时长统计', 'Volunteer Hours') }}</span>
      </div>
    </template>
    <template #header-extra>
      <NButton size="tiny" quaternary type="primary" @click="router.push('/ledger/volunteer')">志愿台账 →</NButton>
    </template>
    <div v-if="volunteerDonutDataset.length" class="flex flex-col gap-8px">
      <div class="vdui-box mx-auto max-w-245px">
        <VueUiDonut :dataset="volunteerDonutDataset" :config="volunteerDonutConfig" />
      </div>
      <div v-if="volunteerStats.topMembers.length" class="border-t border-dashed border-[var(--sct-border)] pt-6px">
        <div class="mb-4px flex items-center justify-between text-11px text-[var(--sct-muted)]">
          <span class="font-semibold">本年志愿之星 Top {{ volunteerStats.topMembers.length }}</span>
          <span class="font-mono">已认定 {{ volunteerStats.activityCount }} 场</span>
        </div>
        <div class="flex flex-col gap-4px">
          <div
            v-for="(m, idx) in volunteerStats.topMembers"
            :key="m.id"
            class="flex items-center justify-between text-12px"
          >
            <span class="flex items-center gap-6px truncate">
              <span class="w-16px text-center font-mono text-11px font-bold text-[#16a34a]">#{{ idx + 1 }}</span>
              <span class="font-medium text-[var(--sct-ink)]">{{ m.name }}</span>
            </span>
            <span class="font-mono text-11.5px font-bold text-[#16a34a]">{{ m.hours }}h · {{ m.count }}次</span>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="flex h-190px flex-col items-center justify-center gap-6px text-12px text-[var(--sct-muted)]">
      <SvgIcon icon="lucide:heart-handshake" class="text-28px opacity-35" />
      <span>{{ yearStr }} 年度暂无已认定志愿活动</span>
      <NButton size="tiny" secondary type="primary" @click="router.push('/ledger/volunteer')">去登记首场活动</NButton>
    </div>
  </NCard>

  <!-- 4. 成员全生命周期与转接态方格矩阵 -->
  <NCard v-else-if="widgetId === 'lifecycleWaffle'" :bordered="false" class="h-full rounded-16px">
    <template #header>
      <div class="flex items-center gap-7px">
        <SvgIcon icon="lucide:grid-3x3" class="text-15px text-[#2563eb]" />
        <span>{{ bi('成员生命周期矩阵', 'Lifecycle Matrix') }}</span>
      </div>
    </template>
    <template #header-extra>
      <NButton size="tiny" quaternary type="primary" @click="router.push('/ledger/members')">花名册 →</NButton>
    </template>
    <div v-if="waffleDataset.length" class="flex flex-col gap-6px">
      <div class="vdui-box mx-auto max-w-220px">
        <VueUiWaffle :dataset="waffleDataset" :config="waffleConfig" />
      </div>
      <div class="flex flex-wrap justify-center gap-6px text-11px">
        <NTag v-if="lifecycleSummary.transferringOut > 0" size="tiny" type="error" :bordered="false">
          转出办理中 {{ lifecycleSummary.transferringOut }}
        </NTag>
        <NTag v-if="lifecycleSummary.incomingAudit > 0" size="tiny" type="warning" :bordered="false">
          转入待核查 {{ lifecycleSummary.incomingAudit }}
        </NTag>
        <NTag v-if="lifecycleSummary.floating > 0" size="tiny" type="info" :bordered="false">
          流动党员 {{ lifecycleSummary.floating }}
        </NTag>
        <NTag
          v-if="!lifecycleSummary.transferringOut && !lifecycleSummary.incomingAudit"
          size="tiny"
          type="success"
          :bordered="false"
        >
          无待办转接积压 · 共 {{ workStore.members.length }} 条档案
        </NTag>
      </div>
    </div>
    <div v-else class="flex h-180px items-center justify-center text-12px text-[var(--sct-muted)]">暂无人员数据</div>
  </NCard>

  <!-- 5. 年度谈心谈话覆盖温度计 -->
  <NCard v-else-if="widgetId === 'talksThermometer'" :bordered="false" class="h-full rounded-16px">
    <template #header>
      <div class="flex items-center gap-7px">
        <SvgIcon icon="lucide:thermometer" class="text-15px text-[#0f766e]" />
        <span>{{ bi('年度谈话覆盖温度计', 'Talks Coverage Meter') }}</span>
      </div>
    </template>
    <template #header-extra>
      <NButton size="tiny" quaternary type="primary" @click="router.push('/ledger/talks')">去谈话 →</NButton>
    </template>
    <div class="flex items-center gap-10px">
      <div class="w-118px shrink-0">
        <VueUiThermometer :dataset="thermometerDataset" :config="thermometerConfig" />
      </div>
      <div class="min-w-0 flex-1 flex flex-col gap-8px">
        <div class="rounded-8px bg-[var(--sct-soft)] px-10px py-8px">
          <div class="text-11px text-[var(--sct-muted)]">{{ yearStr }} 年在册党员谈话进度</div>
          <div class="mt-2px font-mono text-20px font-extrabold text-[var(--sct-ink)]">
            {{ talksCoverageStats.covered }}
            <span class="text-12px font-normal text-[var(--sct-muted)]">/ {{ talksCoverageStats.total }} 人</span>
          </div>
        </div>
        <div v-if="talksCoverageStats.uncovered.length">
          <div class="mb-4px text-11px text-[var(--sct-muted)]">
            待安排谈话（{{ talksCoverageStats.uncovered.length }} 人）：
          </div>
          <div class="flex flex-wrap gap-4px">
            <NTag
              v-for="m in talksCoverageStats.uncovered.slice(0, 6)"
              :key="m.id"
              size="tiny"
              :bordered="false"
              type="warning"
            >
              {{ m.name }}
            </NTag>
            <span v-if="talksCoverageStats.uncovered.length > 6" class="text-11px text-[var(--sct-muted)]">
              +{{ talksCoverageStats.uncovered.length - 6 }}
            </span>
          </div>
        </div>
        <div
          v-else-if="talksCoverageStats.total > 0"
          class="flex items-center gap-5px text-12px font-medium text-[#16a34a]"
        >
          <SvgIcon icon="lucide:check-circle-2" class="text-14px" />
          <span>本年度在册党员已全部完成谈话覆盖</span>
        </div>
        <div v-else class="text-12px text-[var(--sct-muted)]">暂无在册正式/预备党员</div>
      </div>
    </div>
  </NCard>

  <!-- 6. 党小组综合活力同心环 -->
  <NCard v-else-if="widgetId === 'groupOnion'" :bordered="false" class="h-full rounded-16px">
    <template #header>
      <div class="flex items-center gap-7px">
        <SvgIcon icon="lucide:orbit" class="text-15px text-[#7c5cd6]" />
        <span>{{ bi('党小组活力同心环', 'Party Group Vitality') }}</span>
      </div>
    </template>
    <template #header-extra>
      <span class="text-11px text-[var(--sct-muted)]">出勤·谈话·志愿加权</span>
    </template>
    <div v-if="groupOnionDataset.length" class="vdui-box mx-auto max-w-250px">
      <VueUiOnion :dataset="groupOnionDataset" :config="onionConfig" />
    </div>
    <div v-else class="flex h-190px items-center justify-center text-12px text-[var(--sct-muted)]">
      暂未给在册成员分配党小组
    </div>
  </NCard>
</template>

<style scoped>
.vdui-box :deep(.vue-data-ui-wrapper) {
  background: transparent !important;
}
</style>

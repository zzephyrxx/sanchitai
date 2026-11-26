/**
 * 单位配置包（.sctpreset）编码、校验与导出工具
 *
 * 用于同校/同单位组织员或老支书将「积分/评定方案 + 花名册自定义字段 + 材料模板 + 支部场景配置」
 * 打包分享给其他支部一键导入，不含任何个人隐私或成员业务台账数据。
 */
import dayjs from 'dayjs';
import { saveFileWithPicker } from '@/utils/save-file';

export type UnitPresetIncludeKey = Sct.UnitPresetPack['includes'][number];

export interface BuildUnitPresetOptions {
  name: string;
  description?: string;
  sourceBranch?: string;
  includes: UnitPresetIncludeKey[];
  workspaceConfig?: Sct.WorkspaceConfig;
  pointScheme?: Sct.PointScheme;
  docTemplates?: Sct.DocTemplate[];
}

export function buildUnitPresetPack(opts: BuildUnitPresetOptions): Sct.UnitPresetPack {
  const uniqueIncludes = Array.from(new Set(opts.includes));
  const pack: Sct.UnitPresetPack = {
    format: 'sctpreset',
    version: 1,
    exported_at: new Date().toISOString(),
    name: opts.name.trim() || '支部标准化配置包',
    description: opts.description?.trim() || undefined,
    source_branch: opts.sourceBranch?.trim() || undefined,
    includes: uniqueIncludes
  };

  if (uniqueIncludes.includes('scene') && opts.workspaceConfig) {
    pack.scene = opts.workspaceConfig.scene;
    pack.enabled_modules = { ...opts.workspaceConfig.enabledModules };
    pack.enabled_field_groups = { ...opts.workspaceConfig.enabledFieldGroups };
  }
  if (uniqueIncludes.includes('custom_fields') && opts.workspaceConfig) {
    pack.custom_fields = JSON.parse(JSON.stringify(opts.workspaceConfig.customFields)) as Sct.CustomFieldDef[];
  }
  if (uniqueIncludes.includes('point_scheme') && opts.pointScheme) {
    pack.point_scheme = JSON.parse(JSON.stringify(opts.pointScheme)) as Sct.PointScheme;
  }
  if (uniqueIncludes.includes('doc_templates') && opts.docTemplates) {
    pack.doc_templates = JSON.parse(JSON.stringify(opts.docTemplates)) as Sct.DocTemplate[];
  }
  return pack;
}

export async function exportUnitPresetFile(pack: Sct.UnitPresetPack): Promise<'saved' | 'cancelled'> {
  const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json;charset=utf-8' });
  const safeName = pack.name.replace(/[\\/:*?"<>|]/g, '_');
  const res = await saveFileWithPicker(blob, {
    suggestedName: `${safeName}_${dayjs().format('YYYYMMDD')}.sctpreset`,
    types: [
      {
        description: '三尺台单位配置包 (.sctpreset)',
        mime: 'application/json',
        extensions: ['.sctpreset', '.json']
      }
    ]
  });
  return res.status === 'saved' ? 'saved' : 'cancelled';
}

export function parseUnitPresetText(
  rawText: string
): { ok: true; pack: Sct.UnitPresetPack } | { ok: false; message: string } {
  try {
    const parsed = JSON.parse(rawText) as Partial<Sct.UnitPresetPack>;
    if (!parsed || parsed.format !== 'sctpreset' || !Array.isArray(parsed.includes)) {
      return { ok: false, message: '文件不是有效的三尺台单位配置包（.sctpreset）' };
    }
    return { ok: true, pack: parsed as Sct.UnitPresetPack };
  } catch {
    return { ok: false, message: '配置文件 JSON 解析失败，请确认文件未损坏' };
  }
}

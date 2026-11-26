/**
 * 统一文件保存工具：优先唤起系统原生「另存为」路径选择弹窗（File System Access API），
 * 取消则中止导出；若运行环境不支持原生目录选择，则弹出文件名确认弹窗后再保存。
 */
import { h, ref } from 'vue';
import { NInput } from 'naive-ui';
import { saveAs } from 'file-saver';

export interface SaveFileTypeOption {
  description: string;
  mime: string;
  extensions: string[];
}

export interface SaveFileOptions {
  suggestedName: string;
  types?: SaveFileTypeOption[];
}

export interface SaveFileResult {
  status: 'saved' | 'cancelled';
  fileName?: string;
  method?: 'picker' | 'download';
}

interface FileSystemWritableStreamLike {
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
}

interface FileSystemFileHandleLike {
  name: string;
  createWritable: () => Promise<FileSystemWritableStreamLike>;
}

type ShowSaveFilePickerFn = (options?: {
  suggestedName?: string;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
}) => Promise<FileSystemFileHandleLike>;

function cleanMimeType(mime: string): string {
  const base = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(base) ? base : 'application/octet-stream';
}

function normalizeExtensions(extensions: string[]): string[] {
  return extensions
    .map(ext => ext.trim().toLowerCase())
    .filter(Boolean)
    .map(ext => (ext.startsWith('.') ? ext : `.${ext}`));
}

function inferTypeFromFilename(filename: string, blobMime: string): SaveFileTypeOption | null {
  const match = filename.match(/(\.[a-zA-Z0-9]+)$/);
  const ext = match ? match[1].toLowerCase() : '';
  const presetMap: Record<string, SaveFileTypeOption> = {
    '.json': { description: 'JSON 数据文件', mime: 'application/json', extensions: ['.json'] },
    '.html': { description: 'HTML 网页文档', mime: 'text/html', extensions: ['.html'] },
    '.csv': { description: 'CSV 表格文件', mime: 'text/csv', extensions: ['.csv'] },
    '.md': { description: 'Markdown 文档', mime: 'text/markdown', extensions: ['.md'] },
    '.doc': { description: 'Word 文档', mime: 'application/msword', extensions: ['.doc'] },
    '.docx': {
      description: 'Word 公文文档 (.docx)',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extensions: ['.docx']
    },
    '.png': { description: 'PNG 图片', mime: 'image/png', extensions: ['.png'] },
    '.jpg': { description: 'JPEG 图片', mime: 'image/jpeg', extensions: ['.jpg', '.jpeg'] },
    '.zip': { description: 'ZIP 压缩包', mime: 'application/zip', extensions: ['.zip'] },
    '.pdf': { description: 'PDF 文档', mime: 'application/pdf', extensions: ['.pdf'] }
  };
  if (ext && presetMap[ext]) return presetMap[ext];
  if (!ext) return null;
  return {
    description: `${ext.slice(1).toUpperCase()} 文件`,
    mime: cleanMimeType(blobMime || 'application/octet-stream'),
    extensions: [ext]
  };
}

function buildPickerTypes(fallbackMime: string, options: SaveFileOptions) {
  const rawTypes = options.types?.length
    ? options.types
    : (() => {
        const inferred = inferTypeFromFilename(options.suggestedName, fallbackMime);
        return inferred ? [inferred] : [];
      })();

  return rawTypes
    .map(t => {
      const exts = normalizeExtensions(t.extensions);
      if (!exts.length) return null;
      return {
        description: t.description,
        accept: {
          [cleanMimeType(t.mime)]: exts
        }
      };
    })
    .filter((item): item is { description: string; accept: Record<string, string[]> } => item !== null);
}

/** 降级确认弹窗：不支持 showSaveFilePicker 的环境（如 Safari/Firefox）先确认文件名再下载 */
function promptFallbackFilename(suggestedName: string): Promise<string | null> {
  const dialog = window.$dialog;
  if (!dialog) {
    return Promise.resolve(suggestedName);
  }
  return new Promise(resolve => {
    const nameRef = ref(suggestedName);
    let settled = false;
    const finish = (val: string | null) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };

    dialog.create({
      title: '导出文件',
      type: 'info',
      closable: true,
      maskClosable: false,
      positiveText: '确认导出',
      negativeText: '取消',
      content: () =>
        h('div', { class: 'flex flex-col gap-10px pt-4px' }, [
          h(
            'div',
            { class: 'text-12px text-gray-500 leading-relaxed' },
            '当前运行环境不支持直接选择保存目录，请确认导出文件名后保存至默认下载目录（使用 Chrome / Edge / Windows 桌面端可直接弹出系统路径选择框）。'
          ),
          h(NInput, {
            value: nameRef.value,
            placeholder: '请输入保存文件名',
            'onUpdate:value': (v: string) => {
              nameRef.value = v;
            }
          })
        ]),
      onPositiveClick: () => {
        const clean = nameRef.value.trim();
        finish(clean || suggestedName);
      },
      onNegativeClick: () => {
        finish(null);
      },
      onClose: () => {
        finish(null);
      }
    });
  });
}

/**
 * 弹出路径选择弹窗并写入文件（支持取消中止）。
 * 支持传入 Blob 或延迟工厂函数：传工厂函数时可在点击事件的首个微任务内立刻唤起系统「另存为」弹窗，
 * 避免异步查询 IndexedDB 导致浏览器丢失 user gesture 授权。
 */
export async function saveFileWithPicker(
  blobOrFactory: Blob | (() => Blob | Promise<Blob>),
  options: SaveFileOptions
): Promise<SaveFileResult> {
  const picker = (window as unknown as { showSaveFilePicker?: ShowSaveFilePickerFn }).showSaveFilePicker;
  const resolveBlob = async () => (typeof blobOrFactory === 'function' ? await blobOrFactory() : blobOrFactory);

  if (typeof picker === 'function') {
    try {
      const initialMime = typeof blobOrFactory === 'function' ? '' : blobOrFactory.type;
      const types = buildPickerTypes(initialMime, options);
      const handle = await picker({
        suggestedName: options.suggestedName,
        ...(types.length ? { types } : {})
      });
      const blob = await resolveBlob();
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { status: 'saved', fileName: handle.name, method: 'picker' };
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') {
        return { status: 'cancelled' };
      }
      // 某些受限上下文（如跨域 iframe）可能抛 SecurityError，降级走确认弹窗
    }
  }

  const chosenName = await promptFallbackFilename(options.suggestedName);
  if (!chosenName) {
    return { status: 'cancelled' };
  }
  const blob = await resolveBlob();
  saveAs(blob, chosenName);
  return { status: 'saved', fileName: chosenName, method: 'download' };
}

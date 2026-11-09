import React, { useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { toJS } from 'mobx';
import { toast } from 'react-toastify';
import {
  IconDownload, IconPencil, IconPlus, IconTrash, IconUpload, IconX,
} from '@tabler/icons-react';
import { useBulkStore } from '@/bulk/state/BulkStore';
import { presetFromJson, presetToJson } from '@/bulk/lib/presetIO';
import { buttonClass, inputClass } from '@/bulk/components/Panel';
import { ConfirmDialog, PromptDialog } from '@/bulk/components/Dialog';

export const downloadText = (filename: string, text: string, type: string) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const PresetBar: React.FC = observer(() => {
  const store = useBulkStore();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<'new' | 'rename' | 'delete' | null>(null);
  const closeDialog = () => setDialog(null);
  const { active } = store;

  const importFile = async (file: File) => {
    try {
      store.importPreset(presetFromJson(await file.text()));
      toast.success('Preset imported');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not import that file');
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2 items-center">
        <span className="font-serif font-bold text-white">Preset</span>
        <select
          id="bulk-preset"
          aria-label="Preset"
          className={`${inputClass} min-w-[200px]`}
          value={store.activeId || ''}
          onChange={(e) => store.setActive(e.target.value)}
        >
          {store.presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button
          type="button"
          className={buttonClass}
          onClick={() => setDialog('new')}
        >
          <span className="flex items-center gap-1">
            <IconPlus size={16} />
            {' '}
            New
          </span>
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={!active}
          onClick={() => setDialog('rename')}
        >
          <span className="flex items-center gap-1">
            <IconPencil size={16} />
            {' '}
            Rename
          </span>
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={!active}
          onClick={() => setDialog('delete')}
        >
          <span className="flex items-center gap-1">
            <IconTrash size={16} />
            {' '}
            Delete
          </span>
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={!active}
          onClick={() => active && downloadText(`${active.name}.json`, presetToJson(toJS(active)), 'application/json')}
        >
          <span className="flex items-center gap-1">
            <IconDownload size={16} />
            {' '}
            Export
          </span>
        </button>
        <button type="button" className={buttonClass} onClick={() => fileInput.current?.click()}>
          <span className="flex items-center gap-1">
            <IconUpload size={16} />
            {' '}
            Import
          </span>
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) importFile(file);
            e.target.value = '';
          }}
        />
      </div>
      {dialog === 'new' && (
        <PromptDialog
          title="New preset"
          label="Preset name"
          initial="New preset"
          submitLabel="Create"
          onSubmit={(name) => {
            store.createPreset(name);
            closeDialog();
          }}
          onCancel={closeDialog}
        />
      )}
      {dialog === 'rename' && active && (
        <PromptDialog
          title="Rename preset"
          label="Preset name"
          initial={active.name}
          submitLabel="Rename"
          onSubmit={(name) => {
            store.renamePreset(active.id, name);
            closeDialog();
          }}
          onCancel={closeDialog}
        />
      )}
      {dialog === 'delete' && active && (
        <ConfirmDialog
          title="Delete preset"
          message={`Delete the preset "${active.name}"? This can't be undone.`}
          submitLabel="Delete"
          onSubmit={() => {
            store.deletePreset(active.id);
            closeDialog();
          }}
          onCancel={closeDialog}
        />
      )}
      {store.warnings.length > 0 && (
        <div className="text-sm rounded px-3 py-2 bg-orange-500 text-white flex justify-between gap-2">
          <ul className="list-disc pl-4">
            {store.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
          <button type="button" aria-label="Dismiss" onClick={store.dismissWarnings}><IconX size={16} /></button>
        </div>
      )}
    </div>
  );
});

export default PresetBar;

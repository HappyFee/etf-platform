import { Copy, Layers3, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { StrategyConfig } from "../core/types";

export function StrategySwitcher({ strategies, config, onSelect, onEdit, onCreateBase,
  onCreateComposite, onDuplicate, onDelete }: {
  strategies: StrategyConfig[];
  config: StrategyConfig;
  onSelect: (id: string) => void;
  onEdit: () => void;
  onCreateBase: () => void;
  onCreateComposite: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const dependents = strategies.filter(strategy => strategy.kind === "composite" &&
    strategy.components.some(component => component.strategyId === config.id));
  const canDelete = strategies.length > 1 && dependents.length === 0;

  useEffect(() => {
    if (confirmingDelete) dialog.current?.showModal();
    else dialog.current?.close();
  }, [confirmingDelete]);

  return <>
    <div className="strategy-context" aria-label="当前策略工作区">
      <label className="strategy-context__selection" htmlFor="active-strategy">
        <span>当前策略 <small>{strategies.length} 个策略</small></span>
        <select id="active-strategy" data-testid="active-strategy" value={config.id}
          title={config.name} onChange={event => onSelect(event.target.value)}>
          {strategies.map(strategy => <option key={strategy.id} value={strategy.id}>
            {strategy.name} · {strategy.kind === "composite" ? "组合" : "基础"}
          </option>)}
        </select>
      </label>
      <div className="strategy-context__actions">
        <button className="text-action" onClick={onEdit} type="button">
          <Pencil size={16} /> 编辑策略
        </button>
        <button className="icon-action" aria-label="新基础策略" title="新建基础策略"
          onClick={onCreateBase} type="button"><Plus size={18} /></button>
        <button className="icon-action" aria-label="新组合策略" title="新建组合策略"
          onClick={onCreateComposite} type="button"><Layers3 size={18} /></button>
        <button className="icon-action" aria-label="复制当前策略" title="复制当前策略"
          onClick={onDuplicate} type="button"><Copy size={17} /></button>
        <button className="icon-action danger" aria-label="删除当前策略" title={strategies.length <= 1
          ? "至少保留一个策略" : "删除当前策略"} disabled={strategies.length <= 1}
          onClick={() => setConfirmingDelete(true)} type="button"><Trash2 size={17} /></button>
      </div>
    </div>
    <dialog ref={dialog} className="strategy-delete-dialog" aria-labelledby="strategy-delete-title"
      onCancel={() => setConfirmingDelete(false)} onClose={() => setConfirmingDelete(false)}>
      <h2 id="strategy-delete-title">{canDelete ? "删除策略？" : "暂时无法删除"}</h2>
      <p className="strategy-delete-name">{config.name}</p>
      {dependents.length > 0 ? <>
        <p>以下组合正在引用该策略，请先移除组合中的引用：</p>
        <ul>{dependents.map(strategy => <li key={strategy.id}>{strategy.name}</li>)}</ul>
      </> : <p>删除后无法恢复，已保存的回测快照仍会保留。</p>}
      <div className="strategy-delete-actions">
        <button className="text-action" autoFocus onClick={() => setConfirmingDelete(false)} type="button">
          {canDelete ? "取消" : "知道了"}
        </button>
        {canDelete && <button className="text-action danger" type="button" onClick={() => {
          setConfirmingDelete(false);
          onDelete();
        }}><Trash2 size={16} /> 确认删除</button>}
      </div>
    </dialog>
  </>;
}

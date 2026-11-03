'use client';
import { useApp } from '@/lib/store';
import { ProductForm } from './modals/ProductForm';
import { ImportJSON } from './modals/ImportJSON';
import { ConfirmDelete, ConfirmBulkDelete } from './modals/Confirm';
import { RelAdd } from './modals/RelAdd';

export function ModalRoot() {
  const { modal, setModal } = useApp();
  if (modal.kind === 'none') return null;
  const width = modal.kind === 'import' ? 760
    : modal.kind === 'delete' ? 440
    : modal.kind === 'bulkDelete' ? 420
    : modal.kind === 'relAdd' ? 460
    : 560;
  return (
    <div className="mod" onClick={e => { if (e.target === e.currentTarget) setModal({ kind: 'none' }); }}>
      <div style={{ '--w': `${width}px` } as React.CSSProperties}>
        {modal.kind === 'product' && <ProductForm id={modal.id} />}
        {modal.kind === 'import' && <ImportJSON />}
        {modal.kind === 'delete' && <ConfirmDelete id={modal.id} />}
        {modal.kind === 'bulkDelete' && <ConfirmBulkDelete />}
        {modal.kind === 'relAdd' && <RelAdd />}
      </div>
    </div>
  );
}

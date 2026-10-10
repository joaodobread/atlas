import { useToastViewModel } from '../../viewmodels/useToastViewModel.ts';

export function Toasts() {
  const vm = useToastViewModel();
  return (
    <div className="toasts">
      {vm.toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => vm.dismiss(t.id)}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

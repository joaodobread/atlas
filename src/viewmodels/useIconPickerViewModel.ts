import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { NodeKind } from '../../shared/constants.ts';
import { iconEntry, resolveIcon, searchIcons, type IconEntry, type IconGroup } from '../domain/iconCatalog.ts';
import { KIND_COLOR } from '../domain/visual.ts';

interface IconPickerArgs {
  /** Ícone escolhido; null = automático. */
  value: string | null;
  onChange(value: string | null): void;
  /** Usados para mostrar o ícone automático. */
  kind: NodeKind;
  tech: string;
}

export function useIconPickerViewModel({ value, onChange, kind, tech }: IconPickerArgs) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<CSSProperties>({});

  /** Posição fixa do popover (escapa do overflow dos painéis); abre para cima se faltar espaço embaixo. */
  const place = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 320;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const below = window.innerHeight - rect.bottom;
    setPlacement(
      below >= 380 || below >= rect.top
        ? { position: 'fixed', left, top: rect.bottom + 6, maxHeight: Math.min(360, below - 16) }
        : { position: 'fixed', left, bottom: window.innerHeight - rect.top + 6, maxHeight: Math.min(360, rect.top - 16) },
    );
  };

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const groups = useMemo(() => {
    const map = new Map<IconGroup, IconEntry[]>();
    for (const icon of searchIcons(query)) map.set(icon.group, [...(map.get(icon.group) ?? []), icon]);
    return [...map.entries()].map(([group, icons]) => ({ group, icons }));
  }, [query]);

  const effective = resolveIcon({ icon: value, tech: tech || null, kind });

  return {
    rootRef,
    open,
    query,
    setQuery,
    placement,
    toggle: () => {
      if (!open) place();
      setOpen(!open);
    },
    groups,
    effective,
    isAuto: value == null,
    label: value ? (iconEntry(value)?.label ?? value) : `Automático (${iconEntry(effective)?.label ?? ''})`,
    color: KIND_COLOR[kind],
    isSelected: (id: string) => id === value,
    choose: (id: string | null) => {
      onChange(id);
      setOpen(false);
      setQuery('');
    },
  };
}

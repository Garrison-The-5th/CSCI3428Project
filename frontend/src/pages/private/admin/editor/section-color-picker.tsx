/**
 * File: section-color-picker.tsx
 * Description: The swatch beside a section's delete button.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * The swatch beside a section's delete button.
 *
 * Shows the section's current tint as a circle; clicking opens the palette. The
 * palette is a closed set rather than a colour wheel because the tint sits
 * behind module titles — anything saturated would fight the text it exists to
 * group — and because a fixed set can be restyled later without unpicking
 * whatever hex codes ended up in the database.
 */
import { useEffect, useRef, useState } from 'react';

import { SECTION_COLORS } from '@/services/curriculum-api';

interface SectionColorPickerProps {
  color?: string | null;
  onSelect: (color: string | null) => void;
  /** Section title, so the control says which section it belongs to. */
  label: string;
}

const SectionColorPicker = ({ color, onSelect, label }: SectionColorPickerProps) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Clicking anywhere else, or pressing Escape, puts the palette away. Without
  // this it would sit open behind whatever the author did next.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const choose = (next: string | null) => {
    setOpen(false);
    // Picking what is already set is a no-op, not a pointless round trip.
    if ((next ?? null) === (color ?? null)) return;
    onSelect(next);
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={(event) => {
          // The heading around this is draggable and toggles the section;
          // neither should happen because a colour was picked.
          event.stopPropagation();
          setOpen((prev) => !prev);
        }}
        aria-expanded={open}
        aria-label={`Section colour for ${label}`}
        title="Section colour"
        className="flex h-7 w-7 items-center justify-center rounded-full transition-colors
          hover:bg-white/70"
      >
        <span
          className="block h-4 w-4 rounded-full border border-gray-400"
          style={{ backgroundColor: color ?? 'transparent' }}
        >
          {/* A diagonal stroke reads as "none" where an empty circle would just
              look like a colour that failed to load. */}
          {!color && (
            <svg viewBox="0 0 16 16" className="h-full w-full text-gray-500" aria-hidden="true">
              <line
                x1="3"
                y1="13"
                x2="13"
                y2="3"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          )}
        </span>
      </button>

      {open && (
        <div
          className="absolute top-8 right-0 z-20 w-44 rounded-lg border border-gray-300 bg-white p-2
            shadow-lg"
          // Stops a drag starting from inside the palette.
          draggable={false}
          onDragStart={(event) => event.preventDefault()}
        >
          <div className="grid grid-cols-4 gap-2">
            {SECTION_COLORS.map((swatch) => (
              <button
                key={swatch}
                type="button"
                onClick={() => choose(swatch)}
                aria-label={`Use ${swatch}`}
                title={swatch}
                className={`h-7 w-7 rounded-full border transition-transform hover:scale-110
                ${color === swatch ? 'border-navy ring-2 ring-navy' : 'border-gray-400'}`}
                style={{ backgroundColor: swatch }}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => choose(null)}
            className="mt-2 w-full rounded-md px-2 py-1 text-left text-xs font-medium text-dark-gray
              hover:bg-light-gray"
          >
            No colour
          </button>
        </div>
      )}
    </div>
  );
};

export default SectionColorPicker;

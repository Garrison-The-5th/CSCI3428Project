/**
 * File: color-picker.tsx
 * Description: A colour button that opens a swatch table with red, green and blue controls.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-15
 */
/**
 * Picking a colour for a shape, a border or a background.
 *
 * Two ways in, because authors come at colour two ways: a table of ready-made
 * swatches for "something blue", and red/green/blue sliders with exact numbers
 * (and a hex box) for "our brand blue". Both edit the same value, so picking a
 * swatch and then nudging its green channel just works.
 */
import { useEffect, useRef, useState } from 'react';

import { hexToRgb, isHexColor, rgbToHex } from '@/components/canvas/canvas-model';

/** Rows of the swatch table: greys, then each hue from pale to deep. */
const SWATCH_ROWS: string[][] = [
  [
    '#ffffff',
    '#e5e5e5',
    '#cccccc',
    '#b3b3b3',
    '#999999',
    '#7f7f7f',
    '#666666',
    '#4d4d4d',
    '#333333',
    '#000000',
  ],
  [
    '#fde2e2',
    '#fde9d3',
    '#fef6cf',
    '#e2f5d8',
    '#d6f0ef',
    '#dbeafe',
    '#e0e3fb',
    '#ece0fa',
    '#fbe0f0',
    '#f1e6dc',
  ],
  [
    '#f8a5a5',
    '#fbc48e',
    '#fde68a',
    '#b7e4a1',
    '#99dbd6',
    '#a5c8fa',
    '#adb6f4',
    '#cfb0f3',
    '#f4a9d3',
    '#d9bfa6',
  ],
  [
    '#ef4444',
    '#f97316',
    '#eab308',
    '#22c55e',
    '#14b8a6',
    '#3b82f6',
    '#6366f1',
    '#a855f7',
    '#ec4899',
    '#a16207',
  ],
  [
    '#b91c1c',
    '#c2410c',
    '#a16207',
    '#15803d',
    '#0f766e',
    '#1d4ed8',
    '#4338ca',
    '#7e22ce',
    '#be185d',
    '#78350f',
  ],
  [
    '#7f1d1d',
    '#7c2d12',
    '#713f12',
    '#14532d',
    '#134e4a',
    '#1e3a8a',
    '#312e81',
    '#581c87',
    '#831843',
    '#451a03',
  ],
];

const CHANNELS = [
  { key: 'r', label: 'Red', track: (c: Rgb) => [rgbToHex(0, c.g, c.b), rgbToHex(255, c.g, c.b)] },
  { key: 'g', label: 'Green', track: (c: Rgb) => [rgbToHex(c.r, 0, c.b), rgbToHex(c.r, 255, c.b)] },
  { key: 'b', label: 'Blue', track: (c: Rgb) => [rgbToHex(c.r, c.g, 0), rgbToHex(c.r, c.g, 255)] },
] as const;

type Rgb = { r: number; g: number; b: number };

/** The checkerboard that stands for "no colour". */
const NONE_BACKGROUND = 'repeating-conic-gradient(#d4d4d4 0% 25%, #ffffff 0% 50%) 50% / 8px 8px';

interface ColorPickerProps {
  label: string;
  value: string | null;
  onChange: (color: string | null) => void;
  /** Offers a "no colour" choice, named by this — e.g. "No border", "Same as shape". */
  noneLabel?: string;
  /** What the swatch on the button shows when the value is null. */
  noneDisplay?: string;
}

/**
 * A colour button that opens a swatch table with red, green and blue sliders and a hex field.
 * `noneLabel` adds a "no colour" choice, which reports null.
 */
const ColorPicker = ({ label, value, onChange, noneLabel, noneDisplay }: ColorPickerProps) => {
  const [open, setOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState(value ?? '');
  const wrapRef = useRef<HTMLDivElement>(null);

  const current = value ?? noneDisplay ?? '#000000';
  const rgb = hexToRgb(current);

  useEffect(() => setHexDraft(value ?? ''), [value]);

  // Closes when the author clicks anywhere else, the way a menu would.
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  /** Changes one of the red/green/blue channels and reports the resulting hex colour. */
  const setChannel = (key: 'r' | 'g' | 'b', amount: number) => {
    const next = { ...rgb, [key]: amount };
    onChange(rgbToHex(next.r, next.g, next.b));
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-8 items-center gap-2 rounded-md border border-gray-300 bg-white px-2
          text-sm text-dark-gray hover:bg-light-gray"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={label}
      >
        <span
          className="h-4 w-4 rounded-sm border border-gray-300"
          style={{ background: value ?? (noneDisplay ? noneDisplay : NONE_BACKGROUND) }}
        />
        {label}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={label}
          className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-gray-300
            bg-white p-3 text-dark-gray shadow-lg"
        >
          <table className="mb-3 border-separate" style={{ borderSpacing: 3 }}>
            <tbody>
              {SWATCH_ROWS.map((row) => (
                <tr key={row[0]}>
                  {row.map((swatch) => (
                    <td key={swatch} className="p-0">
                      <button
                        type="button"
                        onClick={() => onChange(swatch)}
                        className={`block h-5 w-5 rounded-sm border
                        ${value === swatch ? 'border-dark-gray ring-2 ring-navy' : 'border-gray-300'}`}
                        style={{ background: swatch }}
                        aria-label={swatch}
                        title={swatch}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex flex-col gap-2">
            {CHANNELS.map((channel) => {
              const [from, to] = channel.track(rgb);
              return (
                <label key={channel.key} className="flex items-center gap-2 text-xs">
                  <span className="w-10">{channel.label}</span>
                  <input
                    type="range"
                    min={0}
                    max={255}
                    value={rgb[channel.key]}
                    onChange={(e) => setChannel(channel.key, Number(e.target.value))}
                    className="h-2 flex-1 cursor-pointer appearance-none rounded-full"
                    style={{ background: `linear-gradient(to right, ${from}, ${to})` }}
                    aria-label={channel.label}
                  />
                  <input
                    type="number"
                    min={0}
                    max={255}
                    value={rgb[channel.key]}
                    onChange={(e) => setChannel(channel.key, Number(e.target.value))}
                    className="h-7 w-14 rounded border border-gray-300 px-1 text-right"
                    aria-label={`${channel.label} value`}
                  />
                </label>
              );
            })}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <span
              className="h-7 w-7 shrink-0 rounded border border-gray-300"
              style={{ background: value ?? NONE_BACKGROUND }}
            />
            <input
              value={hexDraft}
              onChange={(e) => {
                const typed = e.target.value.trim();
                setHexDraft(typed);
                const withHash = typed.startsWith('#') ? typed : `#${typed}`;
                if (isHexColor(withHash)) onChange(withHash.toLowerCase());
              }}
              placeholder="#1f4e79"
              className="h-7 min-w-0 flex-1 rounded border border-gray-300 px-2 text-sm"
              aria-label="Hex colour"
            />
            {noneLabel && (
              <button
                type="button"
                onClick={() => onChange(null)}
                className={`h-7 rounded border px-2 text-xs
                ${value === null ? 'border-navy bg-light-gray' : 'border-gray-300'}`}
              >
                {noneLabel}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ColorPicker;

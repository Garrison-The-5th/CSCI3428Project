/**
 * File: toggle-switch.tsx
 * Description: A labelled on/off switch.
 * Author: TTG Full-Stack Web Boilerplate
 * Date: 2026-08-10
 */
/**
 * A labelled on/off switch.
 *
 * Built on a real checkbox so it stays keyboard-operable and announces its state
 * to screen readers; the visuals are the sibling span.
 */
interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}

const ToggleSwitch = ({ checked, onChange, label, hint, disabled }: ToggleSwitchProps) => (
  <label className={`flex items-start gap-3 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
    <span className="relative mt-0.5 inline-flex shrink-0">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={`block h-6 w-11 rounded-full transition-colors duration-200
          peer-focus-visible:outline peer-focus-visible:outline-2
          peer-focus-visible:outline-offset-2 peer-focus-visible:outline-navy
          ${checked ? 'bg-[#5b9748]' : 'bg-gray-400'}`}
      />
      <span
        aria-hidden="true"
        className={`absolute top-0.5 left-0.5 block h-5 w-5 rounded-full bg-white shadow
          transition-transform duration-200 ${checked ? 'translate-x-5' : 'translate-x-0'}`}
      />
    </span>

    <span className="min-w-0">
      <span className="block text-sm font-medium text-dark-gray">{label}</span>
      {hint && <span className="block text-xs text-dark-gray">{hint}</span>}
    </span>
  </label>
);

export default ToggleSwitch;

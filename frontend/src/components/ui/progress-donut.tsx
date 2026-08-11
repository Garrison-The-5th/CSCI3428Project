/**
 * File: progress-donut.tsx
 * Description: Part-to-whole progress meter: one filled arc on a neutral track.
 * Author: TTG Full-Stack Web Boilerplate
 * Date: 2026-08-10
 */
/**
 * Part-to-whole progress meter: one filled arc on a neutral track.
 *
 * The percentage is always printed in the middle and the caption spells out the
 * counts, so the reading never depends on colour alone — which is also what keeps
 * the brand green usable at its low contrast against a light surface.
 *
 * Colours are the contrast-checked chart greens (#5b9748 light / #8cc975 dark),
 * not the lighter --color-green used for UI accents.
 */
interface ProgressDonutProps {
  percent: number;
  /** e.g. "3 of 8 modules" — printed under the ring. */
  caption?: string;
  size?: number;
  label?: string;
}

const ProgressDonut = ({ percent, caption, size = 120, label }: ProgressDonutProps) => {
  const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
  const stroke = Math.max(8, Math.round(size * 0.11));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = (safePercent / 100) * circumference;

  return (
    <figure className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={`${safePercent}% complete${caption ? ` — ${caption}` : ''}`}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            className="stroke-gray-300 dark:stroke-gray-600"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference - filled}`}
            // start at 12 o'clock and run clockwise
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            className="stroke-[#5b9748] dark:stroke-[#8cc975]"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-bold text-2xl text-dark-gray">{safePercent}%</span>
        </div>
      </div>
      {(label || caption) && (
        <figcaption className="text-center">
          {label && <p className="font-semibold text-dark-gray">{label}</p>}
          {caption && <p className="text-sm text-dark-gray">{caption}</p>}
        </figcaption>
      )}
    </figure>
  );
};

export default ProgressDonut;

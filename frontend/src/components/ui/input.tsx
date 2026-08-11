/**
 * File: input.tsx
 * Description: Input for the learning platform.
 * Author: TTG Full-Stack Web Boilerplate
 * Date: 2026-08-10
 */
import type { InputHTMLAttributes } from 'react';
import { forwardRef } from 'react';

import { cn } from '@/utils/utils';

const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, type = 'text', ...props },
  ref,
) {
  return (
    <input
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base',
        'ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium',
        'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2',
        `focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed
        disabled:opacity-50`,
        'md:text-sm',
        className,
      )}
      data-slot="input"
      ref={ref}
      type={type}
      {...props}
    />
  );
});

Input.displayName = 'Input';

export { Input };

/**
 * File: textarea.tsx
 * Description: Textarea for the learning platform.
 * Author: TTG Full-Stack Web Boilerplate
 * Date: 2026-08-10
 */
import type { TextareaHTMLAttributes } from 'react';
import { forwardRef } from 'react';

import { cn } from '@/utils/utils';

const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        className={cn(
          'flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-base',
          'ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
          className,
        )}
        data-slot="textarea"
        ref={ref}
        {...props}
      />
    );
  },
);

Textarea.displayName = 'Textarea';

export { Textarea };

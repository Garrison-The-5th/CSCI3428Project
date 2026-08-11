/**
 * File: card.tsx
 * Description: Card for the learning platform.
 * Author: TTG Full-Stack Web Boilerplate
 * Date: 2026-08-10
 */
import type { HTMLAttributes } from 'react';
import { forwardRef } from 'react';

import { cn } from '@/utils/utils';

const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function Card(
  { className, ...props },
  ref,
) {
  return (
    <div
      className={cn('rounded-xl border bg-card text-card-foreground shadow-sm', className)}
      data-slot="card"
      ref={ref}
      {...props}
    />
  );
});

const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function CardHeader(
  { className, ...props },
  ref,
) {
  return (
    <div
      className={cn('flex flex-col space-y-1.5 p-6', className)}
      data-slot="card-header"
      ref={ref}
      {...props}
    />
  );
});

const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  function CardTitle({ className, ...props }, ref) {
    return (
      <h3
        className={cn('font-semibold leading-none tracking-tight', className)}
        data-slot="card-title"
        ref={ref}
        {...props}
      />
    );
  },
);

const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  function CardDescription({ className, ...props }, ref) {
    return (
      <p
        className={cn('text-sm text-muted-foreground', className)}
        data-slot="card-description"
        ref={ref}
        {...props}
      />
    );
  },
);

const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function CardContent(
  { className, ...props },
  ref,
) {
  return (
    <div className={cn('p-6 pt-0', className)} data-slot="card-content" ref={ref} {...props} />
  );
});

const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function CardFooter(
  { className, ...props },
  ref,
) {
  return (
    <div
      className={cn('flex items-center p-6 pt-0', className)}
      data-slot="card-footer"
      ref={ref}
      {...props}
    />
  );
});

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };

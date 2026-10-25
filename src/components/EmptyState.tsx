import type { ReactNode } from 'react';

export default function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 bg-white px-6 py-20 text-center">
      <p className="text-headline font-semibold text-ink">{title}</p>
      {description && <p className="max-w-xs text-subhead text-muted">{description}</p>}
      {action}
    </div>
  );
}

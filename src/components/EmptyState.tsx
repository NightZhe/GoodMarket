import type { ReactNode } from 'react';

export default function EmptyState({ icon, title, action }: { icon: string; title: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-md bg-white px-6 py-20 text-center">
      <div className="text-6xl opacity-80">{icon}</div>
      <p className="text-muted">{title}</p>
      {action}
    </div>
  );
}

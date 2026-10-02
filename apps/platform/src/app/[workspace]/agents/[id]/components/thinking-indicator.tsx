'use client';

export function ThinkingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="bg-surface-200 flex items-center gap-1 rounded-2xl rounded-bl-sm px-4 py-3">
        <span className="bg-foreground-lighter h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:-0.3s]" />
        <span className="bg-foreground-lighter h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:-0.15s]" />
        <span className="bg-foreground-lighter h-1.5 w-1.5 animate-bounce rounded-full" />
      </div>
    </div>
  );
}

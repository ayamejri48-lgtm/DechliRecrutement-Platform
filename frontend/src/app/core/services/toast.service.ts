import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error' | 'info' | 'warn';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private seq = 0;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly _items = signal<ToastItem[]>([]);

  readonly items = this._items.asReadonly();

  success(message: string, durationMs = 4200): void {
    this.push('success', message, durationMs);
  }

  error(message: string, durationMs = 6500): void {
    this.push('error', message, durationMs);
  }

  info(message: string, durationMs = 4800): void {
    this.push('info', message, durationMs);
  }

  warn(message: string, durationMs = 5600): void {
    this.push('warn', message, durationMs);
  }

  dismiss(id: number): void {
    const t = this.timers.get(id);
    if (t) {
      clearTimeout(t);
      this.timers.delete(id);
    }
    this._items.update((list) => list.filter((x) => x.id !== id));
  }

  clear(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this._items.set([]);
  }

  private push(kind: ToastKind, message: string, durationMs: number): void {
    const text = (message ?? '').trim();
    if (!text) return;
    const id = ++this.seq;
    this._items.update((list) => [...list.slice(-4), { id, kind, message: text }]);
    if (durationMs > 0) {
      const timer = setTimeout(() => this.dismiss(id), durationMs);
      this.timers.set(id, timer);
    }
  }
}

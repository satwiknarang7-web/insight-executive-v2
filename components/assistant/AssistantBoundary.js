'use client';

import { Component } from 'react';

/**
 * The assistant sits on every page, so a fault in it must never take a page
 * down with it. On an error it shows what broke, and a way to start it again.
 */
export default class AssistantBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, tries: 0 };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[assistant]', error, info?.componentStack);
    try {
      sessionStorage.removeItem('insight.assistant.messages');
    } catch {
      /* storage blocked */
    }
  }

  render() {
    const { error, tries } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="fixed bottom-4 right-4 z-[60] w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-rose-500/30 bg-canvas-raised p-4 shadow-2xl shadow-black/30 print:hidden">
        <p className="text-[13px] font-bold text-white/90">The assistant hit a problem</p>
        <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words text-[11.5px] text-rose-300">{String(error?.message || error)}</pre>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => this.setState({ error: null, tries: tries + 1 })} className="rounded-lg bg-accent-500 px-3 py-1.5 text-[12px] font-bold text-on-accent hover:bg-accent-400">
            Restart assistant
          </button>
          <button type="button" onClick={() => window.location.reload()} className="rounded-lg border border-white/10 px-3 py-1.5 text-[12px] font-semibold text-white/65 hover:bg-white/5">
            Reload page
          </button>
        </div>
      </div>
    );
  }
}

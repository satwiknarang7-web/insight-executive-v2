'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * One bad result set should degrade one card, not blank the page.
 */
export default class ChartBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('[chart]', error, info?.componentStack);
  }

  componentDidUpdate(prevProps) {
    // Let a different chart recover after a sibling failed.
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-white/25">
          <AlertTriangle size={24} strokeWidth={1.4} />
          <p className="text-[10px] font-black uppercase tracking-[0.25em]">Could not draw this chart</p>
        </div>
      );
    }
    return this.props.children;
  }
}

'use client';

import { Component } from 'react';

/**
 * The assistant sits on every page, so a fault in it must never take a page
 * down with it. On an error it logs, hides itself, and the page carries on.
 */
export default class AssistantBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error('[assistant]', error);
    try {
      sessionStorage.removeItem('insight.assistant.messages');
    } catch {
      /* storage blocked */
    }
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

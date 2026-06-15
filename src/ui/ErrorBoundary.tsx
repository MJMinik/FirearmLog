// Audit CR-17 / #D16: an app-wide safety net. If a screen ever throws while
// rendering, the user gets a calm "something went wrong — reload" instead of a
// blank/white screen. Their data is untouched (this only affects rendering).
import { Component } from 'react';
import type { ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.error('FirearmLog render error:', error);
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <div className="screen">
          <div className="card" style={{ marginTop: 24 }}>
            <h2>Something went wrong</h2>
            <p className="report-note" style={{ marginBottom: 12 }}>
              This screen hit an unexpected error. Your data is safe on this device —
              reloading usually clears it.
            </p>
            <button className="button" onClick={() => location.reload()}>Reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

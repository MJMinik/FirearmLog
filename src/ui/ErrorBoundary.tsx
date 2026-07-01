// Audit CR-17 / #D16: an app-wide safety net. If a screen ever throws while
// rendering, the user gets a calm "something went wrong — reload" instead of a
// blank/white screen. Their data is untouched (this only affects rendering).
//
// RR-2: there's no server and no analytics (by design — nothing about the user
// ever leaves the device), so the only way we learn about a crash is if the
// person tells us. "Copy error details" lets a tester grab the exact error +
// app version and paste it into an email — but nothing is sent anywhere unless
// the user chooses to.
import { Component } from 'react';
import type { ReactNode } from 'react';
import { APP_VERSION } from '../version.ts';

interface ErrorBoundaryState {
  failed: boolean;
  message: string;
  copied: boolean;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false, message: '', copied: false };

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    const message = error instanceof Error ? (error.stack || error.message) : String(error);
    return { failed: true, message };
  }

  componentDidCatch(error: unknown): void {
    console.error('FirearmLog render error:', error);
  }

  private details(): string {
    return [
      `FirearmLog v${APP_VERSION}`,
      `When: ${new Date().toISOString()}`,
      `Device: ${navigator.userAgent}`,
      '',
      'Error:',
      this.state.message || '(no details captured)',
    ].join('\n');
  }

  private copy = (): void => {
    const text = this.details();
    const done = () => this.setState({ copied: true });
    try {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(done);
        return;
      }
    } catch {
      /* fall through to the manual path */
    }
    // Fallback for older browsers: select the text so the user can copy it.
    done();
  };

  // Recover in place: clear the error so the children re-render. If the fault is
  // deterministic it re-trips and shows this card again (no worse); if it was
  // transient, the screen comes back. Navigation also resets it (App keys this
  // boundary to the current view). Pro-grade audit T1-2.
  private reset = (): void => this.setState({ failed: false, message: '', copied: false });

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <div className="screen">
          <div className="card" style={{ marginTop: 24 }}>
            <h2>Something went wrong</h2>
            <p className="report-note" style={{ marginBottom: 12 }}>
              This screen hit an unexpected error. Your data is safe on this device —
              tap Try again, or switch to another tab, to recover.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="button" style={{ flex: 1, minWidth: 120 }} onClick={this.reset}>Try again</button>
              <button className="button secondary" style={{ flex: 1, minWidth: 120 }} onClick={() => location.reload()}>Reload</button>
            </div>
            <button className="button secondary" style={{ width: '100%', marginTop: 8 }} onClick={this.copy}>
              {this.state.copied ? 'Copied ✓' : 'Copy error details'}
            </button>
            {this.state.copied && (
              <p className="report-note" style={{ marginTop: 12 }}>
                Copied. If this keeps happening, paste it into an email to support so we can fix it.
              </p>
            )}
            <textarea
              readOnly
              value={this.details()}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Error details"
              style={{ width: '100%', minHeight: 90, marginTop: 12, fontFamily: 'monospace', fontSize: 12 }}
            />
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

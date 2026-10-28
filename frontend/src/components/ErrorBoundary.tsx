import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./common/Button";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level React error boundary (#818).
 *
 * Without one, any exception thrown during render unmounts the entire React
 * tree and the user is left staring at a blank white page with no diagnostic —
 * that's how a single bad model (e.g. Cohen & Huston 1994's non-2-D run output)
 * could take down the whole app. This catches render/lifecycle errors, keeps
 * the page mounted, and shows a readable fallback with the error message and a
 * reload button instead of a white screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to the console so it still shows up in devtools / e2e capture.
    console.error(
      "Unhandled render error caught by ErrorBoundary:",
      error,
      info.componentStack,
    );
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        data-testid="error-boundary-fallback"
        role="alert"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          alignItems: "flex-start",
          maxWidth: 720,
          margin: "48px auto",
          padding: "20px 24px",
          fontFamily: "system-ui, sans-serif",
          color: "var(--pnv-text-body)",
          background: "var(--pnv-danger-tint)",
          border: "1px solid var(--pnv-danger-border)",
          borderRadius: 8,
        }}
      >
        <h2 style={{ margin: 0, fontSize: "var(--pnv-fs-18)" }}>Something went wrong</h2>
        <p style={{ margin: 0, color: "var(--pnv-text-secondary)" }}>
          The app hit an unexpected error while rendering. Your work isn&rsquo;t
          lost — reload to recover, and please report this with the details below.
        </p>
        <pre
          style={{
            margin: 0,
            padding: "10px 12px",
            width: "100%",
            overflow: "auto",
            fontSize: "var(--pnv-fs-12)",
            background: "var(--pnv-surface)",
            border: "1px solid var(--pnv-danger-border)",
            borderRadius: 4,
            whiteSpace: "pre-wrap",
          }}
        >
          {error.message}
        </pre>
        <Button kind="secondary" size="compact" onClick={this.handleReload}>
          Reload
        </Button>
      </div>
    );
  }
}

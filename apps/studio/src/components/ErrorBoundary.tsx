import { Component, ReactNode } from "react";

interface Props { children: ReactNode; name?: string }
interface State { error: Error | null }

/** Keeps one broken panel from blanking the whole Studio. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="empty-sm boundary">
          <b>{this.props.name || "This panel"} failed to render.</b>
          <pre className="err">{this.state.error.message}</pre>
          <button className="small ghost" onClick={() => this.setState({ error: null })}>
            retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

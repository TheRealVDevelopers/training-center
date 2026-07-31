import { Component } from 'react'

// A crash on the reception desk mid-Saturday must never leave a white screen
// with a queue waiting. Show something human, and a reload button.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { err: null }
  }

  static getDerivedStateFromError(err) {
    return { err }
  }

  componentDidCatch(err) {
    // Keep it in the console for later; nothing to report home to.
    console.error('App crashed:', err)
  }

  render() {
    if (!this.state.err) return this.props.children
    return (
      <div className="center">
        <div className="card narrow center-text">
          <div className="brand"><span className="leaf">🌿</span> Something went wrong</div>
          <p className="muted">
            The screen hit a problem. Nothing is lost — taps and payments are saved as they happen.
          </p>
          <button className="btn primary block" onClick={() => window.location.reload()}>Reload the screen</button>
          <p className="muted small" style={{ marginTop: 12 }}>
            If it keeps happening, check the internet connection and reload again.
          </p>
        </div>
      </div>
    )
  }
}

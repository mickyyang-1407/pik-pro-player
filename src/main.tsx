import { render } from 'solid-js/web';
import './styles.css';

function App() {
  return (
    <main class="app-shell">
      <section class="hero-panel" aria-label="Pik Pro Player reset status">
        <p class="eyebrow">Fresh start</p>
        <h1>Pik Pro Player</h1>
        <p class="summary">
          Clean Tauri + Solid foundation for the professional mix review player.
        </p>
        <div class="status-grid">
          <div>
            <span>Legacy</span>
            <strong>Archived</strong>
          </div>
          <div>
            <span>Frontend</span>
            <strong>Ready</strong>
          </div>
          <div>
            <span>Desktop</span>
            <strong>Tauri v2</strong>
          </div>
        </div>
      </section>
    </main>
  );
}

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element #root was not found.');
}

render(() => <App />, root);

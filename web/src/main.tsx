import { createRoot } from 'react-dom/client';
// order matters: the TrustedScriptURL Worker patch must be in place before the
// import graph pulls in livekit (E2EEWorker extends window.Worker)
import './lib/ttWorker';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(<App />);
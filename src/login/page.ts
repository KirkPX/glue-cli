import { config } from '../config.js';

/** Firebase's script version. Pinned, and loaded on this page only. See .cli-standard.json. */
export const FIREBASE_VERSION = '10.12.0';

/** A value placed inside the page's script, unable to end the script early. */
function inScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * The sign-in page served on loopback during `glue login`.
 *
 * Glue signs in only through Firebase's signInWithPopup, so this page must load Firebase's library.
 * It loads nothing else. Text from the sign-in goes in with textContent, never as HTML.
 */
export function loginPage(opts: { nonce: string }): string {
  const firebase = {
    apiKey: config.firebase.apiKey,
    authDomain: config.firebase.authDomain,
    projectId: config.firebase.projectId,
  };
  return `<!DOCTYPE html>
<html>
<head>
  <title>Glue CLI Login</title>
  <script src="https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth-compat.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { background: #1e293b; border-radius: 16px; padding: 48px; max-width: 520px; width: 100%; text-align: center; }
    h1 { font-size: 28px; margin-bottom: 8px; }
    .subtitle { color: #94a3b8; margin-bottom: 40px; font-size: 15px; }
    .google-btn { display: inline-flex; align-items: center; gap: 12px; background: white; color: #1f2937; border: none; padding: 14px 32px; border-radius: 10px; font-size: 16px; font-weight: 600; cursor: pointer; transition: box-shadow 0.15s; }
    .google-btn:hover { box-shadow: 0 4px 16px rgba(59,130,246,0.3); }
    .google-btn:disabled { opacity: 0.6; cursor: wait; }
    .google-btn svg { width: 20px; height: 20px; }
    #status { margin-top: 32px; padding: 20px; border-radius: 10px; font-weight: 500; }
    .idle { background: transparent; }
    .progress { background: #1e3a5f; color: #93c5fd; }
    .success { background: #064e3b; color: #6ee7b7; font-size: 17px; }
    .error { background: #7f1d1d; color: #fca5a5; }
    .token-display { margin-top: 20px; text-align: left; }
    .token-display label { display: block; font-size: 12px; color: #64748b; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.05em; }
    .token-display textarea { width: 100%; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #94a3b8; padding: 12px; font-family: monospace; font-size: 11px; resize: none; height: 60px; }
    .spinner { display: inline-block; width: 18px; height: 18px; border: 2px solid #93c5fd; border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 8px; vertical-align: middle; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .fallback { margin-top: 24px; font-size: 13px; color: #475569; }
    .fallback code { background: #0f172a; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Glue CLI Login</h1>
    <p class="subtitle">Sign in with your Glue account</p>

    <button class="google-btn" id="googleBtn" onclick="googleSignIn()">
      <svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
      Sign in with Google
    </button>

    <div id="status" class="idle"></div>
  </div>

  <script>
    firebase.initializeApp(${inScript(firebase)});
    const auth = firebase.auth();
    var NONCE = ${inScript(opts.nonce)};

    async function googleSignIn() {
      const btn = document.getElementById('googleBtn');
      const status = document.getElementById('status');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Waiting for Google...';
      status.className = 'progress';
      status.innerHTML = '<span class="spinner"></span> Google sign-in popup is open. Complete the sign-in there.';

      try {
        const provider = new firebase.auth.GoogleAuthProvider();
        const result = await auth.signInWithPopup(provider);
        const refreshToken = result.user.refreshToken;
        const email = result.user.email;

        status.textContent = 'Signed in as ' + email + '. Sending to the CLI...';

        const res = await fetch('/callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: refreshToken, nonce: NONCE })
        });

        if (res.ok) {
          status.className = 'success';
          status.innerHTML = '&#10003; Connected! Return to your terminal.';
          btn.style.display = 'none';
        } else {
          const data = await res.json();
          throw new Error(data.error || 'The CLI rejected this sign-in.');
        }
      } catch (err) {
        if (err.code === 'auth/popup-closed-by-user') {
          status.className = 'idle';
          status.innerHTML = '';
          btn.disabled = false;
          btn.innerHTML = '<svg viewBox="0 0 24 24" style="width:20px;height:20px"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg> Sign in with Google';
          return;
        }

        status.className = 'error';
        const msg = err.message || 'Sign-in failed';
        status.textContent = msg.includes('glue login') ? msg : msg + ' Trouble? Press Ctrl-C in the terminal, then run: glue login --email';
        btn.disabled = false;
        btn.innerHTML = '<svg viewBox="0 0 24 24" style="width:20px;height:20px"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg> Try again';
      }
    }
  </script>
</body>
</html>`;
}

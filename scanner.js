<!DOCTYPE html>
<html>
<head>
<base target="_top">
<meta charset="utf-8">
<style>
  :root{
    --ink:#0B1220;      /* base */
    --ink-2:#141E33;    /* raised */
    --line:#2A3752;
    --text:#EAF0FA;
    --muted:#8B9BB8;
    --admit:#12B76A;
    --exit:#3B82F6;
    --hold:#F79009;
    --stop:#F04438;
  }
  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
  html,body{margin:0;height:100%}
  body{
    background:var(--ink);color:var(--text);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
    font-variant-numeric:tabular-nums;
    display:flex;flex-direction:column;overflow:hidden;
  }

  /* ---- header ---- */
  header{padding:10px 14px 0;flex:0 0 auto}
  .who{display:flex;justify-content:space-between;align-items:baseline;
       font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
  .modes{display:flex;gap:6px;margin-top:10px;background:var(--ink-2);
         border:1px solid var(--line);border-radius:14px;padding:4px}
  .modes button{
    flex:1;border:0;background:transparent;color:var(--muted);
    font:600 15px/1 inherit;letter-spacing:.04em;padding:13px 0;border-radius:10px;cursor:pointer}
  .modes button[aria-pressed="true"]{background:var(--text);color:var(--ink)}
  .modes button:focus-visible{outline:2px solid var(--exit);outline-offset:2px}

  /* ---- camera ---- */
  main{flex:1 1 auto;position:relative;margin:12px 14px;border-radius:18px;
       overflow:hidden;background:#000;border:1px solid var(--line)}
  #reader{width:100%;height:100%}
  #reader video{width:100%!important;height:100%!important;object-fit:cover}
  .hint{position:absolute;inset:auto 0 0 0;padding:10px;text-align:center;
        font-size:13px;color:var(--muted);background:linear-gradient(transparent,rgba(11,18,32,.9))}

  /* ---- result flood ---- */
  #result{position:fixed;inset:0;z-index:20;display:none;
          flex-direction:column;justify-content:center;padding:28px;color:#04140C}
  #result.show{display:flex;animation:pop .14s ease-out}
  @keyframes pop{from{opacity:0;transform:scale(.98)}to{opacity:1;transform:none}}
  #result .verdict{font:800 14px/1 inherit;letter-spacing:.22em;text-transform:uppercase;opacity:.7}
  #result .headline{font:800 clamp(34px,10vw,60px)/1.02 inherit;margin:10px 0 4px;word-break:break-word}
  #result .roll{font:600 clamp(17px,5vw,24px)/1.3 inherit;opacity:.75}
  #result .detail{font:500 17px/1.4 inherit;margin-top:16px;opacity:.85}
  #result .actions{display:flex;gap:10px;margin-top:22px}
  #result .actions:empty{display:none}
  #result .actions button{flex:1;border:2px solid currentColor;border-radius:14px;
    padding:18px 0;background:rgba(255,255,255,.5);color:inherit;
    font:800 17px/1 inherit;cursor:pointer}
  #result .tapaway{margin-top:auto;font:600 13px/1 inherit;letter-spacing:.1em;
                   text-transform:uppercase;opacity:.55;text-align:center}

  /* signature: capacity pips */
  .pips{display:flex;gap:10px;margin-top:22px}
  .pip{width:40px;height:40px;border-radius:50%;border:3px solid currentColor}
  .pip.on{background:currentColor}

  .bg-ALLOW{background:var(--admit)}
  .bg-EXIT{background:var(--exit);color:#03102A}
  .bg-FULL,.bg-WARN{background:var(--hold)}
  .bg-INVALID,.bg-BLOCKED,.bg-DENIED{background:var(--stop);color:#2A0505}
  .bg-INFO{background:var(--text);color:var(--ink)}

  /* ---- manual ---- */
  footer{flex:0 0 auto;padding:0 14px 14px}
  details summary{list-style:none;cursor:pointer;font-size:13px;color:var(--muted);
                  padding:8px 0;letter-spacing:.04em}
  details summary::-webkit-details-marker{display:none}
  .manual{display:flex;gap:8px}
  .manual input{flex:1;background:var(--ink-2);border:1px solid var(--line);
    border-radius:12px;color:var(--text);font:600 17px inherit;padding:13px;min-width:0}
  .manual button{background:var(--text);color:var(--ink);border:0;border-radius:12px;
    font:700 15px inherit;padding:0 18px;cursor:pointer}
  .err{color:var(--hold);font-size:13px;padding:6px 0}
  #photoBtn{display:block;width:100%;margin-bottom:10px;background:var(--ink-2);color:var(--text);
    border:1px solid var(--line);border-radius:14px;font:600 15px/1 inherit;padding:14px 0;cursor:pointer}
  @media (prefers-reduced-motion:reduce){#result.show{animation:none}}

  #signin{position:fixed;inset:0;z-index:30;background:var(--ink);
    display:none;flex-direction:column;align-items:center;justify-content:center;
    padding:32px;text-align:center;gap:16px}
  #signin.show{display:flex}
  #signin h1{font:800 22px/1.3 inherit;margin:0}
  #signin p{font:400 14px/1.5 inherit;color:var(--muted);margin:0;max-width:320px}
  #signin .denied{color:var(--stop);font:600 14px/1.4 inherit;max-width:320px}
  #signout{display:none;background:transparent;color:var(--muted);
    border:1px solid var(--line);border-radius:8px;
    font:600 10px/1 inherit;letter-spacing:.03em;padding:5px 8px;
    cursor:pointer;flex:0 0 auto;white-space:nowrap}
  .who{gap:10px}
  .who #vol{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px}
</style>
</head>
<body>

<header>
  <div class="who">
    <span>Gate scanner</span>
    <span style="display:flex;align-items:center;gap:8px;min-width:0">
      <span id="vol"><?= volunteer ?></span>
      <button id="signout" onclick="signOut()">Switch</button>
    </span>
  </div>
  <div class="modes" role="group" aria-label="Scan mode">
    <button id="m-IN"    aria-pressed="true"  onclick="setMode('IN')">Entry</button>
    <button id="m-OUT"   aria-pressed="false" onclick="setMode('OUT')">Exit</button>
    <button id="m-CHECK" aria-pressed="false" onclick="setMode('CHECK')">Look up</button>
  </div>
</header>

<main>
  <div id="reader"></div>
  <div class="hint" id="hint">Point at the pass</div>
</main>

<footer>
  <button id="photoBtn" onclick="document.getElementById('photoIn').click()">📷 Take photo of pass (if camera above will not scan)</button>
  <input type="file" id="photoIn" accept="image/*" capture="environment"
         style="display:none" onchange="scanPhoto(this)">
  <details id="manualBox" style="display:none">
    <summary>Pass damaged? Type the Pass ID</summary>
    <div class="manual">
      <input id="manualId" placeholder="P0001" autocapitalize="characters" autocomplete="off">
      <button onclick="sendManual()">Go</button>
    </div>
  </details>
  <div class="err" id="err"></div>
</footer>

<div id="signin">
  <h1>Volunteer sign-in</h1>
  <p>Sign in with the Google account your coordinator registered for you.</p>
  <div id="gbtn"></div>
  <p id="signinWait" style="display:none;color:var(--text);font:600 15px/1.4 inherit">
    Verifying your account…<br>
    <span style="color:var(--muted);font-weight:400;font-size:13px">
      This can take up to 30 seconds. Please don't tap again.</span>
  </p>
  <p class="denied" id="signinErr"></p>
</div>

<div id="result" onclick="dismiss()">
  <div class="verdict" id="r-verdict"></div>
  <div class="headline" id="r-headline"></div>
  <div class="roll" id="r-roll"></div>
  <div class="pips" id="r-pips"></div>
  <div class="detail" id="r-detail"></div>
  <div class="actions" id="r-actions"></div>
  <div class="tapaway">Tap to scan the next pass</div>
</div>

<!-- NOTE: this page is now served only in key mode (see doGet). If you expect to
     rely on that degraded mode, consider inlining these two libraries — an
     external CDN is exactly what you cannot count on if the reason you are in
     degraded mode is a network problem. -->
<script src="https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js"></script>
<script src="https://unpkg.com/jsqr@1.4.0/dist/jsQR.js"></script>
<script>
  var MODE = 'IN';
  var VOLKEY = <?!= JSON.stringify(volKey) ?>;
  var busy = false, lastCode = '', lastAt = 0, scanner = null;

  function setMode(m){
    MODE = m;
    ['IN','OUT','CHECK'].forEach(function(k){
      document.getElementById('m-'+k).setAttribute('aria-pressed', String(k===m));
    });
    document.getElementById('hint').textContent =
      m==='IN' ? 'Point at the pass to admit' :
      m==='OUT'? 'Point at the pass to check out' :
                 'Point at the pass to view details';
  }

  /* One AudioContext, reused. Creating a new one per scan hits the browser's
     concurrent-context cap (around six) after a handful of scans, at which
     point construction throws and the beeps stop for the rest of the shift —
     silently, because the failure is swallowed. Volunteers rely on that sound
     in a noisy hall more than on the screen. */
  var audioCtx = null;
  function beep(ok){
    try{
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();   // mobile suspends until a gesture
      var a = audioCtx;
      var o = a.createOscillator(), g = a.createGain();
      o.connect(g); g.connect(a.destination);
      o.frequency.value = ok ? 880 : 220;
      g.gain.setValueAtTime(.14, a.currentTime);
      g.gain.exponentialRampToValueAtTime(.0001, a.currentTime + (ok?.16:.42));
      o.start(); o.stop(a.currentTime + (ok?.18:.45));
      o.onended = function(){ try { o.disconnect(); g.disconnect(); } catch(e){} };
    }catch(e){}
  }

  function show(res){
    clearPending();
    if (res.status === 'DENIED' && CLIENT_ID){
      // Only ignore a rejection belonging to a session we have since replaced.
      // Checking "is VOLKEY set" was wrong: it is true both before and after
      // sign-in, so an expired session swallowed every rejection silently.
      if (res._staleSession) { releaseScanner(); return; }
      clearSession();
      resetSignInUi();
      document.getElementById('signinErr').textContent = res.detail || res.headline || '';
      document.getElementById('signin').className = 'show';
      releaseScanner();
      return;
    }
    busy = true;
    var ok = (res.status==='ALLOW'||res.status==='EXIT'||res.status==='INFO');
    beep(ok);
    if (navigator.vibrate) navigator.vibrate(ok?60:[90,70,90]);

    var box = document.getElementById('result');
    box.className = 'show bg-' + res.status;
    document.getElementById('r-verdict').textContent =
      ({ALLOW:'Let them in', EXIT:'Checked out', FULL:'Hold — pass is full',
        WARN:'Check this', INFO:'Details only', INVALID:'Do not admit',
        BLOCKED:'Do not admit', DENIED:'Access problem'})[res.status] || res.status;
    document.getElementById('r-headline').textContent = res.headline || '';
    document.getElementById('r-roll').textContent =
      [res.roll, res.dept, res.passId].filter(Boolean).join('  ·  ');
    document.getElementById('r-detail').textContent = res.detail || '';

    var pips = '', cap = Math.min(Number(res.capacity) || 0, 10);   // sheet typo guard
    for (var i = 1; i <= cap; i++) pips += '<div class="pip' + (i <= res.inside ? ' on' : '') + '"></div>';
    document.getElementById('r-pips').innerHTML = pips;

    document.getElementById('r-actions').innerHTML = '';
  }

  var pending = false, pendingTimer = null;

  function showPending(){
    busy = true; pending = true;
    var t0 = Date.now();
    var box = document.getElementById('result');
    box.className = 'show bg-INFO';
    document.getElementById('r-verdict').textContent = 'Checking';
    document.getElementById('r-headline').textContent = 'Please wait';
    document.getElementById('r-roll').textContent = '';
    document.getElementById('r-pips').innerHTML = '';
    document.getElementById('r-actions').innerHTML = '';
    var det = document.getElementById('r-detail');
    det.textContent = 'Looking up the pass\u2026';
    clearInterval(pendingTimer);
    pendingTimer = setInterval(function(){
      var s = Math.round((Date.now() - t0) / 1000);
      det.textContent = s < 4 ? 'Looking up the pass\u2026'
        : 'Still working \u2014 ' + s + 's. Do not scan again yet.';
    }, 500);
  }

  function clearPending(){
    pending = false;
    clearInterval(pendingTimer);
    pendingTimer = null;
  }

  /* onScan() pauses the camera before every request. Every route out of that
     request must return through here, or the camera stays paused and the
     scanner silently stops working with nothing on screen to explain it. */
  /* Declared above its first use rather than relying on var hoisting: it is
     assigned in releaseScanner/dismiss below and read in onScan further down,
     and a reader should not have to reason about load order to see that. */
  var resumeAt = 0;

  function releaseScanner(){
    pending = false;
    clearInterval(pendingTimer);
    pendingTimer = null;
    busy = false;
    document.getElementById('result').className = '';
    resumeAt = Date.now();
    if (scanner) { try { scanner.resume(); } catch(e){} }
  }

  function dismiss(){
    if (pending) return;              // ignore taps while waiting for the server
    document.getElementById('result').className = '';
    busy = false;
    resumeAt = Date.now();
    if (scanner) { try { scanner.resume(); } catch(e){} }
  }

  function send(code){
    var sentUnder = VOLKEY;
    if (CLIENT_ID && !VOLKEY){
      resetSignInUi();
      document.getElementById('signin').className = 'show';
      releaseScanner();          // unwind: do not strand the paused camera
      return;
    }
    document.getElementById('err').textContent = '';
    showPending();
    google.script.run
      .withSuccessHandler(function(res){ res._staleSession = (sentUnder !== VOLKEY); show(res); })
      .withFailureHandler(function(){
        /* Previously this set busy=false and stopped. pending stayed true, the
           timer kept running, the overlay stayed frozen on "Checking", and
           dismiss() early-returns while pending — so the phone was dead until
           reload. Routing through show() clears pending and gives the volunteer
           something to tap. */
        show({ status:'INVALID', headline:'Could not reach the server',
               detail:'Check the signal and scan again.' });
      })
      .processScan(code, MODE, VOLKEY, NONCE, null, null);
  }

  function sendManual(){
    var v = document.getElementById('manualId').value;
    if(!v) return;
    document.getElementById('manualId').value = '';
    var sentUnderManual = VOLKEY;
    showPending();
    google.script.run
      .withSuccessHandler(function(res){
        if (res && typeof res === 'object') res._staleSession = (sentUnderManual !== VOLKEY);
        show(res);
      })
      .withFailureHandler(function(){
        show({ status:'INVALID', headline:'Could not reach the server',
               detail:'Check the signal and try again.' });
      })
      .processManual(v, MODE, VOLKEY, NONCE, null, null);
  }

  /* 700 ms, not 4000 — see scanner.js. The old window silently discarded
     guests two and three on the same pass. */
  /* See scanner.js: the grace period is measured from the camera RESUMING, not
     from the last decode, so a pass still in front of the lens after a dismissal
     is not read again immediately. */
  var DUPE_WINDOW_MS = 700;
  var SAME_PASS_GRACE_MS = 2500;

  /* See scanner.js: a suspended tab can leave a frozen frame that gets decoded
     again on wake, admitting somebody who is not there. */
  /* Restart, not resume: backgrounding can end the camera track, and resume()
     only un-pauses a video element that then has no live stream behind it. */
  function restartCamera_(){
    resumeAt = Date.now();
    if (!scanner) { startCamera(); return; }
    var old = scanner; scanner = null;
    var again = function(){ startCamera(); };
    try { old.stop().then(again, again); } catch(e){ again(); }
  }

  document.addEventListener('visibilitychange', function(){
    if (document.hidden){
      if (scanner) { try { scanner.pause(true); } catch(e){} }
      return;
    }
    if (busy) return;
    restartCamera_();
  });

  function onScan(text){
    var now = Date.now();
    if (busy) return;
    if (text === lastCode &&
        (now - lastAt < DUPE_WINDOW_MS || now - resumeAt < SAME_PASS_GRACE_MS)) return;
    lastCode = text; lastAt = now;
    if (scanner) { try { scanner.pause(true); } catch(e){} }
    send(text);
  }

  function loadImage_(file){
    return new Promise(function(res, rej){
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload  = function(){ URL.revokeObjectURL(url); res(img); };
      img.onerror = function(){ URL.revokeObjectURL(url); rej(new Error('load')); };
      img.src = url;
    });
  }

  function tryDecode_(img, maxDim, crop){
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    var sx = 0, sy = 0, sw = iw, sh = ih;
    if (crop){ sw = iw * 0.55; sh = ih * 0.55; sx = (iw - sw) / 2; sy = (ih - sh) / 2; }
    var scale = Math.min(1, maxDim / Math.max(sw, sh));
    var w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    var d = ctx.getImageData(0, 0, w, h);
    var r = jsQR(d.data, w, h, { inversionAttempts: 'attemptBoth' });
    return r && r.data ? r.data : null;
  }

  var ATTEMPTS = [[1000,false],[1500,false],[700,false],[1000,true],[1600,true],[500,false]];

  function scanPhoto(input){
    var f = input.files && input.files[0];
    if(!f) return;
    if (typeof jsQR === 'undefined'){
      document.getElementById('err').textContent =
        'Decoder did not load. Check the phone has internet, then reload this page.';
      return;
    }
    input.value = '';
    var err = document.getElementById('err');
    err.textContent = 'Reading photo\u2026';
    loadImage_(f).then(function(img){
      for (var i = 0; i < ATTEMPTS.length; i++){
        var text = null;
        try { text = tryDecode_(img, ATTEMPTS[i][0], ATTEMPTS[i][1]); } catch(e){}
        if (text){
          err.textContent = '';
          lastCode = ''; busy = false;
          send(text);
          return;
        }
      }
      err.textContent = 'No QR found in that photo. Move closer so the code fills '
                      + 'most of the frame, hold the phone flat, and keep it steady.';
    }).catch(function(){
      err.textContent = 'Could not open that photo. Try again.';
    });
  }

  function startCamera(){
    scanner = new Html5Qrcode('reader', { verbose:false });
    scanner.start(
      { facingMode: 'environment' },
      { fps: 12, qrbox: { width: 240, height: 240 } },
      onScan,
      function(){}
    ).catch(function(){
      document.getElementById('hint').textContent =
        'Live camera blocked on this phone — use "Take photo of pass" below.';
    });
  }

  var CLIENT_ID = <?!= JSON.stringify(clientId) ?>;
  var NONCE = '', ROLE = '';

  function saveSession(key, name, nonce, role){
    VOLKEY = key;
    NONCE = nonce || NONCE;
    ROLE = role || '';
    try {
      sessionStorage.setItem('gatescanner_session', JSON.stringify(
        { key: key, name: name, nonce: NONCE, role: ROLE, ts: Date.now() }));
    } catch(e){}
    applyRole();
    document.getElementById('vol').textContent = name;
    document.getElementById('signout').style.display = 'inline-block';
  }

  function clearSession(){
    VOLKEY = ''; NONCE = ''; ROLE = '';
    applyRole();
    try { sessionStorage.removeItem('gatescanner_session'); } catch(e){}
    document.getElementById('signout').style.display = 'none';
  }

  function applyRole(){
    var box = document.getElementById('manualBox');
    if (box) box.style.display = (ROLE === 'SUPERVISOR') ? '' : 'none';
  }

  function resetSignInUi(){
    var gb = document.getElementById('gbtn');
    if (gb) gb.style.display = '';
    var wait = document.getElementById('signinWait');
    if (wait) wait.style.display = 'none';
  }

  function signOut(){
    clearSession();
    resetSignInUi();
    document.getElementById('signinErr').textContent = '';
    document.getElementById('signin').className = 'show';
  }

  function onGoogleCredential(resp){
    var gb = document.getElementById('gbtn');
    if (gb) gb.style.display = 'none';
    var wait = document.getElementById('signinWait');
    if (wait) wait.style.display = 'block';
    document.getElementById('signinErr').textContent = '';
    google.script.run
      .withSuccessHandler(function(res){
        if (res.status === 'SIGNED_IN'){
          saveSession(res.sessionKey, res.name, res.nonce, res.role);
          document.getElementById('signin').className = '';
          releaseScanner();
        } else {
          document.getElementById('signinErr').textContent =
            (res.headline || 'Sign-in failed') + (res.detail ? ' — ' + res.detail : '');
        }
      })
      .withFailureHandler(function(e){
        document.getElementById('signinErr').textContent = 'Sign-in error: ' + e.message;
      })
      .apiSignIn(resp.credential);   // NOT handleSignIn_ — a trailing "_" is never exposed
  }

  var signInReady = false;

  function initSignIn(){
    var box = document.getElementById('signin');
    if (!CLIENT_ID){ box.className = ''; return; }
    if (signInReady){ resetSignInUi(); box.className = 'show'; return; }   // already set up: just reopen it

    var saved = null;
    try { saved = JSON.parse(sessionStorage.getItem('gatescanner_session') || 'null'); } catch(e){}
    var restored = !!(saved && saved.key && saved.nonce &&
                      (Date.now() - saved.ts) < 5.5 * 3600 * 1000);
    if (restored) saveSession(saved.key, saved.name, saved.nonce, saved.role);

    // Show the overlay only if there is no session — but load Google's script
    // EITHER WAY. Returning early on a restored session left #gbtn empty, so
    // tapping "Switch" later gave a sign-in screen with no button on it.
    box.className = restored ? '' : 'show';

    var s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.defer = true;
    s.onload = function(){
      signInReady = true;
      google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: onGoogleCredential,
        auto_select: false,
        cancel_on_tap_outside: false
      });
      google.accounts.id.renderButton(document.getElementById('gbtn'),
        { theme: 'filled_black', size: 'large', text: 'signin_with' });
    };
    document.head.appendChild(s);
  }

  setMode('IN');
  startCamera();          // starts immediately; does not wait on sign-in
  try {
    initSignIn();
  } catch (e) {
    document.getElementById('signinErr').textContent = 'Sign-in setup error: ' + e.message;
  }
  if (!CLIENT_ID) {
    // Key mode only: with sign-in configured, the key path is not a credential.
    document.getElementById('vol').textContent = VOLKEY ? 'Key ' + VOLKEY.substring(0, 4) : 'no key';
    if (!VOLKEY) {
      show({ status: 'DENIED', headline: 'Missing your volunteer key',
             detail: 'Open the scanner link your coordinator sent you.' });
    }
  }
</script>
</body>
</html>

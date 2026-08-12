/* ------------------------------------------------------------------
     CONFIGURATION — set these two once, here in the file.

     They are deliberately NOT read from the URL. An earlier version took
     them from the query string, which meant anyone could send a link that
     pointed this page at their own server; because the transport below
     loads the reply as a <script>, that was remote code execution on
     whatever domain this file is hosted on.
     ------------------------------------------------------------------ */
  var NONCE = '', ROLE = '';

  var API_URL   = 'PASTE_YOUR_EXEC_URL_HERE';
  var CLIENT_ID = 'PASTE_YOUR_CLIENT_ID_HERE';


  function qs(name){
    var m = location.search.match(new RegExp('[?&]' + name + '=([^&]+)'));
    if (!m) return '';
    try { return decodeURIComponent(m[1]); } catch (e) { return ''; }  // malformed % must not kill the page
  }

  // Only honoured when sign-in is NOT configured. With sign-in on, identity comes
  // from Google, and reading a key from the URL would let a crafted link seed a
  // bogus value that suppresses the sign-in prompt.
  var VOLKEY = CLIENT_ID ? '' : qs('k').toUpperCase();

  if (API_URL.indexOf('PASTE_') === 0 || CLIENT_ID.indexOf('PASTE_') === 0) {
    document.body.textContent =
      'This page is not configured. Open scanner.js and set API_URL and CLIENT_ID '
      + '(lines 12-13), and replace AKfycbXXXX in the index.html CSP with your '
      + 'deployment id.';
    document.body.style.cssText = 'font:15px sans-serif;color:#900;padding:20px';
    throw new Error('unconfigured');
  }

  var MODE = 'IN';

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

  /* Last verdict that actually came from the server. A transport failure carries
     no occupancy figures, so without this there is no way to re-offer the extend
     buttons — and re-offering them is the only route back for a volunteer whose
     extend timed out. */
  var lastGood = null;

  function show(res){
    clearPending();
    if (!res._transport &&
        (res.status === 'ALLOW' || res.status === 'EXIT')) lastGood = res;
    /* Any verdict from the server resolves the request: the next scan of this
       pass is a new person, not a retry. Only client-synthesised transport
       failures keep the key alive. */
    if (!res._transport) { clearRid(); failedRequest = null; }
    if (res.status === 'DENIED' && CLIENT_ID){
      // Only ignore a rejection that belongs to a session we have since replaced.
      // Previously this checked "is VOLKEY set", which was true both before and
      // after sign-in, so an expired session silently swallowed every rejection
      // and the volunteer never saw the sign-in screen again.
      if (res._staleSession) { releaseScanner(); return; }
      clearSession();
      resetSignInUi();
      document.getElementById('signinErr').textContent = res.detail || res.headline || '';
      document.getElementById('signin').className = 'show';
      releaseScanner();          // path 3: session expired — camera must come back
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

    renderActions(res);
  }

  /* Group-admit buttons. #r-actions was present and styled but always emptied —
     a dead affordance sitting exactly where these belong.

     The counts offered come from the server's own occupancy figure, so the UI
     cannot propose more than is available. The server clamp is the backstop,
     not the control. */
  function renderActions(res){
    var box = document.getElementById('r-actions');
    box.innerHTML = '';
    if (!lastRequest) return;

    /* Transport failure. The response carries no occupancy, so fall back to the
       last real verdict and re-offer the same buttons — retrying is safe because
       the key is derived from the extend's parameters, so a request that did
       reach the server returns its cached result rather than admitting again. */
    /* Transport failure: exactly one correct action, which is resending the
       request that failed. Offering a menu of counts here was wrong — after a
       failed +1, a "Retry +2" is a DIFFERENT request the server has no reason to
       deduplicate, so tapping it would admit again on top of the first. */
    if (res._transport){
      if (failedRequest){
        var rb = document.createElement('button');
        rb.type = 'button';
        rb.textContent = 'Retry';
        rb.addEventListener('click', function(ev){
          ev.stopPropagation();
          rb.disabled = true;
          retryFailed();
        });
        box.appendChild(rb);
        document.getElementById('r-detail').textContent =
          'No reply from the server. Tap Retry above — do NOT scan the pass again.';
      }
      addDiagnostics(box);
      return;
    }
    if (res.status !== 'ALLOW' && res.status !== 'EXIT') return;

    var free, action, verb;
    if (res.status === 'ALLOW'){
      free = Math.max(0, (Number(res.capacity) || 0) - (Number(res.inside) || 0));
      action = 'IN';  verb = 'more in';
    } else if (res.status === 'EXIT'){
      free = Math.max(0, Number(res.inside) || 0);
      action = 'OUT'; verb = 'more out';
    } else {
      return;                                  // nothing to extend from
    }
    if (free < 1) return;

    for (var i = 1; i <= Math.min(free, 4); i++){
      (function(n){
        var b = document.createElement('button');
        b.type = 'button';
        /* In recovery the label must not read like a fresh action. Retrying via
           this button reuses the idempotency key and is safe; rescanning the pass
           instead generates a new key and, if the lost request had actually
           succeeded, consumes a second slot for someone already counted. The
           volunteer has no way to know that, so the UI has to say it. */
        b.textContent = '+' + n + ' ' + verb;
        b.addEventListener('click', function(ev){
          /* The overlay itself dismisses on click. Without this the tap would
             both extend and close the result. */
          ev.stopPropagation();
          /* Disable on first tap: a double-tap sends two calls with different
             rids, which the server correctly treats as two real requests. The
             clamp stops over-admission, but pips jumping 1 -> 2 -> 3 in front of
             a volunteer does not inspire confidence. */
          var all = box.querySelectorAll('button');
          for (var j = 0; j < all.length; j++) all[j].disabled = true;
          extend(action, n);
        });
        box.appendChild(b);
      })(i);
    }
  }

  function addDiagnostics(box){
    if (!LAST_FAIL_URL) return;
    var d = document.createElement('button');
    d.type = 'button';
    d.textContent = 'Diagnostics';
    d.addEventListener('click', function(ev){
      ev.stopPropagation();
      /* Must write INSIDE the overlay. This previously targeted #err, which sits
         outside #result — and #result is position:fixed inset:0 z-index:20, so
         the text rendered behind a full-screen panel. Field report: "the
         diagnostics button didn't do anything." It did; nobody could see it. */
      var e = document.getElementById('r-detail');
      e.style.wordBreak = 'break-all';
      e.style.fontSize = '12px';
      e.textContent = LAST_FAIL_URL;
    });
    box.appendChild(d);
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
        /* Was "Do not scan again yet", which contradicted the timeout message
           telling the volunteer to rescan. Rescanning is safe: ridFor() keeps
           the idempotency key alive through a transport failure. */
        : 'Still working \u2014 ' + s + 's.';
    }, 500);
  }

  function clearPending(){
    pending = false;
    clearInterval(pendingTimer);
    pendingTimer = null;
  }

  /* onScan() pauses the camera before every request. EVERY route out of that
     request must come back through here, or the camera stays paused and the
     scanner silently stops working with no error on screen. */
  function releaseScanner(){
    pending = false;
    clearInterval(pendingTimer);
    pendingTimer = null;
    busy = false;
    document.getElementById('result').className = '';
    if (scanner) { try { scanner.resume(); } catch(e){} }
  }

  function dismiss(){
    if (pending) return;              // ignore taps while waiting for the server
    document.getElementById('result').className = '';
    busy = false;
    if (scanner) { try { scanner.resume(); } catch(e){} }
  }

  function newRid(){
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  /* An idempotency key belongs to an unresolved REQUEST, not to an attempt.
     If a scan fails in transport, the next scan of that same pass is almost
     certainly the volunteer retrying — so it reuses the key and the server
     collapses the pair. Once any definitive verdict arrives the key is cleared,
     so the next scan of the same pass is a genuinely new person and counts.

     Bounded to 60s: the server's idempotency cache lives 300s, and beyond a
     minute a rescan is far more likely to be a real second guest than a retry. */
  var pendingRid = null, pendingCode = null, pendingAt = 0;

  function ridFor(code){
    if (code === pendingCode && pendingRid && (Date.now() - pendingAt) < 60000) {
      return pendingRid;
    }
    pendingCode = code; pendingRid = newRid(); pendingAt = Date.now();
    return pendingRid;
  }

  function clearRid(){ pendingCode = null; pendingRid = null; pendingAt = 0; }

  /* Last URL that failed at transport level. Exposed on the page so a fault can
     be read off the phone itself rather than needing a tethered debugger. */
  var LAST_FAIL_URL = '';

  /* The exact params of the last request that failed in transport. Retrying
     means resending THIS, not building something similar. */
  var failedRequest = null;

  function retryFailed(){
    if (!failedRequest) return;
    showPending();
    api(failedRequest, show);
  }

  function api(params, cb, timeoutMs, _isRetry){
    var sentUnder = VOLKEY;          // used to spot replies for a superseded session
    var name = 'jp' + Date.now() + Math.floor(Math.random()*1000);
    var s = document.createElement('script');
    var done = false;

    /* Retry ONLY an instant failure, never a timeout.
       A timeout means the server is slow — retrying then doubles load on an
       already-struggling service, and because every gate times out together the
       retries arrive together too. A timeout now needs no automatic retry
       anyway: ridFor() keeps the idempotency key alive after a transport
       failure, so the volunteer simply scanning the pass again is deduplicated
       server-side. That keeps a human in the loop and applies natural
       backpressure, which an automatic retry removes. */
    function retryOrFail(res, wasTimeout){
      if (!_isRetry && !wasTimeout && params.rid){
        setTimeout(function(){ api(params, cb, timeoutMs, true); },
                   1200 + Math.floor(Math.random() * 1600));
        return;
      }
      /* Keep the EXACT request that failed, rid included, so a manual retry can
         resend it byte for byte. Deriving a key from a heuristic and a time
         window did not survive contact with reality: recovering from a dropped
         connection takes longer than any window worth allowing, so the key had
         expired by the time the volunteer tapped Retry and the server counted a
         second admission. */
      if (res && res._transport && params.rid) failedRequest = params;
      cb(res);
    }

    /* 8s per attempt, not 15. With one automatic retry the volunteer's worst
       case is ~16s rather than ~30s — and at a gate running one person every
       eleven seconds, 30s of frozen camera is three people of dead air.
       Sign-in passes its own 60000 and is unaffected. */
    /* 15s, matching the server's LockService.waitLock(15000).
       This was briefly 8s, which was shorter than the server's own lock wait —
       so the client abandoned requests the server was still legitimately
       processing, then fired a retry onto the same slow execution. Apps Script
       cold starts alone routinely exceed 8 seconds. A client timeout must never
       be shorter than the server is willing to wait. */
    /* Set for the timeout path too. Previously only s.onerror set it, so a
       timeout either showed no Diagnostics button or — worse — showed a stale
       URL from an earlier, unrelated failure. A diagnostic that lies is worse
       than none. */
    var timer = setTimeout(function(){ LAST_FAIL_URL = s.src;
      finish({ status:'INVALID', _transport:true,
      headline:'Server is taking too long',
      detail:'No reply. If a Retry button is shown, use it rather than rescanning.' },
      true, true); },
      timeoutMs || 15000);

    function finish(res, retryable, wasTimeout){
      if (done) return;
      done = true;
      clearTimeout(timer);
      /* Leave a no-op behind rather than deleting the name. A response that
         lands after we gave up would otherwise execute jpNNN(...) against a
         missing global and throw an uncaught ReferenceError — console noise
         during exactly the stall someone would be debugging. */
      window[name] = function(){};
      setTimeout(function(){ try { delete window[name]; } catch(e){ window[name] = undefined; } }, 30000);
      if (s.parentNode) s.parentNode.removeChild(s);
      if (res && typeof res === 'object') res._staleSession = (sentUnder !== VOLKEY);
      if (retryable) retryOrFail(res || { status:'INVALID', headline:'Bad reply from the server' }, wasTimeout);
      else cb(res || { status:'INVALID', headline:'Bad reply from the server' });
    }

    window[name] = function(res){ finish(res, false); };
    params.callback = name;
    params.k = VOLKEY;
    params.n = NONCE;
    var q = Object.keys(params).map(function(key){
      return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
    }).join('&');
    s.src = API_URL + '?' + q;
    s.onerror = function(){
      /* onerror fires for a refused request or an HTTP error status — never for
         a bad response body. Several causes look identical from here (no signal,
         CSP refusal, HTTP 4xx/5xx from Google), so this must NOT assert one of
         them: an earlier version blamed the CSP and sent a correctly-configured
         deployment chasing its own key for an unrelated fault.

         The failing URL is stashed so LAST_FAIL_URL can be read from the page
         without a laptop and a remote debugger. */
      LAST_FAIL_URL = s.src;
      try { console.error('gate: request failed: ' + s.src); } catch(e){}
      finish({ status:'INVALID', _transport:true, headline:'Could not reach the server',
        detail:'The request was refused before the server answered. Tap "Diagnostics" '
             + 'below for the failing address.' },
        true);
    };
    document.body.appendChild(s);
  }

  /* What to re-send when the volunteer extends an admission. lastCode cannot be
     reused: it is the duplicate-suppression state below and gets cleared. */
  var lastRequest = null;    // { api:'scan', t:code } or { api:'manual', id:v }

  function send(code){
    if (CLIENT_ID && !VOLKEY){
      resetSignInUi();
      document.getElementById('signin').className = 'show';
      releaseScanner();          // not signed in yet: unwind, do not strand the camera
      return;
    }
    document.getElementById('err').textContent = '';
    lastRequest = { api:'scan', t:code };
    showPending();
    api({ api:'scan', t:code, action:MODE, rid:ridFor(code) }, show);
  }

  function sendManual(){
    var v = document.getElementById('manualId').value;
    if(!v) return;
    document.getElementById('manualId').value = '';
    lastRequest = { api:'manual', id:v };
    showPending();
    api({ api:'manual', id:v, action:MODE, rid:ridFor('M:' + v) }, show);
  }

  /* Group admit: one more round trip instead of one more full scan cycle.
     A family of three costs one decode, one identity check and one dismiss
     rather than three of each — and two lock acquisitions on the server
     rather than three. */
  function extend(action, n){
    if (!lastRequest) return;
    /* Same guard as send(). A session that expired between the scan and this tap
       would otherwise fire a call with an empty key, get DENIED, and drop the
       volunteer at the sign-in screen mid-party with nothing explaining why. */
    if (CLIENT_ID && !VOLKEY){
      resetSignInUi();
      document.getElementById('signin').className = 'show';
      releaseScanner();
      return;
    }
    /* Copy: api() mutates the object it is given (callback, k, n), and
       lastRequest must stay clean for a second extend. */
    var params = {};
    for (var key in lastRequest) params[key] = lastRequest[key];
    params.action = action;
    /* Named 'cnt', not 'c'. A single generic letter in a query string to Google
       infrastructure is a needless gamble against reserved or filtered names,
       and this parameter failed deterministically as 'c' in field testing while
       every other parameter on the same request went through. */
    params.cnt    = n;
    /* A key derived from the extend's own parameters, NOT a fresh one.
       An earlier version used newRid() on the reasoning that an extend is a new
       admission and must not be swallowed as a retry of the scan. True, but it
       stopped one step short: the key must be new relative to the SCAN and
       stable relative to THIS extend.

       With a fresh key, a timed-out extend that actually succeeded could not be
       safely repeated. The volunteer's only recourse was to rescan the pass,
       which generated another new key and consumed a second slot for a person
       already counted — leaving a phantom occupant and refusing the third real
       guest. The clamp prevents exceeding capacity; it does not prevent wasting
       a slot, and at capacity 3 one wasted slot is a third of the pass. */
    /* Still keyed on the extend's own parameters so an immediate repeat dedupes,
       but recovery no longer depends on this: a transport failure stashes the
       whole request and the Retry button resends it with this same rid however
       long the volunteer takes. */
    params.rid = ridFor('X:' + (lastRequest.t || lastRequest.id) + ':' + action + ':' + n);
    showPending();
    api(params, show);
  }

  /* 700 ms, not 4000. This only needs to outlast the duplicate frames the
     decoder emits between a successful read and busy/pause taking effect —
     which is milliseconds. The old four-second window silently discarded
     guests two and three on the same pass, and with three-per-pass that is the
     ordinary case, not an edge case. The failure was invisible: no beep, no
     overlay, the camera simply looked frozen. */
  var DUPE_WINDOW_MS = 700;

  function onScan(text){
    var now = Date.now();
    if (busy) return;
    if (text === lastCode && now - lastAt < DUPE_WINDOW_MS) return;
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

  /* jsQR is 252 KB and serves only the photo fallback, which is used rarely.
     Loading it on demand halves the initial page weight on gate wifi.
     script-src 'self' already permits this; no CSP change needed. */
  var jsqrLoading = null;
  function ensureJsQR(){
    if (typeof jsQR !== 'undefined') return Promise.resolve(true);
    if (jsqrLoading) return jsqrLoading;
    jsqrLoading = new Promise(function(res){
      var el = document.createElement('script');
      el.src = 'jsQR.js';
      el.onload  = function(){ res(typeof jsQR !== 'undefined'); };
      el.onerror = function(){ res(false); };
      document.head.appendChild(el);
    });
    return jsqrLoading;
  }

  function scanPhoto(input){
    var f = input.files && input.files[0];
    if(!f) return;
    var err = document.getElementById('err');
    err.textContent = 'Loading decoder\u2026';
    ensureJsQR().then(function(ready){
      if (!ready){
        err.textContent = 'Decoder did not load. Check the phone has internet, '
                        + 'then reload this page.';
        return;
      }
      input.value = '';
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
    });
  }

  function startCamera(){
    /* A 404 on the library throws a ReferenceError here, and that throw is
       OUTSIDE the .catch() below — it would abort the rest of this file at top
       level, so initSignIn() never runs and the volunteer gets a dead page
       instead of the working photo fallback. */
    if (typeof Html5Qrcode === 'undefined'){
      document.getElementById('hint').textContent =
        'Camera library did not load — use "Take photo of pass" below.';
      return;
    }
    try {
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
    } catch (e) {
      scanner = null;
      document.getElementById('hint').textContent =
        'Camera unavailable — use "Take photo of pass" below.';
    }
  }

  var SESSION_KEY = '';

  function saveSession(key, name, nonce, role){
    SESSION_KEY = key;
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
    SESSION_KEY = ''; VOLKEY = ''; NONCE = ''; ROLE = '';
    applyRole();
    try { sessionStorage.removeItem('gatescanner_session'); } catch(e){}
    document.getElementById('signout').style.display = 'none';
  }

  var signInReady = false;

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
    api({ api: 'signin', idt: resp.credential }, function(res){
      if (res.status === 'SIGNED_IN'){
        saveSession(res.sessionKey, res.name, res.nonce, res.role);
        document.getElementById('signin').className = '';
        releaseScanner();        // a scan attempted before sign-in left it paused
      } else {
        document.getElementById('signinErr').textContent =
          (res.headline || 'Sign-in failed') + (res.detail ? ' — ' + res.detail : '');
        var gb2 = document.getElementById('gbtn');
        if (gb2) gb2.style.display = '';
        var w2 = document.getElementById('signinWait');
        if (w2) w2.style.display = 'none';
      }
    }, 60000);   // sign-in is the slow path: measured over 20s, allow generous headroom
  }

  function initSignIn(){
    var box = document.getElementById('signin');
    if (!CLIENT_ID){
      box.className = '';   // no Client ID configured: sign-in disabled, fall back to key mode
      return;
    }
    if (signInReady){ resetSignInUi(); box.className = 'show'; return; }   // already set up: just reopen it

    var saved = null;
    try { saved = JSON.parse(sessionStorage.getItem('gatescanner_session') || 'null'); } catch(e){}
    var restored = !!(saved && saved.key && saved.nonce &&
                      (Date.now() - saved.ts) < 5.5 * 3600 * 1000);
    if (restored) saveSession(saved.key, saved.name, saved.nonce, saved.role);

    // Show the overlay only if there is no session — but load Google's script
    // EITHER WAY. Returning early on a restored session left #gbtn empty, so
    // tapping "Switch" later produced a sign-in screen with no button on it and
    // no way forward short of reloading the page. Handing the phone to the next
    // volunteer is precisely when Switch gets used.
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


  /* ------------------------------------------------------------------
     Event wiring. These were inline on* attributes; moving them out is what
     lets the CSP drop 'unsafe-inline', so an injected <" + "script> would be
     refused by the browser even if something slipped past input validation.
     ------------------------------------------------------------------ */
  function on(id, evt, fn){
    var el = document.getElementById(id);
    if (el) el.addEventListener(evt, fn);
  }
  on('m-IN',     'click',  function(){ setMode('IN'); });
  on('m-OUT',    'click',  function(){ setMode('OUT'); });
  on('m-CHECK',  'click',  function(){ setMode('CHECK'); });
  on('signout',  'click',  signOut);
  on('manualGo', 'click',  sendManual);
  on('result',   'click',  dismiss);
  on('photoIn',  'change', function(){ scanPhoto(this); });
  on('photoBtn', 'click',  function(){ document.getElementById('photoIn').click(); });

  setMode('IN');
  startCamera();          // starts right away, does not wait on sign-in
  try {
    initSignIn();
  } catch (e) {
    document.getElementById('signinErr').textContent = 'Sign-in setup error: ' + e.message;
  }
  if (!CLIENT_ID) {
    document.getElementById('vol').textContent = VOLKEY ? 'Key ' + VOLKEY.substring(0,4) : 'no key';
    if (!VOLKEY) {
      show({ status:'DENIED', headline:'Missing your volunteer key',
             detail:'Open the personal scanner link your coordinator sent you.' });
    }
  }

/* ------------------------------------------------------------------
     CONFIGURATION — set these two once, here in the file.

     They are deliberately NOT read from the URL. An earlier version took
     them from the query string, which meant anyone could send a link that
     pointed this page at their own server; because the transport below
     loads the reply as a <script>, that was remote code execution on
     whatever domain this file is hosted on.
     ------------------------------------------------------------------ */
  var NONCE = '', ROLE = '';

  var API_URL   = 'https://script.google.com/macros/s/AKfycbw0zbmQFELcmo8tt5_4N_WKkUYUp5SYCaVXRPvqFANIfu-cHyeiBkVhPmSk6cqK9Y1J/exec';
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

  function beep(ok){
    try{
      var a = new (window.AudioContext||window.webkitAudioContext)();
      var o = a.createOscillator(), g = a.createGain();
      o.connect(g); g.connect(a.destination);
      o.frequency.value = ok ? 880 : 220;
      g.gain.setValueAtTime(.14, a.currentTime);
      g.gain.exponentialRampToValueAtTime(.0001, a.currentTime + (ok?.16:.42));
      o.start(); o.stop(a.currentTime + (ok?.18:.45));
    }catch(e){}
  }

  function show(res){
    clearPending();
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

  function api(params, cb){
    var sentUnder = VOLKEY;          // used to spot replies for a superseded session
    var name = 'jp' + Date.now() + Math.floor(Math.random()*1000);
    var s = document.createElement('script');
    var done = false;
    var timer = setTimeout(function(){ finish({ status:'INVALID',
      headline:'No answer from the server', detail:'Check the signal and scan again.' }); }, 15000);
    function finish(res){
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { delete window[name]; } catch(e){ window[name] = undefined; }
      if (s.parentNode) s.parentNode.removeChild(s);
      if (res && typeof res === 'object') res._staleSession = (sentUnder !== VOLKEY);
      cb(res || { status:'INVALID', headline:'Bad reply from the server' });
    }
    window[name] = finish;
    params.callback = name;
    params.k = VOLKEY;
    params.n = NONCE;
    var q = Object.keys(params).map(function(key){
      return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
    }).join('&');
    s.src = API_URL + '?' + q;
    s.onerror = function(){
      // Two causes look identical here: no network, or the page's CSP refusing
      // the request. The CSP case is silent and easy to misdiagnose, so name it.
      finish({ status:'INVALID', headline:'Could not reach the server',
        detail:'Check the signal. If this happens on every scan, the script-src '
             + 'line in index.html may still contain the AKfycbXXXX placeholder.' });
    };
    document.body.appendChild(s);
  }

  function send(code){
    if (CLIENT_ID && !VOLKEY){
      resetSignInUi();
      document.getElementById('signin').className = 'show';
      releaseScanner();          // not signed in yet: unwind, do not strand the camera
      return;
    }
    document.getElementById('err').textContent = '';
    showPending();
    api({ api:'scan', t:code, action:MODE }, show);
  }

  function sendManual(){
    var v = document.getElementById('manualId').value;
    if(!v) return;
    document.getElementById('manualId').value = '';
    api({ api:'manual', id:v, action:MODE }, show);
  }

  function onScan(text){
    var now = Date.now();
    if (busy) return;
    if (text === lastCode && now - lastAt < 4000) return;
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
    });
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
    if (saved && saved.key && saved.nonce && (Date.now() - saved.ts) < 5.5 * 3600 * 1000){
      saveSession(saved.key, saved.name, saved.nonce, saved.role);
      box.className = '';
      return;
    }
    box.className = 'show';
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

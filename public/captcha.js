// App 內（iOS Capacitor）的 Cloudflare Turnstile 安全驗證。WebView 來源是 capacitor://nightzhe.github.io，
// Turnstile 只接受 http／https 來源（Cloudflare 社群 811273：員工確認 scheme 是元兇），所以 widget 改在正式站這兩頁（https 來源）上畫：
//   captcha-frame.html（data-mode="frame"）：App 把它放在 iframe 裡，事件用 postMessage 往上送、parent 用 postMessage 叫它 reset。
//   captcha.html：App 用系統瀏覽器視圖開它，通過後把一次性的 token 經自訂 scheme 回跳帶回 App（io.github.nightzhe.goodmarket://captcha?token=…）。
// 回跳目的地寫死為本 App 的 scheme，query 的 return 只接受同一個值（不當開放式導向）。
// sitekey 是公開值；query 可以帶（本機用 Cloudflare 測試 sitekey），沒帶就用正式站的。token 只進 postMessage／回跳網址，不寫 console／storage。
(function () {
  'use strict';
  var APP_RETURN = 'io.github.nightzhe.goodmarket://captcha';
  var DEFAULT_SITEKEY = '0x4AAAAAAFh8HZ6cfA1LLg9i';
  var MSG = 'gm-turnstile';

  var frameMode = document.documentElement.getAttribute('data-mode') === 'frame';
  var q = new URLSearchParams(window.location.search);
  var qsKey = q.get('sitekey') || '';
  var sitekey = /^[0-9A-Za-z_-]{1,64}$/.test(qsKey) ? qsKey : DEFAULT_SITEKEY;
  var returnTo = APP_RETURN;

  var $ = function (id) { return document.getElementById(id); };
  var widgetId = null;
  var state = 'loading';

  // ---------- frame 模式：事件往 parent 送 ----------
  function post(event, extra) {
    if (!frameMode || window.parent === window) return;
    var m = { type: MSG, event: event };
    if (extra) for (var k in extra) m[k] = extra[k];
    window.parent.postMessage(m, '*');
  }

  function sizeFor() {
    // 官方 flexible 最小寬 300；容器更窄（縮放 200%）改 compact（與 App 內 turnstileSize 同一規則）
    return document.documentElement.clientWidth < 300 ? 'compact' : 'flexible';
  }

  // ---------- 整頁模式（系統瀏覽器視圖）：畫面狀態 ----------
  function show(id, on) { var el = $(id); if (el) el.classList.toggle('hidden', !on); }
  function setState(next) {
    state = next;
    if (frameMode) return;
    show('loading', next === 'loading');
    show('done', next === 'done');
    show('failed', next === 'failed');
    show('unavailable', next === 'unavailable');
    show('back-ok', next === 'done');
    show('retry', next === 'failed');
    show('reload', next === 'unavailable');
    show('back-cancel', next === 'failed' || next === 'unavailable' || next === 'widget');
    show('widget', next === 'widget' || next === 'failed');
  }

  function returnWithToken(token) {
    var url = returnTo + '?token=' + encodeURIComponent(token);
    $('back-ok').setAttribute('href', url);
    setState('done');
    // 沒有使用者手勢的自訂 scheme 導向在 iOS 可能被靜默擋下；擋下來時上面的按鈕是後路
    try { window.location.href = url; } catch (e) { /* 留給按鈕 */ }
  }

  function reset() {
    if (window.turnstile && widgetId !== null) { setState('widget'); window.turnstile.reset(widgetId); }
    else window.location.reload();
  }

  if (!frameMode) {
    $('back-cancel').setAttribute('href', returnTo + '?cancelled=1');
    $('retry').addEventListener('click', reset);
    $('reload').addEventListener('click', function () { window.location.reload(); });
  } else {
    // parent 的指令：只收同一個 parent 視窗送來的 reset
    window.addEventListener('message', function (e) {
      if (e.source !== window.parent || !e.data || e.data.type !== MSG) return;
      if (e.data.cmd === 'reset') reset();
    });
    // widget 高度跟著回報（interaction-only 平常 0，需要互動時 65／compact 140），parent 用它調 iframe 高度
    if (window.ResizeObserver) {
      new ResizeObserver(function () { post('height', { height: $('widget').offsetHeight }); }).observe($('widget'));
    }
  }

  // 腳本 10 秒還沒載入（被擋、離線）就當載入不了
  var slow = window.setTimeout(function () { if (state === 'loading') { setState('unavailable'); post('script-failed'); } }, 10000);

  window.gmTurnstileScriptFailed = function () { window.clearTimeout(slow); setState('unavailable'); post('script-failed'); };

  window.gmOnTurnstileLoad = function () {
    window.clearTimeout(slow);
    if (!window.turnstile) { setState('unavailable'); post('script-failed'); return; }
    setState('widget');
    try {
      widgetId = window.turnstile.render($('widget'), {
        sitekey: sitekey,
        size: sizeFor(),
        // 整頁模式讓人看得到進度；frame 模式與網頁版一致：平常隱形，需要互動才長出勾選框
        appearance: frameMode ? 'interaction-only' : 'always',
        theme: 'light',
        language: 'zh-tw',
        execution: 'render',
        'response-field': false,
        callback: function (token) { if (frameMode) post('token', { token: token }); else returnWithToken(token); },
        'error-callback': function (code) { setState('failed'); post('error', { code: code == null ? '' : String(code) }); },
        'expired-callback': function () { if (state === 'done') setState('widget'); post('expired'); if (window.turnstile) window.turnstile.reset(widgetId); },
        'timeout-callback': function () { setState('widget'); post('timeout'); },
        'before-interactive-callback': function () { post('interactive'); },
        'after-interactive-callback': function () { post('after-interactive'); },
      });
      post('loaded');
    } catch (e) {
      setState('unavailable');
      post('script-failed');
    }
  };
})();

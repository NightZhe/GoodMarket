// App 內（iOS Capacitor）的 Cloudflare Turnstile 安全驗證（decisions D-12）。WebView 來源是 capacitor://nightzhe.github.io，
// Turnstile 只接受 http／https 來源（Cloudflare 社群 811273：員工確認 scheme 是元兇，token 一律無效），
// 所以 widget 改在正式站這一頁（captcha-frame.html，https 來源）上畫：App 的登入面板把它放在 iframe 裡，
// 事件用 postMessage 往 parent 送、parent 用 postMessage 叫它 reset。網頁版與 Android 不用這一頁。
// sitekey 是公開值；query 可以帶（本機用 Cloudflare 測試 sitekey），沒帶就用正式站的。token 只進 postMessage，不寫 console／storage。
(function () {
  'use strict';
  var DEFAULT_SITEKEY = '0x4AAAAAAFh8HZ6cfA1LLg9i';
  var MSG = 'gm-turnstile';

  var q = new URLSearchParams(window.location.search);
  var qsKey = q.get('sitekey') || '';
  var sitekey = /^[0-9A-Za-z_-]{1,64}$/.test(qsKey) ? qsKey : DEFAULT_SITEKEY;
  var widget = document.getElementById('widget');
  var widgetId = null;
  var loaded = false;

  function post(event, extra) {
    if (window.parent === window) return;
    var m = { type: MSG, event: event };
    if (extra) for (var k in extra) m[k] = extra[k];
    window.parent.postMessage(m, '*');
  }

  // 官方 flexible 最小寬 300；容器更窄（縮放 200%）改 compact（與 App 內 turnstileSize 同一規則）
  function sizeFor() { return document.documentElement.clientWidth < 300 ? 'compact' : 'flexible'; }

  // parent 的指令：只收同一個 parent 視窗送來的 reset
  window.addEventListener('message', function (e) {
    if (e.source !== window.parent || !e.data || e.data.type !== MSG) return;
    if (e.data.cmd === 'reset' && window.turnstile && widgetId !== null) window.turnstile.reset(widgetId);
  });

  // widget 高度跟著回報（interaction-only 平常 0，需要互動時 65／compact 140），parent 用它調 iframe 高度
  if (window.ResizeObserver) new ResizeObserver(function () { post('height', { height: widget.offsetHeight }); }).observe(widget);

  // 腳本 10 秒還沒載入（被擋、離線）就當載入不了
  var slow = window.setTimeout(function () { if (!loaded) post('script-failed'); }, 10000);

  window.gmTurnstileScriptFailed = function () { window.clearTimeout(slow); post('script-failed'); };

  window.gmOnTurnstileLoad = function () {
    window.clearTimeout(slow);
    if (!window.turnstile) { post('script-failed'); return; }
    try {
      widgetId = window.turnstile.render(widget, {
        sitekey: sitekey,
        size: sizeFor(),
        // 與網頁版一致：平常隱形，Cloudflare 判定需要互動才長出勾選框
        appearance: 'interaction-only',
        theme: 'light',
        language: 'zh-tw',
        execution: 'render',
        'response-field': false,
        callback: function (token) { post('token', { token: token }); },
        'error-callback': function (code) { post('error', { code: code == null ? '' : String(code) }); },
        'expired-callback': function () { post('expired'); if (window.turnstile) window.turnstile.reset(widgetId); },
        'timeout-callback': function () { post('timeout'); },
        'before-interactive-callback': function () { post('interactive'); },
        'after-interactive-callback': function () { post('after-interactive'); },
      });
      loaded = true;
      post('loaded');
    } catch (e) {
      post('script-failed');
    }
  };
})();

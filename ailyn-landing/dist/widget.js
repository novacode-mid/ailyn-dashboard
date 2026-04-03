(function() {
  var script = document.currentScript || document.querySelector('script[data-company]');
  if (!script) return;

  var config = {
    company: script.getAttribute('data-company') || 'demo',
    position: script.getAttribute('data-position') || 'bottom-right',
    color: script.getAttribute('data-color') || '#6366f1',
    title: script.getAttribute('data-title') || 'Ailyn',
    dashboardUrl: 'https://ailyn-dashboard.pages.dev',
  };

  var isLeft = config.position === 'bottom-left';
  var posCSS = isLeft ? 'left' : 'right';

  var style = document.createElement('style');
  style.textContent = [
    '.ailyn-widget{position:fixed;bottom:20px;' + posCSS + ':20px;z-index:99999;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}',
    '.ailyn-btn{width:56px;height:56px;border-radius:50%;background:' + config.color + ';border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px ' + config.color + '66;transition:all .3s;position:relative}',
    '.ailyn-btn:hover{transform:scale(1.08);box-shadow:0 6px 28px ' + config.color + '88}',
    '.ailyn-btn svg{width:24px;height:24px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
    '.ailyn-badge{position:absolute;top:-2px;right:-2px;width:12px;height:12px;border-radius:50%;background:#22c55e;border:2px solid #fff}',
    '.ailyn-panel{position:absolute;bottom:68px;' + posCSS + ':0;width:380px;height:560px;border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.1);background:#0f172a;display:none;transform:translateY(20px);opacity:0;transition:transform .3s ease,opacity .3s ease}',
    '.ailyn-panel.ailyn-open{transform:translateY(0);opacity:1}',
    '.ailyn-header{background:' + config.color + ';padding:14px 16px;display:flex;align-items:center;justify-content:space-between}',
    '.ailyn-header-info{display:flex;align-items:center;gap:10px}',
    '.ailyn-avatar{width:32px;height:32px;border-radius:8px;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:#fff}',
    '.ailyn-header-text{color:#fff}',
    '.ailyn-header-text h4{margin:0;font-size:14px;font-weight:600}',
    '.ailyn-header-text p{margin:0;font-size:11px;opacity:.7}',
    '.ailyn-close{background:none;border:none;color:rgba(255,255,255,.7);cursor:pointer;font-size:22px;padding:4px 8px;line-height:1;border-radius:6px;transition:all .2s}',
    '.ailyn-close:hover{color:#fff;background:rgba(255,255,255,.15)}',
    '.ailyn-iframe{width:100%;height:calc(100% - 56px);border:none;background:#0f172a}',
    '@media(max-width:480px){.ailyn-panel{width:calc(100vw - 24px);height:70vh;' + posCSS + ':-8px}}'
  ].join('\n');
  document.head.appendChild(style);

  var widget = document.createElement('div');
  widget.className = 'ailyn-widget';

  var panel = document.createElement('div');
  panel.className = 'ailyn-panel';

  var header = document.createElement('div');
  header.className = 'ailyn-header';

  var headerInfo = document.createElement('div');
  headerInfo.className = 'ailyn-header-info';

  var avatar = document.createElement('div');
  avatar.className = 'ailyn-avatar';
  avatar.textContent = config.title.charAt(0).toUpperCase();

  var headerText = document.createElement('div');
  headerText.className = 'ailyn-header-text';
  var h4 = document.createElement('h4');
  h4.textContent = config.title;
  var subtitle = document.createElement('p');
  subtitle.textContent = 'Asistente de IA \u00b7 En l\u00ednea';
  headerText.appendChild(h4);
  headerText.appendChild(subtitle);

  headerInfo.appendChild(avatar);
  headerInfo.appendChild(headerText);

  var closeBtn = document.createElement('button');
  closeBtn.className = 'ailyn-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.onclick = function() { window.AilynWidget.toggle(); };

  header.appendChild(headerInfo);
  header.appendChild(closeBtn);

  var iframe = document.createElement('iframe');
  iframe.className = 'ailyn-iframe';
  iframe.setAttribute('loading', 'lazy');
  iframe.setAttribute('allow', 'microphone; clipboard-write');

  panel.appendChild(header);
  panel.appendChild(iframe);

  var btn = document.createElement('button');
  btn.className = 'ailyn-btn';
  btn.setAttribute('aria-label', 'Open chat');
  btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
  btn.onclick = function() { window.AilynWidget.toggle(); };

  var badge = document.createElement('div');
  badge.className = 'ailyn-badge';
  btn.appendChild(badge);

  widget.appendChild(panel);
  widget.appendChild(btn);
  document.body.appendChild(widget);

  var isOpen = false;
  var iframeLoaded = false;

  window.AilynWidget = {
    toggle: function() {
      isOpen = !isOpen;
      if (isOpen) {
        if (!iframeLoaded) {
          iframe.src = config.dashboardUrl + '/chat/' + encodeURIComponent(config.company);
          iframeLoaded = true;
        }
        panel.style.display = 'block';
        badge.style.display = 'none';
        requestAnimationFrame(function() {
          requestAnimationFrame(function() {
            panel.classList.add('ailyn-open');
          });
        });
      } else {
        panel.classList.remove('ailyn-open');
        setTimeout(function() { panel.style.display = 'none'; }, 300);
      }
    },
    open: function() { if (!isOpen) this.toggle(); },
    close: function() { if (isOpen) this.toggle(); },
    destroy: function() {
      if (widget.parentNode) widget.parentNode.removeChild(widget);
      if (style.parentNode) style.parentNode.removeChild(style);
      delete window.AilynWidget;
    }
  };
})();

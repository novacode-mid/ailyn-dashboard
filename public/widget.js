// ── Ailyn Chat Widget ────────────────────────────────────────────────────
// Drop-in script para agregar chat de Ailyn a cualquier sitio web.
// Uso: <script src="https://ailyn-dashboard.pages.dev/widget.js" data-slug="tu-empresa"></script>
//
// Opciones via data-attributes:
//   data-slug     (requerido) — slug de la empresa
//   data-position — "right" (default) o "left"
//   data-color    — color del boton (se auto-detecta del branding)

(function () {
  "use strict";

  // Get config from script tag
  var script = document.currentScript || document.querySelector('script[data-slug]');
  if (!script) return;

  var slug = script.getAttribute("data-slug");
  if (!slug) { console.warn("[Ailyn Widget] data-slug is required"); return; }

  var position = script.getAttribute("data-position") || "right";
  var customColor = script.getAttribute("data-color");
  var baseUrl = "https://ailyn-dashboard.pages.dev";
  var color = customColor || "#6366f1";

  // Fetch branding to get company color
  fetch("https://ailyn-agent.novacodepro.workers.dev/api/company/" + slug + "/branding")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.brand_color) color = data.brand_color;
      init(data);
    })
    .catch(function () { init(null); });

  function init(branding) {
    // Styles
    var style = document.createElement("style");
    style.textContent = [
      "#ailyn-widget-btn { position:fixed; bottom:20px; " + position + ":20px; z-index:99999; width:60px; height:60px; border-radius:50%; border:none; cursor:pointer; box-shadow:0 4px 20px rgba(0,0,0,0.3); transition:transform 0.2s, box-shadow 0.2s; display:flex; align-items:center; justify-content:center; }",
      "#ailyn-widget-btn:hover { transform:scale(1.1); box-shadow:0 6px 28px rgba(0,0,0,0.4); }",
      "#ailyn-widget-btn svg { width:28px; height:28px; fill:white; }",
      "#ailyn-widget-frame { position:fixed; bottom:90px; " + position + ":20px; z-index:99998; width:380px; height:600px; max-height:80vh; border-radius:16px; overflow:hidden; box-shadow:0 10px 40px rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.1); display:none; }",
      "#ailyn-widget-frame.open { display:block; animation:ailyn-slide-up 0.3s ease; }",
      "#ailyn-widget-frame iframe { width:100%; height:100%; border:none; }",
      "@keyframes ailyn-slide-up { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }",
      "@media(max-width:480px) { #ailyn-widget-frame { width:calc(100vw - 20px); height:calc(100vh - 120px); " + position + ":10px; bottom:80px; border-radius:12px; } #ailyn-widget-btn { bottom:14px; " + position + ":14px; width:54px; height:54px; } }",
      "#ailyn-widget-badge { position:absolute; top:-2px; right:-2px; width:12px; height:12px; background:#22c55e; border-radius:50%; border:2px solid white; }",
    ].join("\n");
    document.head.appendChild(style);

    // Button
    var btn = document.createElement("button");
    btn.id = "ailyn-widget-btn";
    btn.style.background = color;
    btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg><span id="ailyn-widget-badge"></span>';
    btn.title = branding ? "Chat con " + branding.name : "Abrir chat";
    document.body.appendChild(btn);

    // Frame
    var frame = document.createElement("div");
    frame.id = "ailyn-widget-frame";
    frame.innerHTML = '<iframe src="' + baseUrl + "/chat/" + slug + '" allow="microphone"></iframe>';
    document.body.appendChild(frame);

    // Toggle
    var isOpen = false;
    btn.addEventListener("click", function () {
      isOpen = !isOpen;
      if (isOpen) {
        frame.classList.add("open");
        btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
        btn.style.background = "#374151";
      } else {
        frame.classList.remove("open");
        btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg><span id="ailyn-widget-badge"></span>';
        btn.style.background = color;
      }
    });
  }
})();
